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
const S1_BATCH = 10, S2_BATCH = 5, S4_BATCH = 8, S3_GAPS_BATCH = 40;
// discover file kinds; used to validate `file:<kind>` tokens in the references' 対象 column (ADR-0016)
const FILE_KINDS = new Set(['claude-md', 'import', 'rule', 'skill', 'skill-support', 'command', 'agent', 'settings', 'mcp-config', 'hooks-config', 'hook-script', 'workflow', 'plugin-manifest', 'marketplace-manifest']);
const TARGET_TOKENS = new Set(['file', 'hook', 'memory', 'mcp', 'flow', 'harness']);
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
function normalizeTarget(t) { return posix(String(t)).replace(/^\.\//, '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '').replace(/\/+$/, ''); }
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
  } else if (stage === 'S3') {
    const refDir = path.join(SKILL_DIR, 'references');
    const refFile = (ax) => {
      const f = fs.readdirSync(refDir).find((f) => f.startsWith(`${ax}-`) && f.endsWith('.md'));
      if (!f) throw new Error(`reference document for axis ${ax} not found in ${refDir} (expected ${ax}-*.md)`);
      return f;
    };
    const reviewDir = path.join(runDir, 'work', 'review');
    if (!rest.includes('--gaps')) {
      // ADR-0016: the first pass gets the full cell list (check × universe) so coverage does not depend on prose.
      const harness = readJson(path.join(runDir, 'harness.json'));
      const flows = exists(path.join(runDir, 'flows.json')) ? readJson(path.join(runDir, 'flows.json')) : null;
      const checks = loadChecks();
      for (const ax of AXES) {
        const axChecks = checks.filter((c) => c.axis === ax);
        const cells = [];
        for (const c of axChecks) for (const t of targetUniverse(c.targets, harness, flows)) cells.push({ check: c.id, title: c.title, target: { type: targetType(t), id: t } });
        const inputPath = path.join(reviewDir, `${ax}.input.json`);
        writeJson(inputPath, { schema: 'harness-review/batch-input@1', batch: ax, kind: 'review', axis: ax, reference: posix(path.join(refDir, refFile(ax))), checks: axChecks.map((c) => ({ id: c.id, title: c.title, severity_hint: c.severity_hint, basis: c.basis, targets: c.targets })), cells, ...common, harness_json: posix(path.join(runDir, 'harness.json')), flows_json: posix(path.join(runDir, 'flows.json')) });
        batches.push({ batch: ax, agent: 'harness-reviewer', axis: ax, input: posix(inputPath), output: posix(path.join(reviewDir, `${ax}.json`)), cells: cells.length });
      }
      setStage(run, 'S3', { status: 'running', started_at: run.stages.S3?.started_at ?? now(), batches: batches.length });
      saveRun(runPath, run);
      out({ stage, batches });
      return;
    }
    // --gaps: one gap-fill pass per run, split into batches of S3_GAPS_BATCH cells; outputs go to <axis>.gaps-<n>.json
    if (run.stages.S3?.gap_fill) { out({ stage, batches: [], note: `gap fill already ${run.stages.S3.gap_fill}; not planning again` }); return; }
    const gapsPath = path.join(reviewDir, 'gaps.json');
    if (!exists(gapsPath)) fail('no gaps.json yet: run merge S3 first');
    const gaps = readJson(gapsPath);
    for (const ax of AXES) {
      const cells = gaps.cells.filter((c) => c.axis === ax);
      if (!cells.length) continue;
      chunk(cells, S3_GAPS_BATCH).forEach((part, i) => {
        const n = i + 1;
        const inputPath = path.join(reviewDir, `gaps-${ax}-${n}.input.json`);
        const outputPath = path.join(reviewDir, `${ax}.gaps-${n}.json`);
        writeJson(inputPath, { schema: 'harness-review/batch-input@1', batch: `gaps-${ax}-${n}`, kind: 'gaps', axis: ax, reference: posix(path.join(refDir, refFile(ax))), existing_output: exists(path.join(reviewDir, `${ax}.json`)) ? posix(path.join(reviewDir, `${ax}.json`)) : null, cells: part, ...common });
        batches.push({ batch: `gaps-${ax}-${n}`, agent: 'harness-reviewer', axis: ax, input: posix(inputPath), output: posix(outputPath), cells: part.length });
      });
    }
    setStage(run, 'S3', { status: 'running', gap_fill: 'planned', gap_fill_batches: batches.length });
    saveRun(runPath, run);
    out({ stage, batches, gaps: gaps.by_axis });
    return;
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
  const judgmentNotes = []; // extractor's self-reported discretionary choices (ADR-0015)
  const judgmentNotesMissing = []; // batches whose output has no judgment_notes key at all (unrecorded ≠ zero)
  for (const p of listJson(path.join(runDir, 'work', 'extract'))) {
    const b = readJson(p);
    const batch = b.batch ?? path.basename(p, '.json');
    for (const f of b.files ?? []) extracted.set(f.id, f);
    if (b.memory_assessment) memoryAssessment = memoryAssessment.concat(b.memory_assessment);
    if (!Array.isArray(b.judgment_notes)) judgmentNotesMissing.push(batch);
    else for (const n of b.judgment_notes) judgmentNotes.push({ batch, ...n });
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
  // Derived (script-detected) discretionary choices: memory hints from discover that the extractor did not turn into a
  // memory_op on the same line. Only files the extractor actually processed count; an unprocessed file's hints were never
  // judged. Upper bound: a memory_op recorded on a neighbouring line still shows the hint as dropped.
  const droppedMemoryHints = [];
  for (const f of files) {
    if (!extracted.has(f.id)) continue;
    const opLines = new Set((f.memory_ops ?? []).map((o) => o.line).filter((l) => l != null));
    for (const h of f.hints?.memory ?? []) if (!opLines.has(h.line)) droppedMemoryHints.push({ file: f.id, line: h.line, direction: h.direction, text: h.text });
  }
  const harness = {
    schema: 'harness-review/harness@1',
    target: disc.target,
    judgment_notes: judgmentNotes,
    judgment_notes_missing: judgmentNotesMissing,
    derived_judgments: { dropped_memory_hints: droppedMemoryHints },
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
  const judgmentNotes = []; // extractor's self-reported discretionary choices (ADR-0015)
  const judgmentNotesMissing = [];
  for (const p of listJson(path.join(runDir, 'work', 'flows'))) {
    const b = readJson(p);
    const batch = b.batch ?? path.basename(p, '.json');
    flows = flows.concat(b.flows ?? []);
    notFlows = notFlows.concat(b.not_flows ?? []);
    attribution = attribution.concat(b.hint_attribution ?? []);
    if (!Array.isArray(b.judgment_notes)) judgmentNotesMissing.push(batch);
    else for (const n of b.judgment_notes) judgmentNotes.push({ batch, ...n });
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
    judgment_notes: judgmentNotes,
    judgment_notes_missing: judgmentNotesMissing,
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
    // the file's axis is authoritative; a reviewer-written axis is ignored for findings, passes and na alike
    const norm = (x) => ({ ...x, target: asTargetObject(x.target), axis: ax });
    const p = path.join(dir, `${ax}.json`);
    if (exists(p)) {
      const b = readJson(p);
      axesDone.push(ax);
      findings = findings.concat((b.findings ?? []).map(norm));
      passes = passes.concat((b.passes ?? []).map(norm));
      na = na.concat((b.na ?? []).map(norm));
    }
    // gap-fill output (ADR-0016) lives in separate files (<axis>.gaps-<n>.json) so the original review is never rewritten.
    // It is read even when <axis>.json is missing (an axis that stayed missing after its retry is filled cell by cell).
    // Deduplication against the original review happens AFTER validation (see below), so a cell whose original entry
    // was excluded as invalid can still be filled by the gap-fill pass.
    for (const gp of listJson(dir).filter((p) => new RegExp(`[\\\\/]${ax}\\.gaps(-\\d+)?\\.json$`).test(p))) {
      const g = readJson(gp);
      findings = findings.concat((g.findings ?? []).map(norm).map((f) => ({ ...f, source: 'gap-fill' })));
      passes = passes.concat((g.passes ?? []).map(norm).map((x) => ({ ...x, source: 'gap-fill' })));
      na = na.concat((g.na ?? []).map(norm).map((x) => ({ ...x, source: 'gap-fill' })));
    }
  }
  // 対象 column vocabulary (ADR-0016): an unknown token would silently shrink a check's universe to nothing.
  const vocabWarnings = [];
  for (const c of checks) for (const tok of invalidTargetTokens(c.targets)) vocabWarnings.push(`${c.id}: unknown 対象 token "${tok}" in ${c.reference}`);

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
  // pass needs a note, na needs a reason: the only trace of what the reviewer looked at (ADR-0006, ADR-0016)
  const badCheck = (x) => !x.check || checkAxis.get(x.check) !== x.axis || !x.target?.id;
  const badPass = (x) => badCheck(x) || !x.note || !String(x.note).trim();
  const badNa = (x) => badCheck(x) || !x.reason || !String(x.reason).trim();
  const invalidPasses = passes.filter(badPass).length, invalidNa = na.filter(badNa).length;
  passes = passes.filter((x) => !badPass(x));
  na = na.filter((x) => !badNa(x));

  // Gap-fill vs original: after validation, the original review wins for a cell it (validly) covered; gap-fill fills the rest.
  const cellKey = (x) => `${x.axis}|${targetKey(x.target)}|${x.check}`;
  const covered = new Set([...findings, ...passes, ...na].filter((x) => x.source !== 'gap-fill').map(cellKey));
  const keepGapFill = (x) => { if (x.source !== 'gap-fill') return true; const k = cellKey(x); if (covered.has(k)) return false; covered.add(k); return true; };
  findings = findings.filter(keepGapFill);
  passes = passes.filter(keepGapFill);
  na = na.filter(keepGapFill);

  // Retry bookkeeping: snapshot an axis file the first time it has invalid findings, and warn if a rewrite lost findings.
  // The merge that follows a gap-fill pass does not consume the invalid-finding retry budget (ADR-0016).
  const gapFillMerge = run.stages.S3?.gap_fill === 'planned';
  const merges = gapFillMerge ? (run.stages.S3?.merges ?? 1) : (run.stages.S3?.merges ?? 0) + 1;
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
  warnings.push(...vocabWarnings);
  const validationPath = path.join(dir, 'validation.json');
  writeJson(validationPath, { schema: 'harness-review/review-validation@1', merges, invalid_findings: invalid, invalid_passes: invalidPasses, invalid_na: invalidNa, warnings });

  const seen = new Set();
  for (const f of findings) { let id = findingId(f); let n = 2; while (seen.has(id)) id = `${findingId(f)}-${n++}`; seen.add(id); f.id = id; }
  const all = { schema: 'harness-review/review-all@1', axes: axesDone, findings, passes, na };
  writeJson(path.join(dir, 'all.json'), all);

  // Unchecked cells per axis (ADR-0016): universe from the 対象 column minus what the reviewers filled.
  const hx = exists(path.join(runDir, 'harness.json')) ? readJson(path.join(runDir, 'harness.json')) : null;
  const fx = exists(path.join(runDir, 'flows.json')) ? readJson(path.join(runDir, 'flows.json')) : null;
  const { cells } = buildMatrix({ checks, harness: hx, flows: fx, findings, passes, na });
  const gapCells = cells.filter((c) => c.status === 'unchecked').map((c) => ({ axis: c.axis, check: c.check, title: checks.find((k) => k.id === c.check)?.title ?? '', target: { type: targetType(c.target), id: c.target } }));
  const gapsByAxis = {};
  for (const g of gapCells) gapsByAxis[g.axis] = (gapsByAxis[g.axis] ?? 0) + 1;
  writeJson(path.join(dir, 'gaps.json'), { schema: 'harness-review/review-gaps@1', merges, by_axis: gapsByAxis, total: gapCells.length, cells: gapCells });
  const missingAxes = AXES.filter((a) => !axesDone.includes(a));
  const bySev = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
  // One retry for missing axes and for invalid findings: after the second merge, a still-missing axis has all its cells
  // unchecked (they go to the gap-fill batches), and remaining invalid ones stay excluded.
  const missingRetry = missingAxes.length > 0 && merges < 2 && !gapFillMerge;
  const invalidRetry = invalid.length > 0 && merges < 2 && !gapFillMerge;
  // One gap-fill pass per run (ADR-0016): exit 3 once so the orchestrator plans it; after that, remaining gaps are informational.
  const gapFillState = gapFillMerge ? 'done' : (run.stages.S3?.gap_fill ?? null);
  const needGapFill = gapCells.length > 0 && !gapFillState && !invalidRetry && !missingRetry;
  const gap = missingRetry || invalidRetry || needGapFill;
  setStage(run, 'S3', { status: gap ? 'running' : 'done', finished_at: gap ? null : now(), merges, gap_fill: gapFillState, findings: findings.length, passes: passes.length, na: na.length, axes: axesDone, missing_axes: missingAxes, invalid_findings: invalid.length, unchecked_cells: gapCells.length });
  saveRun(runPath, run);
  out({ stage: 'S3', all: posix(path.join(dir, 'all.json')), axes: axesDone, missing_axes: missingAxes, missing_retry: missingRetry, findings: findings.length, by_severity: bySev, passes: passes.length, na: na.length, merges, invalid: { findings: invalid.length, axes: invalidAxes, passes: invalidPasses, na: invalidNa, retry: invalidRetry }, warnings, validation: posix(validationPath), gaps: { total: gapCells.length, by_axis: gapsByAxis, gap_fill: gapFillState, retry: needGapFill, file: posix(path.join(dir, 'gaps.json')) } });
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
      // | ID | チェック | severity 目安 | basis | 対象 |   (対象 column is optional; ADR-0016)
      const m = line.match(/^\|\s*([A-E]\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(official|custom)\s*\|(?:\s*(.+?)\s*\|)?/);
      if (m) checks.push({ id: m[1], axis: ax, title: m[2], severity_hint: m[3], basis: m[4], targets: m[5] ? m[5].trim() : null, reference: `references/${file}` });
    }
  }
  return checks;
}

// ---------------------------------------------------------------- review matrix (ADR-0016)

// Normalize a finding/pass/na target to a matrix row key. Step targets (flow:x#3) fold into their flow.
function targetKey(t) {
  const id = t?.id ?? 'harness';
  return /^flow:.*#\d+$/.test(id) ? id.split('#')[0] : id;
}
function targetType(id) {
  if (id === 'harness') return 'harness';
  for (const p of ['flow', 'memory', 'hook', 'mcp']) if (id.startsWith(`${p}:`)) return p;
  return 'file';
}

// Unknown tokens in a 対象 column would silently produce an empty universe (= "everything checked"); report them instead.
function invalidTargetTokens(spec) {
  return String(spec ?? '').split('/').map((s) => s.trim()).filter(Boolean).filter((tok) => !(TARGET_TOKENS.has(tok) || (tok.startsWith('file:') && FILE_KINDS.has(tok.slice(5)))));
}

// Accept `target` as `{type,id}` or as a bare id string (gap-fill cells are handed out as objects, but be tolerant).
function asTargetObject(t) {
  if (typeof t === 'string') return { type: targetType(t), id: t };
  return t;
}

// All targets a check applies to, from its 対象 column (`file`, `file:<kind>`, `hook`, `memory`, `mcp`, `flow`, `harness`, joined by ` / `).
function targetUniverse(spec, harness, flows) {
  const ids = new Set();
  for (const tok of String(spec ?? '').split('/').map((s) => s.trim()).filter(Boolean)) {
    if (tok === 'harness') { ids.add('harness'); }
    else if (tok === 'hook') { for (const h of harness?.hooks ?? []) ids.add(h.id); }
    else if (tok === 'mcp') { for (const m of harness?.mcp_servers ?? []) ids.add(`mcp:${m.name}`); }
    else if (tok === 'memory') { for (const m of harness?.memory ?? []) { if (!m.is_harness_file) ids.add(m.id); } }
    else if (tok === 'flow') { for (const f of flows?.flows ?? []) ids.add(f.id); }
    else if (tok === 'file') { for (const f of harness?.files ?? []) { if (!f.binary_or_large) ids.add(f.id); } }
    else if (tok.startsWith('file:')) { const kind = tok.slice(5); for (const f of harness?.files ?? []) { if (f.kind === kind && !f.binary_or_large) ids.add(f.id); } }
  }
  return ids;
}

// Cells = (check × its universe) ∪ (check × targets that actually have an entry for it). Without a 対象 column, the
// universe falls back to the targets the axis's reviewer touched (pre-ADR-0016 behaviour).
function buildMatrix({ checks, harness, flows, findings, rejected = [], passes, na }) {
  const entries = [...findings, ...rejected, ...passes, ...na];
  const touched = {};
  for (const x of entries) (touched[x.axis] ??= new Set()).add(targetKey(x.target));
  const cells = [], targets = new Map();
  for (const c of checks) {
    const universe = c.targets ? targetUniverse(c.targets, harness, flows) : new Set(touched[c.axis] ?? []);
    const withEntries = entries.filter((x) => x.check === c.id).map((x) => targetKey(x.target));
    for (const t of new Set([...universe, ...withEntries])) {
      const fs_ = findings.filter((f) => targetKey(f.target) === t && f.check === c.id).map((f) => f.id ?? null);
      const rj = rejected.filter((r) => targetKey(r.target) === t && r.check === c.id).length;
      const ps = passes.some((p) => targetKey(p.target) === t && p.check === c.id);
      const nn = na.some((p) => targetKey(p.target) === t && p.check === c.id);
      const status = fs_.length ? 'finding' : ps ? 'pass' : nn ? 'na' : rj ? 'rejected-only' : 'unchecked';
      cells.push({ target: t, check: c.id, axis: c.axis, status, finding_ids: fs_, in_universe: universe.has(t) });
      if (!targets.has(t)) targets.set(t, { id: t, type: targetType(t) });
    }
  }
  return { cells, targets: [...targets.values()] };
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
  // matrix (ADR-0016): check × its target universe (from the 対象 column), plus any target that has an entry
  const checks = loadChecks();
  const hx = exists(path.join(runDir, 'harness.json')) ? readJson(path.join(runDir, 'harness.json')) : null;
  const fx = exists(path.join(runDir, 'flows.json')) ? readJson(path.join(runDir, 'flows.json')) : null;
  const { cells, targets: targetList } = buildMatrix({ checks, harness: hx, flows: fx, findings: kept, rejected: rejected.map((r) => r.finding), passes: all.passes, na: all.na });
  const targets = new Map(targetList.map((t) => [t.id, t]));
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
  const hj = exists(path.join(runDir, 'harness.json')) ? readJson(path.join(runDir, 'harness.json')) : null;
  const fj = exists(path.join(runDir, 'flows.json')) ? readJson(path.join(runDir, 'flows.json')) : null;
  // Extractor judgments live outside stage1/stage2 on purpose: stage1/2 hold verified coverage results, these are unverified.
  // null (not []) when the merged JSON predates ADR-0015: "unknown" must stay distinguishable from "zero recorded".
  const extractorJudgments = hj?.judgment_notes === undefined && fj?.judgment_notes === undefined ? null : {
    note: 'self_reported は抽出者（S1 / S2）の自己申告で、検証されていない。derived はスクリプトが機械的に列挙したもの。stage が null なら、その JSON は ADR-0015 以前で記録が無い。',
    self_reported: { stage1: hj?.judgment_notes ?? null, stage2: fj?.judgment_notes ?? null },
    missing: { stage1: hj?.judgment_notes_missing ?? null, stage2: fj?.judgment_notes_missing ?? null },
    derived: {
      dropped_memory_hints: hj?.derived_judgments?.dropped_memory_hints ?? [],
      noise_hints: (fj?.hint_attribution?.items ?? []).filter((i) => i.status === 'noise'),
      not_flows: fj?.not_flows ?? [],
    },
  };
  const verification = {
    schema: 'harness-review/verification@1',
    stage1: s1 ? { discovered: s1.discovered, extracted: s1.extracted, missing: s1.missing } : null,
    stage2: s2 ? { hints: s2.hints, attributed: s2.attributed, noise: s2.noise, unclassified: s2.unclassified, entries_without_flow: s2.entries_without_flow } : null,
    extractor_judgments: extractorJudgments,
    // rejected-only cells are not "seen": their only finding was a hallucination (ADR-0016)
    stage3: { axes: all.axes, unchecked_cells: cells.filter((c) => c.status === 'unchecked' || c.status === 'rejected-only').length, rejected_only_cells: cells.filter((c) => c.status === 'rejected-only').length, invalid_findings: s3v?.invalid_findings ?? [], invalid_passes: s3v?.invalid_passes ?? 0, invalid_na: s3v?.invalid_na ?? 0, warnings: s3v?.warnings ?? [] },
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
  if (h) lines.push(`①: files ${h.files.length} (${Object.entries(h.summary.counts).map(([k, n]) => `${k} ${n}`).join(', ')}), always≈${h.summary.always_loaded_tokens_est} tok, memory ${h.memory.length} (write-only ${h.summary.memory.write_only.length}, read-only ${h.summary.memory.read_only.length}), extractor judgment_notes ${h.judgment_notes === undefined ? 'unknown (run predates ADR-0015)' : `${h.judgment_notes.length}${h.judgment_notes_missing?.length ? ` (UNRECORDED in ${h.judgment_notes_missing.length} batch: ${h.judgment_notes_missing.join(', ')})` : ''}, dropped memory hints ≤${h.derived_judgments?.dropped_memory_hints?.length ?? 0}`}`);
  if (fl) lines.push(`②: flows ${fl.summary.total} (${Object.entries(fl.summary.by_kind).map(([k, n]) => `${k} ${n}`).join(', ')}), review_points in ${fl.summary.with_review_points}, judgment_points in ${fl.summary.with_judgment_points}, hints attributed/noise/unclassified ${fl.hint_attribution.attributed}/${fl.hint_attribution.noise}/${fl.hint_attribution.unclassified}, extractor judgment_notes ${fl.judgment_notes === undefined ? 'unknown (run predates ADR-0015)' : `${fl.judgment_notes.length}${fl.judgment_notes_missing?.length ? ` (UNRECORDED in ${fl.judgment_notes_missing.length} batch: ${fl.judgment_notes_missing.join(', ')})` : ''}`}, not_flows ${fl.not_flows?.length ?? 0}`);
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
