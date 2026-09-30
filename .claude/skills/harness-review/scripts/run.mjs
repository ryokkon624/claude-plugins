#!/usr/bin/env node
// harness-review run controller. No npm deps.
//
//   node run.mjs init   <target> [--from S1..S5] [--run <id>] [--skip-verify]   → creates/reuses a run dir, runs S0
//   node run.mjs plan   <run-dir> S1|S2|S4 [--retry]                             → writes batch input files, prints batch list (JSON)
//   node run.mjs merge  <run-dir> S1|S2|S3|S4                                    → merges agent outputs, runs coverage checks
//   node run.mjs status <run-dir>                                                → prints run.json
//   node run.mjs stage  <run-dir> <stage> <status> [key=value ...]              → updates run.json stage record
//
// Exit codes: 0 ok, 1 error, 3 coverage gap (merge S1..S4: something is missing or invalid; see printed JSON)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discover } from './discover.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : path.resolve(SKILL_DIR, '..', '..', '..');
const OUTPUT_ROOT = path.join(PROJECT_DIR, 'output', 'harness-review');
const STAGES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'];
const AXES = ['A', 'B', 'C', 'D', 'E'];
const LLM_KINDS = new Set(['claude-md', 'import', 'rule', 'skill', 'skill-support', 'command', 'agent', 'hook-script', 'workflow']);
const ENTRY_KINDS = new Set(['skill', 'command', 'agent', 'workflow']);
const S1_BATCH = 10, S2_BATCH = 5, S4_BATCH = 8;
const SEVERITY_ORDER = { must: 0, should: 1, 'nice to have': 2 };
const BASES = new Set(['official', 'custom']);

// ---------------------------------------------------------------- helpers

const posix = (p) => p.split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const listJson = (dir, { exclude = /\.input\.json$/ } = {}) => (isDir(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !exclude.test(f)).sort().map((f) => path.join(dir, f)) : []);
const now = () => new Date().toISOString();
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const fail = (msg, code = 1) => { console.error(`[run] ${msg}`); process.exit(code); };
const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');

function loadRun(runDir) {
  const p = path.join(runDir, 'run.json');
  if (!exists(p)) fail(`not a run dir (no run.json): ${runDir}`);
  return { run: readJson(p), runPath: p };
}
function saveRun(runPath, run) { writeJson(runPath, run); }
function setStage(run, stage, patch) { run.stages[stage] = { ...(run.stages[stage] ?? {}), ...patch }; }
function normalizeTarget(t) { return posix(String(t)).replace(/^\.\//, '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, ''); }
// Collapse placeholder spellings (sprint_XX, sprint_{N}, review-#N, <lens>, ${x}) so the same logical target merges.
function canonicalTarget(t) {
  return normalizeTarget(t)
    .replace(/\$\{[^}]*\}/g, '*').replace(/#?\{[^}]*\}/g, '*').replace(/<[^>]*>/g, '*')
    .replace(/#N(?![\w])/g, '*').replace(/(?<![A-Za-z0-9])(XX+|NN+|nn+|N)(?![A-Za-z0-9])/g, '*')
    .replace(/\*+/g, '*');
}

// ---------------------------------------------------------------- init

function cmdInit(args) {
  let target = null, from = null, runId = null, skipVerify = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') from = args[++i];
    else if (args[i] === '--run') runId = args[++i];
    else if (args[i] === '--skip-verify') skipVerify = true;
    else if (!target) target = args[i];
    else fail(`unexpected argument: ${args[i]}`);
  }
  if (!target) fail('usage: run.mjs init <target> [--from S1..S5] [--run <id>] [--skip-verify]');
  const root = path.resolve(target);
  if (!isDir(root)) fail(`not a directory: ${root}`);
  if (from && !STAGES.includes(from)) fail(`--from must be one of ${STAGES.join(', ')}`);
  const name = path.basename(root);
  const targetDir = path.join(OUTPUT_ROOT, name);
  fs.mkdirSync(targetDir, { recursive: true });
  const runs = fs.readdirSync(targetDir).filter((d) => isDir(path.join(targetDir, d)) && /^\d{4}-\d{2}-\d{2}-\d{4}/.test(d)).sort();

  let runDir, run;
  if (from) {
    const id = runId ?? runs[runs.length - 1];
    if (!id) fail(`--from given but no previous run exists for ${name}`);
    runDir = path.join(targetDir, id);
    ({ run } = loadRun(runDir));
    const idx = STAGES.indexOf(from);
    for (const s of STAGES.slice(idx)) run.stages[s] = { status: 'pending' };
    run.options = { ...run.options, from, skip_verify: skipVerify || run.options?.skip_verify || false };
    run.finished_at = null;
    run.resumed_at = now();
  } else {
    let id = stamp();
    let n = 2;
    while (exists(path.join(targetDir, id))) id = `${stamp()}-${n++}`;
    runDir = path.join(targetDir, id);
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    run = {
      schema: 'harness-review/run@1',
      target: { path: posix(root), name },
      run_id: id,
      started_at: now(),
      finished_at: null,
      options: { from: null, skip_verify: skipVerify },
      stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending' }])),
      previous_run: runs.filter((r) => exists(path.join(targetDir, r, 'findings.json'))).pop() ?? null,
      models: {},
    };
  }
  const runPath = path.join(runDir, 'run.json');

  if (!from || from === 'S0') {
    setStage(run, 'S0', { status: 'running', started_at: now() });
    saveRun(runPath, run);
    const result = discover(root, {});
    writeJson(path.join(runDir, 'work', 'discover.json'), result);
    setStage(run, 'S0', { status: 'done', finished_at: now(), files: result.files.length, hooks: result.hooks.length, spawn_hints: result.summary.spawn_hints, memory_hints: result.summary.memory_hints });
  }
  saveRun(runPath, run);
  out({ run_dir: posix(runDir), run_id: run.run_id, target: run.target, previous_run: run.previous_run, options: run.options, stages: run.stages, skill_dir: posix(SKILL_DIR), schemas: posix(path.join(SKILL_DIR, 'schemas.md')), references_dir: posix(path.join(SKILL_DIR, 'references')) });
}

// ---------------------------------------------------------------- plan

function cmdPlan(args) {
  const [runDir, stage, ...rest] = args;
  if (!runDir || !stage) fail('usage: run.mjs plan <run-dir> S1|S2|S4 [--retry]');
  const retry = rest.includes('--retry');
  const { run, runPath } = loadRun(runDir);
  const disc = readJson(path.join(runDir, 'work', 'discover.json'));
  const batches = [];
  const push = (dir, batch, input, agent) => {
    const inputPath = path.join(runDir, 'work', dir, `${batch}.input.json`);
    const outputPath = path.join(runDir, 'work', dir, `${batch}.json`);
    writeJson(inputPath, { schema: 'harness-review/batch-input@1', batch, ...input });
    batches.push({ batch, agent, input: posix(inputPath), output: posix(outputPath) });
  };
  const common = { target_root: run.target.path, schemas: posix(path.join(SKILL_DIR, 'schemas.md')) };

  if (stage === 'S1') {
    let files = disc.files.filter((f) => LLM_KINDS.has(f.kind) && !f.binary_or_large);
    if (retry) {
      const cov = readJson(path.join(runDir, 'work', 'coverage-S1.json'));
      const missing = new Set(cov.missing);
      files = files.filter((f) => missing.has(f.id));
      if (!files.length) fail('nothing to retry for S1');
      chunk(files, S1_BATCH).forEach((fs_, i) => push('extract', `retry-${i + 1}`, { ...common, kind: 'files', files: fs_ }, 'harness-extractor'));
    } else {
      const byKind = {};
      for (const f of files) (byKind[f.kind] ??= []).push(f);
      for (const [kind, list] of Object.entries(byKind)) chunk(list, S1_BATCH).forEach((fs_, i) => push('extract', `${kind}-${i + 1}`, { ...common, kind: 'files', files: fs_ }, 'harness-extractor'));
      const memoryHints = [];
      for (const f of disc.files) for (const h of f.hints.memory) memoryHints.push({ file: f.id, path: f.path, ...h });
      push('extract', 'memory-1', { ...common, kind: 'memory', files: [], memory_candidates: disc.memory_candidates, memory_hints: memoryHints, top_level: disc.target.top_level }, 'harness-extractor');
    }
  } else if (stage === 'S2') {
    const harness = readJson(path.join(runDir, 'harness.json'));
    const agents = harness.files.filter((f) => f.kind === 'agent').map((f) => ({ id: f.id, description: f.frontmatter?.description ?? null, summary: f.summary ?? null }));
    const skills = harness.files.filter((f) => f.kind === 'skill').map((f) => ({ id: f.id, description: f.frontmatter?.description ?? null, summary: f.summary ?? null }));
    const entries = harness.files.filter((f) => ENTRY_KINDS.has(f.kind));
    const knownFlows = entries.map((f) => f.id);
    const base = { ...common, known_flows: knownFlows, agents, skills };
    if (retry) {
      const cov = readJson(path.join(runDir, 'work', 'coverage-S2.json'));
      if (!cov.unclassified.length) fail('nothing to retry for S2');
      const flows = readJson(path.join(runDir, 'flows.json'));
      push('flows', 'retry-1', { ...base, kind: 'hints', hints: cov.unclassified, existing_flows: flows.flows.map((f) => ({ id: f.id, name: f.name, kind: f.kind, defined_in: f.defined_in, steps: f.steps.map((s) => ({ n: s.n, actor: s.actor, action: s.action })) })) }, 'flow-extractor');
    } else {
      chunk(entries, S2_BATCH).forEach((es, i) => push('flows', `entries-${i + 1}`, { ...base, kind: 'entries', entries: es }, 'flow-extractor'));
      const hookScripts = harness.files.filter((f) => f.kind === 'hook-script');
      if (harness.hooks.length || hookScripts.length) push('flows', 'hooks-1', { ...base, kind: 'hooks', entries: hookScripts, hooks: harness.hooks }, 'flow-extractor');
      const implicit = harness.files.filter((f) => f.kind === 'claude-md' || f.kind === 'import' || (f.kind === 'rule' && f.load === 'always'));
      if (implicit.length) push('flows', 'implicit-1', { ...base, kind: 'implicit', entries: implicit }, 'flow-extractor');
    }
  } else if (stage === 'S4') {
    if (run.options.skip_verify) { out({ batches: [], skipped: true }); return; }
    const all = readJson(path.join(runDir, 'work', 'review', 'all.json'));
    const groups = new Map();
    for (const f of all.findings) {
      const key = f.evidence?.[0]?.file ?? f.target?.id ?? 'misc';
      (groups.get(key) ?? groups.set(key, []).get(key)).push(f);
    }
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length).flat();
    chunk(ordered, S4_BATCH).forEach((fs_, i) => push('verify', `verify-${i + 1}`, { ...common, findings: fs_, references_dir: posix(path.join(SKILL_DIR, 'references')) }, 'finding-verifier'));
  } else fail(`plan: unsupported stage ${stage}`);

  setStage(run, stage, { status: 'running', started_at: run.stages[stage]?.started_at ?? now(), batches: (run.stages[stage]?.batches ?? 0) + batches.length });
  saveRun(runPath, run);
  out({ stage, batches });
}

// ---------------------------------------------------------------- merge S1

function mergeS1(runDir, run, runPath) {
  const disc = readJson(path.join(runDir, 'work', 'discover.json'));
  const extracted = new Map();
  let memoryAssessment = [];
  for (const p of listJson(path.join(runDir, 'work', 'extract'))) {
    const b = readJson(p);
    for (const f of b.files ?? []) extracted.set(f.id, f);
    if (b.memory_assessment) memoryAssessment = memoryAssessment.concat(b.memory_assessment);
  }
  const eligible = disc.files.filter((f) => LLM_KINDS.has(f.kind) && !f.binary_or_large).map((f) => f.id);
  const missing = eligible.filter((id) => !extracted.has(id));
  const files = disc.files.map((f) => {
    const e = extracted.get(f.id);
    return e ? { ...f, summary: e.summary ?? null, purpose: e.purpose ?? null, content_mix: e.content_mix ?? null, opening: e.opening ?? null, audience: e.audience ?? [], memory_ops: e.memory_ops ?? [], facts: e.facts ?? [] } : { ...f, memory_ops: [], facts: [] };
  });

  // memory: assessed candidates + any target that files write/read
  const mem = new Map();
  const harnessPaths = new Set(disc.files.map((f) => f.path));
  const ensure = (p, seed) => {
    const k = canonicalTarget(p);
    if (!mem.has(k)) mem.set(k, { id: `memory:${k}`, path: k, spellings: [], kind: 'unknown', lifecycle: 'unknown', exists: null, is_dir: null, is_pattern: k.includes('*'), is_harness_file: harnessPaths.has(k), assessed: false, description: null, writers: [], readers: [] });
    const m = mem.get(k);
    const spelling = normalizeTarget(p);
    if (!m.spellings.includes(spelling)) m.spellings.push(spelling);
    Object.assign(m, seed);
    return m;
  };
  for (const a of memoryAssessment) {
    if (a.is_memory === false && a.kind === 'not-memory') continue;
    const cand = disc.memory_candidates.find((c) => normalizeTarget(c.path) === normalizeTarget(a.path));
    ensure(a.path, { kind: a.kind ?? 'memory', lifecycle: a.lifecycle ?? 'unknown', description: a.description ?? null, exists: cand ? true : exists(path.join(run.target.path, a.path)), is_dir: cand?.is_dir ?? null, is_memory: a.is_memory !== false, assessed: true });
  }
  for (const f of files) for (const op of f.memory_ops) {
    if (!op.target) continue;
    const m = ensure(op.target, {});
    if (m.exists === null && !m.is_pattern) m.exists = exists(path.join(run.target.path, normalizeTarget(op.target)));
    const rec = { file: f.id, line: op.line ?? null, trigger: op.trigger ?? null, what: op.what ?? null };
    if (op.direction === 'write' || op.direction === 'both') m.writers.push(rec);
    if (op.direction === 'read' || op.direction === 'both') m.readers.push(rec);
  }
  const memory = [...mem.values()].sort((a, b) => a.path.localeCompare(b.path));
  const memLike = memory.filter((m) => !m.is_harness_file && m.is_memory !== false);
  const memSummary = {
    has_custom_memory: memLike.some((m) => m.writers.length || m.readers.length),
    count: memLike.length,
    write_only: memLike.filter((m) => m.writers.length && !m.readers.length).map((m) => m.id),
    read_only: memLike.filter((m) => m.readers.length && !m.writers.length).map((m) => m.id),
    adr_like: memLike.filter((m) => m.kind === 'decision-record').map((m) => m.id),
    missing_targets: memLike.filter((m) => m.exists === false).map((m) => m.id),
    harness_files_referenced: memory.filter((m) => m.is_harness_file).map((m) => m.id),
  };
  const harness = {
    schema: 'harness-review/harness@1',
    target: disc.target,
    summary: { ...disc.summary, memory: memSummary },
    files, hooks: disc.hooks, permissions: disc.permissions, settings: disc.settings, mcp_servers: disc.mcp_servers,
    memory, memory_candidates: disc.memory_candidates, unknown_claude_files: disc.unknown_claude_files, notes: disc.notes,
    coverage: { discovered: eligible.length, extracted: eligible.length - missing.length, missing },
  };
  writeJson(path.join(runDir, 'harness.json'), harness);
  writeJson(path.join(runDir, 'work', 'coverage-S1.json'), harness.coverage);
  setStage(run, 'S1', { status: missing.length ? 'running' : 'done', finished_at: missing.length ? null : now(), coverage: harness.coverage });
  saveRun(runPath, run);
  out({ stage: 'S1', harness: posix(path.join(runDir, 'harness.json')), coverage: harness.coverage, memory: memSummary });
  if (missing.length) process.exit(3);
}

// ---------------------------------------------------------------- merge S2

function mergeS2(runDir, run, runPath) {
  const harness = readJson(path.join(runDir, 'harness.json'));
  let flows = [], notFlows = [], attribution = [];
  for (const p of listJson(path.join(runDir, 'work', 'flows'))) {
    const b = readJson(p);
    flows = flows.concat(b.flows ?? []);
    notFlows = notFlows.concat(b.not_flows ?? []);
    attribution = attribution.concat(b.hint_attribution ?? []);
  }
  // unique ids
  const seen = new Map();
  for (const f of flows) { const base = f.id || `flow:${sha(f.name ?? '').slice(0, 6)}`; const n = seen.get(base) ?? 0; seen.set(base, n + 1); f.id = n ? `${base}-${n + 1}` : base; }
  const ids = new Set(flows.map((f) => f.id));
  const byEntry = new Map();
  for (const f of flows) for (const d of f.defined_in ?? []) { const fid = harness.files.find((x) => x.path === d.file)?.id; if (fid) (byEntry.get(fid) ?? byEntry.set(fid, []).get(fid)).push(f.id); }
  // resolve calls
  const graph = [];
  for (const f of flows) for (const c of f.calls ?? []) {
    let to = c.flow;
    if (to && !ids.has(to)) {
      const name = to.replace(/^(flow:|unresolved:)/, '');
      const hit = flows.find((x) => x.id === `flow:${name}` || x.name === name) ?? (byEntry.get(`skill:${name}`)?.[0] ? { id: byEntry.get(`skill:${name}`)[0] } : null);
      to = hit ? hit.id : `unresolved:${name}`;
      c.flow = to;
    }
    graph.push({ from: f.id, to, step: c.step ?? null });
  }
  // hint attribution coverage
  const key = (file, line) => `${file}#${line}`;
  const attributed = new Map();
  for (const a of attribution) { const k = key(a.file, a.line); const prev = attributed.get(k); if (!prev || (prev.status === 'unclassified' && a.status !== 'unclassified')) attributed.set(k, a); }
  const allHints = [];
  for (const f of harness.files) for (const h of f.hints.spawn) allHints.push({ file: f.id, path: f.path, line: h.line, kinds: h.kinds, text: h.text });
  const items = allHints.map((h) => { const a = attributed.get(key(h.file, h.line)); return a ? { ...h, status: a.status, flow: a.flow ?? null, step: a.step ?? null, reason: a.reason ?? null } : { ...h, status: 'unclassified', flow: null, step: null, reason: 'not mentioned by any flow-extractor output' }; });
  const counts = { attributed: 0, noise: 0, unclassified: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const unclassified = items.filter((i) => i.status === 'unclassified');
  // entries coverage
  const entries = harness.files.filter((f) => ENTRY_KINDS.has(f.kind)).map((f) => f.id);
  const notFlowIds = new Set(notFlows.map((n) => n.entry));
  const entriesWithoutFlow = entries.filter((id) => !byEntry.has(id) && !notFlowIds.has(id));
  const byKind = {};
  for (const f of flows) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const result = {
    schema: 'harness-review/flows@1',
    summary: { total: flows.length, by_kind: byKind, with_review_points: flows.filter((f) => f.review_points?.length).length, with_judgment_points: flows.filter((f) => f.judgment_points?.length).length, entries: entries.length, entries_without_flow: entriesWithoutFlow, not_flows: notFlows.length },
    flows, not_flows: notFlows, graph,
    hint_attribution: { ...counts, total: items.length, items },
  };
  writeJson(path.join(runDir, 'flows.json'), result);
  const coverage = { hints: items.length, ...counts, unclassified, entries_without_flow: entriesWithoutFlow };
  writeJson(path.join(runDir, 'work', 'coverage-S2.json'), coverage);
  const retried = exists(path.join(runDir, 'work', 'flows', 'retry-1.json'));
  const gap = (unclassified.length > 0 && !retried) || entriesWithoutFlow.length > 0;
  setStage(run, 'S2', { status: gap ? 'running' : 'done', finished_at: gap ? null : now(), coverage: { hints: items.length, ...counts, entries_without_flow: entriesWithoutFlow.length } });
  saveRun(runPath, run);
  out({ stage: 'S2', flows: posix(path.join(runDir, 'flows.json')), summary: result.summary, hint_attribution: { total: items.length, ...counts }, entries_without_flow: entriesWithoutFlow, retried });
  if (gap) process.exit(3);
}

// ---------------------------------------------------------------- merge S3 (assign ids)

function normalizeClaim(s) { return String(s ?? '').toLowerCase().replace(/[\s\p{P}]+/gu, '').slice(0, 80); }
function findingId(f) { return `${f.check ?? f.axis}-${sha(`${f.axis}|${f.target?.id ?? ''}|${normalizeClaim(f.claim)}`).slice(0, 6)}`; }

function mergeS3(runDir, run, runPath) {
  const dir = path.join(runDir, 'work', 'review');
  const checks = loadChecks();
  const checkAxis = new Map(checks.map((c) => [c.id, c.axis]));
  let findings = [], passes = [], na = [];
  const axesDone = [];
  for (const ax of AXES) {
    const p = path.join(dir, `${ax}.json`);
    if (!exists(p)) continue;
    const b = readJson(p);
    axesDone.push(ax);
    // the file's axis is authoritative; a reviewer-written axis is ignored for findings, passes and na alike
    findings = findings.concat((b.findings ?? []).map((f) => ({ ...f, axis: ax })));
    passes = passes.concat((b.passes ?? []).map((x) => ({ ...x, axis: ax })));
    na = na.concat((b.na ?? []).map((x) => ({ ...x, axis: ax })));
  }

  // Deterministic validation of S3 output (C7): what the reviewer prompt asks for in prose is checked here.
  const invalid = [];
  const validateFinding = (f) => {
    const reasons = [];
    if (!f.check || !checkAxis.has(f.check)) reasons.push(`unknown check id: ${f.check ?? '(none)'}`);
    else if (checkAxis.get(f.check) !== f.axis) reasons.push(`check ${f.check} does not belong to axis ${f.axis}`);
    if (!(f.severity in SEVERITY_ORDER)) reasons.push(`invalid severity: ${f.severity ?? '(none)'}`);
    if (!BASES.has(f.basis)) reasons.push(`invalid basis: ${f.basis ?? '(none)'}`);
    if (!f.target || (!f.target.id && f.target.type !== 'harness')) reasons.push('target.id missing');
    if (!Array.isArray(f.evidence) || !f.evidence.length) reasons.push('evidence missing');
    else if (!f.evidence.every((e) => e && e.file && e.quote)) reasons.push('every evidence needs file and quote');
    if (!f.claim || !String(f.claim).trim()) reasons.push('claim missing');
    if (!f.proposal || !f.proposal.summary || !String(f.proposal.summary).trim()) reasons.push('proposal.summary missing');
    return reasons;
  };
  findings = findings.filter((f) => {
    const reasons = validateFinding(f);
    if (reasons.length) { invalid.push({ axis: f.axis, check: f.check ?? null, target: f.target ?? null, claim: f.claim ?? null, reasons }); return false; }
    return true;
  });
  const badCheck = (x) => !x.check || checkAxis.get(x.check) !== x.axis;
  const invalidPasses = passes.filter(badCheck).length, invalidNa = na.filter(badCheck).length;
  passes = passes.filter((x) => !badCheck(x));
  na = na.filter((x) => !badCheck(x));

  // Retry bookkeeping: snapshot an axis file the first time it has invalid findings, and warn if a rewrite lost findings.
  const merges = (run.stages.S3?.merges ?? 0) + 1;
  const invalidAxes = [...new Set(invalid.map((i) => i.axis))];
  const warnings = [];
  for (const ax of axesDone) {
    const snap = path.join(dir, `${ax}.attempt1.json`);
    const validCount = findings.filter((f) => f.axis === ax).length;
    if (exists(snap)) {
      const prev = readJson(snap).valid_findings ?? 0;
      if (validCount < prev) warnings.push(`axis ${ax}: valid findings decreased from ${prev} to ${validCount} after retry (see ${posix(snap)})`);
    } else if (invalidAxes.includes(ax)) {
      fs.copyFileSync(path.join(dir, `${ax}.json`), snap);
      const s = readJson(snap); s.valid_findings = validCount; writeJson(snap, s);
    }
  }
  const validationPath = path.join(dir, 'validation.json');
  writeJson(validationPath, { schema: 'harness-review/review-validation@1', merges, invalid_findings: invalid, invalid_passes: invalidPasses, invalid_na: invalidNa, warnings });

  const seen = new Set();
  for (const f of findings) { let id = findingId(f); let n = 2; while (seen.has(id)) id = `${findingId(f)}-${n++}`; seen.add(id); f.id = id; }
  const all = { schema: 'harness-review/review-all@1', axes: axesDone, findings, passes, na };
  writeJson(path.join(dir, 'all.json'), all);
  const missingAxes = AXES.filter((a) => !axesDone.includes(a));
  const bySev = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
  // One retry for invalid findings: after the second merge, remaining invalid ones stay excluded and S3 completes.
  const gap = missingAxes.length > 0 || (invalid.length > 0 && merges < 2);
  setStage(run, 'S3', { status: gap ? 'running' : 'done', finished_at: gap ? null : now(), merges, findings: findings.length, passes: passes.length, na: na.length, axes: axesDone, invalid_findings: invalid.length });
  saveRun(runPath, run);
  out({ stage: 'S3', all: posix(path.join(dir, 'all.json')), axes: axesDone, missing_axes: missingAxes, findings: findings.length, by_severity: bySev, passes: passes.length, na: na.length, merges, invalid: { findings: invalid.length, axes: invalidAxes, passes: invalidPasses, na: invalidNa, retry: gap && invalid.length > 0 }, warnings, validation: posix(validationPath) });
  if (gap) process.exit(3);
}

// ---------------------------------------------------------------- merge S4 (findings.json / verification.json)

function loadChecks() {
  const checks = [];
  const dir = path.join(SKILL_DIR, 'references');
  for (const ax of AXES) {
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${ax}-`) && f.endsWith('.md'));
    if (!file) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\|\s*([A-E]\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(official|custom)\s*\|/);
      if (m) checks.push({ id: m[1], axis: ax, title: m[2], severity_hint: m[3], basis: m[4], reference: `references/${file}` });
    }
  }
  return checks;
}

function mergeS4(runDir, run, runPath) {
  const all = readJson(path.join(runDir, 'work', 'review', 'all.json'));
  const verdicts = new Map();
  for (const p of listJson(path.join(runDir, 'work', 'verify'))) for (const r of readJson(p).results ?? []) verdicts.set(r.finding_id, r);
  const skip = run.options.skip_verify;
  const unverified = [];
  const kept = [], rejected = [];
  for (const f of all.findings) {
    const v = verdicts.get(f.id);
    if (skip) { kept.push({ ...f, verification: { verdict: 'UNVERIFIED', note: 'skip-verify' } }); continue; }
    if (!v) { unverified.push(f.id); kept.push({ ...f, verification: { verdict: 'UNVERIFIED', note: 'no verifier result' } }); continue; }
    const verification = { verdict: v.verdict, evidence_check: v.evidence_check ?? null, claim_check: v.claim_check ?? null, proposal_check: v.proposal_check ?? null, note: v.note ?? null };
    if (v.verdict === 'REJECTED') rejected.push({ finding: f, ...verification }); else kept.push({ ...f, verification });
  }
  // previous run comparison
  const targetDir = path.dirname(runDir);
  const prevId = run.previous_run;
  let prev = null;
  if (prevId && exists(path.join(targetDir, prevId, 'findings.json'))) prev = readJson(path.join(targetDir, prevId, 'findings.json'));
  const prevIds = new Set(prev?.findings?.map((f) => f.id) ?? []);
  const curIds = new Set(kept.map((f) => f.id));
  for (const f of kept) f.status = prev ? (prevIds.has(f.id) ? 'continued' : 'new') : 'new';
  const resolved = prev ? prev.findings.filter((f) => !curIds.has(f.id)).map((f) => ({ id: f.id, axis: f.axis, severity: f.severity, target: f.target, claim: f.claim })) : [];
  // matrix: per axis, only the targets that axis's reviewer touched × that axis's checks
  const checks = loadChecks();
  const targets = new Map();
  const tkey = (t) => t?.id ?? 'harness';
  const touched = {}; // axis -> Set of target keys
  for (const x of [...kept, ...rejected.map((r) => r.finding), ...all.passes, ...all.na]) {
    const k = tkey(x.target);
    if (!targets.has(k)) targets.set(k, { id: k, type: x.target?.type ?? 'harness' });
    (touched[x.axis] ??= new Set()).add(k);
  }
  const cells = [];
  for (const c of checks) for (const t of touched[c.axis] ?? []) {
    const fs_ = kept.filter((f) => tkey(f.target) === t && f.check === c.id).map((f) => f.id);
    const rj = rejected.filter((r) => tkey(r.finding.target) === t && r.finding.check === c.id).length;
    const ps = all.passes.some((p) => tkey(p.target) === t && p.check === c.id);
    const nn = all.na.some((p) => tkey(p.target) === t && p.check === c.id);
    const status = fs_.length ? 'finding' : ps ? 'pass' : nn ? 'na' : rj ? 'rejected-only' : 'unchecked';
    cells.push({ target: t, check: c.id, axis: c.axis, status, finding_ids: fs_ });
  }
  kept.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.axis.localeCompare(b.axis) || a.id.localeCompare(b.id));
  const count = (arr, k) => arr.reduce((m, x) => { m[x[k]] = (m[x[k]] ?? 0) + 1; return m; }, {});
  const findings = {
    schema: 'harness-review/findings@1',
    target: run.target, run_id: run.run_id, generated_at: now(),
    summary: {
      by_severity: count(kept, 'severity'), by_axis: count(kept, 'axis'), by_verdict: count(kept.map((f) => ({ v: f.verification.verdict })), 'v'), by_basis: count(kept, 'basis'),
      vs_previous: { previous_run: prevId, resolved: resolved.length, new: kept.filter((f) => f.status === 'new').length, continued: kept.filter((f) => f.status === 'continued').length },
      matrix: count(cells, 'status'),
    },
    findings: kept, resolved,
    matrix: { checks, targets: [...targets.values()], cells },
  };
  writeJson(path.join(runDir, 'findings.json'), findings);
  const s1 = exists(path.join(runDir, 'work', 'coverage-S1.json')) ? readJson(path.join(runDir, 'work', 'coverage-S1.json')) : null;
  const s2 = exists(path.join(runDir, 'work', 'coverage-S2.json')) ? readJson(path.join(runDir, 'work', 'coverage-S2.json')) : null;
  const s3v = exists(path.join(runDir, 'work', 'review', 'validation.json')) ? readJson(path.join(runDir, 'work', 'review', 'validation.json')) : null;
  const verification = {
    schema: 'harness-review/verification@1',
    stage1: s1 ? { discovered: s1.discovered, extracted: s1.extracted, missing: s1.missing } : null,
    stage2: s2 ? { hints: s2.hints, attributed: s2.attributed, noise: s2.noise, unclassified: s2.unclassified, entries_without_flow: s2.entries_without_flow } : null,
    stage3: { axes: all.axes, unchecked_cells: cells.filter((c) => c.status === 'unchecked').length, invalid_findings: s3v?.invalid_findings ?? [], invalid_passes: s3v?.invalid_passes ?? 0, invalid_na: s3v?.invalid_na ?? 0, warnings: s3v?.warnings ?? [] },
    stage4: { skipped: !!skip, total: all.findings.length, confirmed: kept.filter((f) => f.verification.verdict === 'CONFIRMED').length, plausible: kept.filter((f) => f.verification.verdict === 'PLAUSIBLE').length, unverified: unverified.length, rejected },
  };
  writeJson(path.join(runDir, 'verification.json'), verification);
  setStage(run, 'S4', { status: unverified.length && !skip ? 'running' : 'done', finished_at: unverified.length && !skip ? null : now(), ...verification.stage4, rejected: rejected.length });
  saveRun(runPath, run);
  out({ stage: 'S4', findings: posix(path.join(runDir, 'findings.json')), verification: posix(path.join(runDir, 'verification.json')), summary: findings.summary, unverified, rejected: rejected.length });
  if (unverified.length && !skip) process.exit(3);
}

// ---------------------------------------------------------------- misc commands

function cmdMerge(args) {
  const [runDir, stage] = args;
  if (!runDir || !stage) fail('usage: run.mjs merge <run-dir> S1|S2|S3|S4');
  const { run, runPath } = loadRun(runDir);
  if (stage === 'S1') return mergeS1(runDir, run, runPath);
  if (stage === 'S2') return mergeS2(runDir, run, runPath);
  if (stage === 'S3') return mergeS3(runDir, run, runPath);
  if (stage === 'S4') return mergeS4(runDir, run, runPath);
  fail(`merge: unsupported stage ${stage}`);
}

function cmdStatus(args) {
  const { run } = loadRun(args[0] ?? fail('usage: run.mjs status <run-dir>'));
  out(run);
}

function cmdStage(args) {
  const [runDir, stage, status, ...kv] = args;
  if (!runDir || !stage || !status) fail('usage: run.mjs stage <run-dir> <stage> <status> [key=value ...]');
  const { run, runPath } = loadRun(runDir);
  const patch = { status };
  if (status === 'running' && !run.stages[stage]?.started_at) patch.started_at = now();
  if (status === 'done' || status === 'failed' || status === 'skipped') patch.finished_at = now();
  for (const pair of kv) { const [k, v] = pair.split('='); patch[k] = /^\d+$/.test(v) ? Number(v) : v; }
  setStage(run, stage, patch);
  if (stage === 'S5' && status === 'done') run.finished_at = now();
  saveRun(runPath, run);
  out(run.stages[stage]);
}

function cmdSummary(args) {
  const runDir = args[0] ?? fail('usage: run.mjs summary <run-dir>');
  const { run } = loadRun(runDir);
  const h = exists(path.join(runDir, 'harness.json')) ? readJson(path.join(runDir, 'harness.json')) : null;
  const fl = exists(path.join(runDir, 'flows.json')) ? readJson(path.join(runDir, 'flows.json')) : null;
  const fd = exists(path.join(runDir, 'findings.json')) ? readJson(path.join(runDir, 'findings.json')) : null;
  const v = exists(path.join(runDir, 'verification.json')) ? readJson(path.join(runDir, 'verification.json')) : null;
  const lines = [];
  lines.push(`run: ${run.run_id}  target: ${run.target.path}`);
  lines.push(`stages: ${STAGES.map((s) => `${s}=${run.stages[s]?.status ?? '-'}`).join(' ')}`);
  if (h) lines.push(`①: files ${h.files.length} (${Object.entries(h.summary.counts).map(([k, n]) => `${k} ${n}`).join(', ')}), always≈${h.summary.always_loaded_tokens_est} tok, memory ${h.memory.length} (write-only ${h.summary.memory.write_only.length}, read-only ${h.summary.memory.read_only.length})`);
  if (fl) lines.push(`②: flows ${fl.summary.total} (${Object.entries(fl.summary.by_kind).map(([k, n]) => `${k} ${n}`).join(', ')}), review_points in ${fl.summary.with_review_points}, judgment_points in ${fl.summary.with_judgment_points}, hints attributed/noise/unclassified ${fl.hint_attribution.attributed}/${fl.hint_attribution.noise}/${fl.hint_attribution.unclassified}`);
  if (fd) {
    const s = fd.summary;
    lines.push(`③: findings ${fd.findings.length} (must ${s.by_severity.must ?? 0} / should ${s.by_severity.should ?? 0} / nice to have ${s.by_severity['nice to have'] ?? 0}), verdict ${Object.entries(s.by_verdict).map(([k, n]) => `${k} ${n}`).join(', ')}, vs previous: ${s.vs_previous.previous_run ? `resolved ${s.vs_previous.resolved} / new ${s.vs_previous.new} / continued ${s.vs_previous.continued}` : 'first run'}`);
    if (v?.stage4) lines.push(`④: rejected ${v.stage4.rejected.length}, unverified ${v.stage4.unverified}${v.stage4.skipped ? ' (skipped)' : ''}; ③ unchecked cells ${v.stage3?.unchecked_cells ?? '-'}, excluded (invalid format) ${v.stage3?.invalid_findings?.length ?? 0}${v.stage3?.warnings?.length ? ', warnings: ' + v.stage3.warnings.join('; ') : ''}`);
    for (const sev of ['must', 'should']) {
      const list = fd.findings.filter((f) => f.severity === sev);
      if (!list.length) continue;
      lines.push(`--- ${sev} (${list.length})`);
      for (const f of list.slice(0, sev === 'must' ? 20 : 10)) lines.push(`  [${f.id}] ${f.axis}/${f.check} ${f.target?.id ?? 'harness'} — ${String(f.claim).replace(/\s+/g, ' ').slice(0, 140)}`);
      if (list.length > (sev === 'must' ? 20 : 10)) lines.push(`  … +${list.length - (sev === 'must' ? 20 : 10)}`);
    }
  }
  if (run.stages.S5?.report) lines.push(`report: ${posix(path.join(runDir, 'report.html'))}  latest: ${posix(path.join(path.dirname(runDir), 'latest.html'))}`);
  process.stdout.write(lines.join('\n') + '\n');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'init') cmdInit(rest);
else if (cmd === 'summary') cmdSummary(rest);
else if (cmd === 'plan') cmdPlan(rest);
else if (cmd === 'merge') cmdMerge(rest);
else if (cmd === 'status') cmdStatus(rest);
else if (cmd === 'stage') cmdStage(rest);
else fail('usage: run.mjs init|plan|merge|status|stage ...');
