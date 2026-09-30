#!/usr/bin/env node
// S0: deterministic discovery of a Claude Code harness.
//
//   node discover.mjs <target-dir> [--out <file>] [--max-depth <n>]
//
// Writes discover.json (or stdout). No LLM, no npm deps. Facts only:
// files, load timing, frontmatter, headings, sizes, hashes, @imports,
// hooks / permissions / MCP, spawn & memory hints, cross references.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- config

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'coverage',
  '.idea', '.vscode', '.playwright-mcp', '.gradle', '.mvn', 'bin', 'obj',
]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.sh', '.ps1', '.js', '.mjs', '.cjs', '.ts', '.py', '.toml', '.csv', '.html', '.xml', '.bat', '.cmd', '']);

// Structural memory candidates (relative to target). kind is a hint only.
const MEMORY_PATTERNS = [
  { rel: 'memory', kind: 'memory' },
  { rel: '.claude/memory', kind: 'memory' },
  { rel: 'MEMORY.md', kind: 'memory' },
  { rel: 'NOTES.md', kind: 'memory' },
  { rel: 'notes', kind: 'memory' },
  { rel: '.claude/notes', kind: 'memory' },
  { rel: 'docs/adr', kind: 'decision-record' },
  { rel: 'adr', kind: 'decision-record' },
  { rel: 'decisions', kind: 'decision-record' },
  { rel: 'docs/decisions', kind: 'decision-record' },
  { rel: 'DECISIONS.md', kind: 'decision-record' },
  { rel: 'CHANGELOG.md', kind: 'log' },
  { rel: 'TODO.md', kind: 'backlog' },
  { rel: 'backlog', kind: 'backlog' },
  { rel: 'reports', kind: 'reports' },
  { rel: 'spec', kind: 'spec' },
  { rel: 'docs/spec', kind: 'spec' },
];

const SPAWN_PATTERNS = [
  { kind: 'agent-tool', re: /\bAgent\s*(\(|tool|ツール)/ },
  { kind: 'subagent-type', re: /subagent_type/ },
  { kind: 'task-tool', re: /\bTask\s*\(/ },
  { kind: 'workflow-agent', re: /\bagent\s*\(/ },
  { kind: 'workflow', re: /\bWorkflow\s*(\(|tool|ツール)|\.claude\/workflows\b|\b(pipeline|parallel)\s*\(/ },
  { kind: 'send-message', re: /\bSendMessage\b/ },
  { kind: 'teammate', re: /\b(teammate|TeamCreate|team_name)\b|チームメイト/i },
  { kind: 'background', re: /run_in_background|バックグラウンドで(起動|実行)/ },
  { kind: 'fork', re: /\bcontext:\s*fork\b/ },
  { kind: 'claude-cli', re: /\bclaude\s+(-p|--print|--plugin-dir|-c)\b/ },
  { kind: 'prose', re: /\bsub-?agents?\b|\bspawn|\bfan[- ]out|\borchestrat|サブエージェント|(agent|エージェント)[^\n]{0,12}(起動|spawn|launch|start)|(起動|launch|start)[^\n]{0,12}(agent|エージェント)|並列(で|に)?起動/i },
];
const HINT_SKIP_EXT = new Set(['.html', '.css', '.csv', '.json', '.xml']);

const MEMORY_WRITE_RE = /記録|追記|保存|書き込|書き出|更新|メモ|出力先|出力する|\b(record|append|save|write|persist|log|update|remember|capture|output)\b/i;
const MEMORY_READ_RE = /参照|読み込|読んで|確認して|\b(read|consult|load|check|refer|look up|review)\b/i;
const MEMORY_WORD_RE = /memory|メモリ|ADR|decision record|決定記録|notes?\b|ノート|backlog|バックログ|report|レポート|spec\b|仕様書|CHANGELOG/i;
const FILEISH_RE = /(?:^|[\s`'"(（])((?:\.{0,2}\/|~\/|[\w.-]+\/)?[\w.\/-]+\.(?:md|json|txt|yaml|yml|csv|log|html))(?=[\s`'"),）。、:]|$)/g;

const INSTRUCTION_RE = /必ず|禁止|しないこと|してください|すること|してはいけない|べき|\b(must|never|always|do not|don't|should|required|forbidden|prohibited|only)\b/i;

// Frontmatter fields Claude Code reads (code.claude.com/docs/en/skills, /sub-agents, 2026-09-25).
// Any other key is silently ignored, which is a fact worth recording.
const SKILL_FIELDS = new Set(['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility']);
const COMMAND_IGNORED_FIELDS = new Set(['name', 'paths']); // commands accept skill fields except these
const AGENT_FIELDS = new Set(['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color', 'initialPrompt', 'experimental']);

// ---------------------------------------------------------------- helpers

const posix = (p) => p.split(path.sep).join('/');
const rel = (root, p) => posix(path.relative(root, p));
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function readText(p) {
  const st = fs.statSync(p);
  if (st.size > MAX_TEXT_BYTES) return null;
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) return null; // binary
  return buf.toString('utf8').replace(/^﻿/, '');
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function estimateTokens(text) {
  let ascii = 0, other = 0;
  for (const ch of text) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.round(ascii / 4 + other * 0.8);
}

function listFiles(dir, { recursive = true, depth = 0, maxDepth = 6 } = {}) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive && depth < maxDepth && !IGNORE_DIRS.has(ent.name)) out.push(...listFiles(p, { recursive, depth: depth + 1, maxDepth }));
    } else if (ent.isFile()) out.push(p);
  }
  return out.sort();
}

// ---------------------------------------------------------------- frontmatter (YAML subset)

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: null, body: text, bodyLine: 1 };
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { fm: null, body: text, bodyLine: 1 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') {
      return { fm: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n'), bodyLine: i + 2 };
    }
  }
  return { fm: null, body: text, bodyLine: 1, fmError: 'unterminated frontmatter' };
}

function parseScalar(s) {
  s = s.trim();
  if (s === '' ) return '';
  if (s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).replace(/\\"/g, '"');
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => parseScalar(x));
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    const inner = s.slice(1, -1).trim();
    if (inner === '') return obj;
    for (const part of inner.split(',')) {
      const m = part.match(/^\s*([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`bad inline map: ${s}`);
      obj[m[1].trim()] = parseScalar(m[2]);
    }
    return obj;
  }
  return s;
}

function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function parseYamlSubset(src) {
  const raw = src.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].replace(/\t/g, '  ');
    if (t.trim() === '' || t.trim().startsWith('#')) { lines.push({ n: i + 1, indent: -1, text: '', blank: true, rawText: t }); continue; }
    lines.push({ n: i + 1, indent: t.match(/^ */)[0].length, text: stripComment(t).trim(), rawText: t, blank: false });
  }
  const next = (i) => { while (i < lines.length && lines[i].blank) i++; return i; };

  function blockScalar(i, indent, style) {
    const buf = [];
    let j = i;
    while (j < lines.length && (lines[j].blank || lines[j].indent > indent)) { buf.push(lines[j].blank ? '' : lines[j].rawText); j++; }
    const minIndent = Math.min(...buf.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)[0].length), Infinity);
    const body = buf.map((l) => (l.trim() === '' ? '' : l.slice(minIndent)));
    while (body.length && body[body.length - 1] === '') body.pop();
    return [style === '>' ? body.join(' ').replace(/ {2,}/g, ' ').trim() : body.join('\n'), j];
  }

  function parseValueAfterKey(valueText, i, indent) {
    // i = index of the next line after the key line
    if (valueText === '' ) {
      const j = next(i);
      if (j < lines.length && lines[j].indent > indent) return parseBlock(j, lines[j].indent);
      if (j < lines.length && lines[j].indent === indent && lines[j].text.startsWith('- ')) return parseList(j, indent); // list at same indent
      return [null, i];
    }
    if (valueText === '|' || valueText === '>' || valueText === '|-' || valueText === '>-') return blockScalar(i, indent, valueText[0]);
    // plain scalar with possible continuation lines
    let v = valueText;
    let j = i;
    while (j < lines.length && !lines[j].blank && lines[j].indent > indent && !lines[j].text.startsWith('- ') && !/^[\w.-]+\s*:(\s|$)/.test(lines[j].text)) { v += ' ' + lines[j].text; j++; }
    return [parseScalar(v), j];
  }

  function parseMap(i, indent) {
    const obj = {};
    while (true) {
      i = next(i);
      if (i >= lines.length || lines[i].indent < indent) break;
      if (lines[i].indent > indent) throw new Error(`unexpected indent at line ${lines[i].n}`);
      if (lines[i].text.startsWith('- ')) break;
      const m = lines[i].text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
      if (!m) throw new Error(`expected key: value at line ${lines[i].n}: ${lines[i].text}`);
      const key = m[1].replace(/^['"]|['"]$/g, '');
      const [val, ni] = parseValueAfterKey((m[2] ?? '').trim(), i + 1, indent);
      obj[key] = val;
      i = ni;
    }
    return [obj, i];
  }

  function parseList(i, indent) {
    const arr = [];
    while (true) {
      i = next(i);
      if (i >= lines.length || lines[i].indent !== indent || !lines[i].text.startsWith('- ')) break;
      const rest = lines[i].text.slice(2).trim();
      if (rest === '') {
        const j = next(i + 1);
        if (j < lines.length && lines[j].indent > indent) { const [v, ni] = parseBlock(j, lines[j].indent); arr.push(v); i = ni; } else { arr.push(null); i = i + 1; }
        continue;
      }
      const km = rest.match(/^("[^"]*"|'[^']*'|[^:\[\]{}]+?)\s*:(?:\s+(.*))?$/);
      if (km && !rest.startsWith('[') && !rest.startsWith('{')) {
        // map item: treat "- key: v" as a map whose first line is at indent+2
        const saved = lines[i];
        lines[i] = { ...saved, indent: indent + 2, text: rest };
        const [obj, ni] = parseMap(i, indent + 2);
        lines[i] = saved;
        arr.push(obj); i = ni;
      } else { arr.push(parseScalar(rest)); i = i + 1; }
    }
    return [arr, i];
  }

  function parseBlock(i, indent) {
    return lines[i].text.startsWith('- ') ? parseList(i, indent) : parseMap(i, indent);
  }

  const start = next(0);
  if (start >= lines.length) return {};
  const [val] = parseBlock(start, lines[start].indent);
  return val;
}

// ---------------------------------------------------------------- markdown analysis

function analyzeLines(body, bodyLine) {
  const out = [];
  let inCode = false;
  body.split(/\r?\n/).forEach((text, idx) => {
    const fence = /^\s*(```|~~~)/.test(text);
    if (fence) { inCode = !inCode; out.push({ n: bodyLine + idx, text, inCode: true, fence: true }); return; }
    out.push({ n: bodyLine + idx, text, inCode });
  });
  return out;
}

function extractHeadings(lines) {
  const hs = [];
  for (const l of lines) {
    if (l.inCode) continue;
    const m = l.text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) hs.push({ level: m[1].length, text: m[2].trim(), line: l.n });
  }
  return hs;
}

function findImports(lines, fileDir, root) {
  const found = [];
  const re = /(?:^|[\s(])@((?:\.{0,2}\/|~\/|[\w-]+\/|[\w.-]+\.md)[^\s)'"`]*)/g;
  for (const l of lines) {
    if (l.inCode) continue;
    let m;
    while ((m = re.exec(l.text))) {
      const spec = m[1];
      if (spec.includes('@') || /^\w+\.(com|org|net|io|dev)\b/.test(spec)) continue; // emails / urls
      const abs = spec.startsWith('~/') ? path.join(os.homedir(), spec.slice(2)) : path.resolve(fileDir, spec);
      const inside = !path.relative(root, abs).startsWith('..') && !path.isAbsolute(path.relative(root, abs));
      found.push({ line: l.n, spec, path: inside ? rel(root, abs) : posix(abs), exists: exists(abs), inside_target: inside });
    }
  }
  return found;
}

function findSpawnHints(lines) {
  const hints = [];
  for (const l of lines) {
    if (l.fence) continue;
    const kinds = SPAWN_PATTERNS.filter((p) => p.re.test(l.text)).map((p) => p.kind);
    if (kinds.length) hints.push({ line: l.n, kinds, in_code: l.inCode, text: l.text.trim().slice(0, 200) });
  }
  return hints;
}

function findMemoryHints(lines) {
  const hints = [];
  for (const l of lines) {
    if (l.fence) continue;
    const t = l.text;
    const write = MEMORY_WRITE_RE.test(t), read = MEMORY_READ_RE.test(t);
    if (!write && !read) continue;
    const targets = [];
    let m; FILEISH_RE.lastIndex = 0;
    while ((m = FILEISH_RE.exec(t))) targets.push(m[1]);
    const word = MEMORY_WORD_RE.test(t);
    if (!targets.length && !word) continue;
    hints.push({ line: l.n, direction: write && read ? 'both' : write ? 'write' : 'read', targets, memory_word: word, in_code: l.inCode, text: t.trim().slice(0, 200) });
  }
  return hints;
}

function countInstructionLines(lines) {
  return lines.filter((l) => !l.inCode && INSTRUCTION_RE.test(l.text)).length;
}

// ---------------------------------------------------------------- file record

function fileRecord(root, abs, kind, extra = {}) {
  const st = fs.statSync(abs);
  const rec = {
    id: extra.id ?? `${kind}:${rel(root, abs)}`,
    kind,
    path: rel(root, abs),
    load: extra.load ?? null,
    size: { bytes: st.size, lines: null, tokens_est: null },
    sha256: sha256(abs),
    mtime: st.mtime.toISOString(),
    frontmatter: null,
    frontmatter_error: null,
    headings: [],
    imports: [],
    hints: { spawn: [], memory: [] },
    instruction_lines: null,
    refs: { skills: [], agents: [], commands: [], harness_files: [] },
    ...extra,
  };
  const ext = path.extname(abs).toLowerCase();
  const text = TEXT_EXT.has(ext) ? readText(abs) : null;
  rec._text = text; // stripped before output
  if (text == null) { rec.binary_or_large = true; return rec; }
  rec.size.lines = text.split(/\r?\n/).length;
  rec.size.tokens_est = estimateTokens(text);
  if (ext === '.md') {
    const { fm, body, bodyLine, fmError } = splitFrontmatter(text);
    if (fmError) rec.frontmatter_error = fmError;
    if (fm != null) {
      rec.frontmatter_raw = fm;
      try { rec.frontmatter = parseYamlSubset(fm); } catch (e) { rec.frontmatter_error = e.message; }
    }
    const lines = analyzeLines(body, bodyLine);
    rec._lines = lines;
    rec.body_lines = lines.length;
    rec.headings = extractHeadings(lines);
    rec.imports = findImports(lines, path.dirname(abs), root);
    rec.hints.spawn = findSpawnHints(lines);
    rec.hints.memory = findMemoryHints(lines);
    rec.instruction_lines = countInstructionLines(lines);
    const first = lines.find((l) => l.text.trim() !== '');
    rec.first_body_line = first ? { line: first.n, text: first.text.trim().slice(0, 200) } : null;
    if (rec.frontmatter && typeof rec.frontmatter === 'object') {
      const d = rec.frontmatter.description, w = rec.frontmatter.when_to_use;
      rec.frontmatter_stats = {
        description_chars: typeof d === 'string' ? d.length : 0,
        when_to_use_chars: typeof w === 'string' ? w.length : 0,
        keys: Object.keys(rec.frontmatter),
      };
    }
  } else if (!HINT_SKIP_EXT.has(ext)) {
    const lines = analyzeLines(text, 1);
    rec._lines = lines;
    rec.hints.spawn = findSpawnHints(lines);
    rec.hints.memory = findMemoryHints(lines);
    if (kind === 'hook-script') {
      // Only exit 2 blocks; exit 1 is a non-blocking error (docs/en/hooks, 2026-09-25)
      const codes = {};
      for (const l of lines) { let m; const re = /\bexit\s+(\d+)\b/g; while ((m = re.exec(l.text))) (codes[m[1]] ??= []).push(l.n); }
      rec.exit_codes_used = codes;
      rec.reads_stdin_json = /jq\b|JSON\.parse|json\.load|\$\(cat\)|tool_input|tool_name/.test(text);
    }
  }
  return rec;
}

// ---------------------------------------------------------------- settings / hooks / mcp

function readJson(p) {
  try { return { data: JSON.parse(readText(p)), error: null }; } catch (e) { return { data: null, error: e.message }; }
}

function resolveScript(command, root) {
  if (!command || typeof command !== 'string') return null;
  const expanded = command
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root)
    .replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, root)
    .replace(/\$\{?CLAUDE_SKILL_DIR\}?/g, root);
  const tokens = expanded.split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
  for (const t of tokens) {
    if (!/[\/\\]/.test(t) && !/\.(sh|ps1|js|mjs|cjs|py|bat|cmd)$/.test(t)) continue;
    const abs = path.isAbsolute(t) ? t : path.resolve(root, t);
    if (!isFile(abs)) continue;
    const r = rel(root, abs);
    const outside = r.startsWith('..') || path.isAbsolute(r);
    const info = { path: outside ? posix(abs) : r, exists: true, outside_target: outside };
    try { info.sha256 = sha256(abs); const txt = readText(abs); info.lines = txt == null ? null : txt.split(/\r?\n/).length; } catch { /* ignore */ }
    return info;
  }
  const guess = tokens.find((t) => /\.(sh|ps1|js|mjs|cjs|py|bat|cmd)$/.test(t));
  return guess ? { path: guess, exists: false, outside_target: null } : null;
}

function flattenHooks(hooksObj, source, root) {
  const out = [];
  if (!hooksObj || typeof hooksObj !== 'object') return out;
  for (const [event, matchers] of Object.entries(hooksObj)) {
    if (!Array.isArray(matchers)) continue;
    matchers.forEach((m, mi) => {
      const list = Array.isArray(m?.hooks) ? m.hooks : [];
      list.forEach((h, hi) => out.push({
        id: `hook:${source}:${event}:${mi}.${hi}`,
        source, event,
        matcher: m.matcher ?? '*',
        type: h.type ?? 'command',
        command: h.command ?? null,
        prompt: h.prompt ?? null,
        url: h.url ?? null,
        timeout: h.timeout ?? null,
        if: h.if ?? null,
        once: h.once ?? null,
        async: h.async ?? null,
        script: resolveScript(h.command, root),
      }));
    });
  }
  return out;
}

// ---------------------------------------------------------------- main discovery

export function discover(root, { maxDepth = 6 } = {}) {
  const files = [];
  const hooks = [];
  const permissions = [];
  const mcpServers = [];
  const settings = [];
  const notes = [];
  const add = (abs, kind, extra) => { if (isFile(abs)) { const r = fileRecord(root, abs, kind, extra); files.push(r); return r; } return null; };

  // --- layout detection
  const pluginManifest = path.join(root, '.claude-plugin', 'plugin.json');
  const marketplaceManifest = path.join(root, '.claude-plugin', 'marketplace.json');
  const hasProject = isDir(path.join(root, '.claude')) || isFile(path.join(root, 'CLAUDE.md'));
  const hasPlugin = isFile(pluginManifest);
  const layouts = [];
  if (hasProject) layouts.push('project');
  if (hasPlugin) layouts.push('plugin');
  if (isFile(marketplaceManifest)) layouts.push('marketplace');

  // --- CLAUDE.md family
  for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) add(path.join(root, name), 'claude-md', { load: 'always', subkind: name === 'CLAUDE.local.md' ? 'local' : 'root' });
  add(path.join(root, '.claude', 'CLAUDE.md'), 'claude-md', { load: 'always', subkind: 'dot-claude' });
  // AGENTS.md is read as project instructions when no CLAUDE.md exists (default setting); recorded either way
  add(path.join(root, 'AGENTS.md'), 'claude-md', { load: isFile(path.join(root, 'CLAUDE.md')) ? 'meta' : 'always', subkind: 'agents-md' });
  const nestedClaudeDirs = [];
  (function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        if (ent.name === '.claude' && dir !== root) { nestedClaudeDirs.push(rel(root, p)); continue; }
        if (ent.name === '.claude' || ent.name === '.claude-plugin') continue;
        walk(p, depth + 1);
      } else if (dir !== root && (ent.name === 'CLAUDE.md' || ent.name === 'CLAUDE.local.md' || ent.name === 'AGENTS.md')) {
        add(p, 'claude-md', { load: 'path-scoped', subkind: ent.name === 'AGENTS.md' ? 'nested-agents-md' : 'nested' });
      }
    }
  })(root, 0);

  // --- project layout
  const dotClaude = path.join(root, '.claude');
  const collectSkills = (dir, origin) => {
    if (!isDir(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillDir = path.join(dir, ent.name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!isFile(skillMd)) { notes.push({ kind: 'skill-dir-without-SKILL.md', path: rel(root, skillDir) }); continue; }
      const r = add(skillMd, 'skill', { id: `skill:${ent.name}`, name: ent.name, origin });
      const fm = r.frontmatter || {};
      r.load = fm['disable-model-invocation'] === true ? 'invoked' : 'on-demand';
      r.exec = fm.context === 'fork' ? 'fork' : 'inline';
      r.user_invocable = fm['user-invocable'] !== false;
      r.frontmatter_unknown_keys = Object.keys(fm).filter((k) => !SKILL_FIELDS.has(k));
      // without a description, Claude Code uses the first non-empty markdown line
      r.description_source = typeof fm.description === 'string' && fm.description.trim() ? 'frontmatter' : 'first-line-fallback';
      if (fm.name && fm.name !== ent.name) r.name_mismatch = fm.name;
      r.support_files = [];
      for (const f of listFiles(skillDir)) {
        if (f === skillMd) continue;
        const s = add(f, 'skill-support', { id: `skill-support:${rel(root, f)}`, load: 'support', parent: r.id });
        r.support_files.push(s.path);
      }
      if (fm.hooks) hooks.push(...flattenHooks(fm.hooks, `skill:${ent.name}`, root));
    }
  };
  const collectCommands = (dir, origin) => {
    for (const f of listFiles(dir)) {
      if (!f.endsWith('.md')) continue;
      const r = add(f, 'command', { id: `command:${posix(path.relative(dir, f)).replace(/\.md$/, '')}`, name: path.basename(f, '.md'), load: 'invoked', origin });
      const keys = Object.keys(r.frontmatter || {});
      r.frontmatter_ignored_keys = keys.filter((k) => COMMAND_IGNORED_FIELDS.has(k));
      r.frontmatter_unknown_keys = keys.filter((k) => !SKILL_FIELDS.has(k));
    }
  };
  const collectAgents = (dir, origin) => {
    for (const f of listFiles(dir)) {
      if (!f.endsWith('.md')) continue;
      const r = add(f, 'agent', { id: `agent:${path.basename(f, '.md')}`, name: path.basename(f, '.md'), load: 'spawned', origin });
      const fm = r.frontmatter;
      if (fm?.name && fm.name !== r.name) r.name_mismatch = fm.name;
      r.frontmatter_unknown_keys = Object.keys(fm || {}).filter((k) => !AGENT_FIELDS.has(k));
      // Claude Code silently skips agent files that fail these (docs/en/sub-agents, 2026-09-25)
      let invalid = null;
      if (r.frontmatter_error) invalid = 'frontmatter does not parse (file skipped)';
      else if (!fm) invalid = 'no frontmatter (treated as documentation, not loaded)';
      else if (!fm.name) invalid = 'missing name (treated as documentation, not loaded)';
      else if (!fm.description) invalid = 'missing description (file skipped)';
      else if (String(fm.name).startsWith('-') || String(fm.name).includes(':')) invalid = 'invalid name: must not start with "-" or contain ":" (file skipped)';
      r.loadable = invalid === null;
      r.not_loadable_reason = invalid;
      if (fm?.hooks) hooks.push(...flattenHooks(fm.hooks, `agent:${r.name}`, root));
    }
  };
  const collectSettings = (p, source) => {
    if (!isFile(p)) return;
    const r = add(p, 'settings', { id: `settings:${source}`, load: 'meta', source });
    const { data, error } = readJson(p);
    if (error) { r.parse_error = error; return; }
    r.keys = Object.keys(data);
    settings.push({ source, path: r.path, keys: r.keys });
    hooks.push(...flattenHooks(data.hooks, source, root));
    if (data.permissions) permissions.push({ source, ...data.permissions });
    if (data.mcpServers) for (const [name, cfg] of Object.entries(data.mcpServers)) mcpServers.push(mcpRecord(name, cfg, source));
  };
  const mcpRecord = (name, cfg, source) => ({ name, source, transport: cfg.type ?? (cfg.url ? 'http' : 'stdio'), command: cfg.command ? [cfg.command, ...(cfg.args ?? [])].join(' ') : null, url: cfg.url ?? null });
  const collectMcp = (p, source) => {
    if (!isFile(p)) return;
    const r = add(p, 'mcp-config', { id: `mcp-config:${source}`, load: 'meta', source });
    const { data, error } = readJson(p);
    if (error) { r.parse_error = error; return; }
    for (const [name, cfg] of Object.entries(data.mcpServers ?? {})) mcpServers.push(mcpRecord(name, cfg, source));
  };
  const collectHooksJson = (p, source) => {
    if (!isFile(p)) return;
    const r = add(p, 'hooks-config', { id: `hooks-config:${source}`, load: 'meta', source });
    const { data, error } = readJson(p);
    if (error) { r.parse_error = error; return; }
    hooks.push(...flattenHooks(data.hooks ?? data, source, root));
  };

  if (hasProject) {
    for (const f of listFiles(path.join(dotClaude, 'rules'))) {
      if (!f.endsWith('.md')) continue;
      const r = add(f, 'rule', { id: `rule:${posix(path.relative(path.join(dotClaude, 'rules'), f)).replace(/\.md$/, '')}`, name: path.basename(f, '.md') });
      r.paths = r.frontmatter?.paths ?? null;
      r.load = r.paths ? 'path-scoped' : 'always';
      // Claude Code reads only `paths` from a rule's frontmatter; every other key is silently ignored
      r.frontmatter_ignored_keys = r.frontmatter ? Object.keys(r.frontmatter).filter((k) => k !== 'paths') : [];
    }
    collectSkills(path.join(dotClaude, 'skills'), 'project');
    collectCommands(path.join(dotClaude, 'commands'), 'project');
    collectAgents(path.join(dotClaude, 'agents'), 'project');
    collectSettings(path.join(dotClaude, 'settings.json'), 'settings.json');
    collectSettings(path.join(dotClaude, 'settings.local.json'), 'settings.local.json');
    for (const f of listFiles(path.join(dotClaude, 'workflows'))) add(f, 'workflow', { id: `workflow:${path.basename(f)}`, name: path.basename(f), load: 'invoked' });
  }
  collectMcp(path.join(root, '.mcp.json'), '.mcp.json');

  // --- plugin layout
  let manifest = null;
  if (hasPlugin) {
    const r = add(pluginManifest, 'plugin-manifest', { id: 'plugin-manifest', load: 'meta' });
    const { data, error } = readJson(pluginManifest);
    if (error) r.parse_error = error; else { manifest = data; r.manifest = data; }
    // A CLAUDE.md at a plugin root is not loaded as context when the plugin is installed elsewhere
    const rootClaude = files.find((f) => f.kind === 'claude-md' && f.subkind === 'root');
    if (rootClaude) rootClaude.plugin_root_note = 'not loaded as context when this directory is used as an installed plugin (only when used as a project)';
    const m = manifest ?? {};
    const p = (field, def) => path.resolve(root, typeof m[field] === 'string' ? m[field] : def);
    collectSkills(p('skills', 'skills'), 'plugin');
    collectCommands(p('commands', 'commands'), 'plugin');
    collectAgents(p('agents', 'agents'), 'plugin');
    collectHooksJson(p('hooks', 'hooks/hooks.json'), 'hooks/hooks.json');
    if (typeof m.mcpServers === 'string') collectMcp(path.resolve(root, m.mcpServers), m.mcpServers);
    if (isFile(path.join(root, 'settings.json'))) collectSettings(path.join(root, 'settings.json'), 'plugin-settings.json');
  }
  if (isFile(marketplaceManifest)) add(marketplaceManifest, 'marketplace-manifest', { id: 'marketplace-manifest', load: 'meta' });

  // --- hook scripts (referenced) and orphans under .claude/hooks, hooks/
  const referencedScripts = new Set(hooks.map((h) => h.script?.exists && !h.script.outside_target && h.script.path).filter(Boolean));
  for (const sp of referencedScripts) add(path.join(root, sp), 'hook-script', { id: `hook-script:${sp}`, load: 'triggered', referenced: true });
  for (const dir of [path.join(dotClaude, 'hooks'), path.join(root, 'hooks')]) {
    for (const f of listFiles(dir)) {
      const rp = rel(root, f);
      if (referencedScripts.has(rp) || rp.endsWith('hooks.json')) continue;
      add(f, 'hook-script', { id: `hook-script:${rp}`, load: 'triggered', referenced: false });
    }
  }

  // --- @imports (add imported files as records)
  const known = new Set(files.map((f) => f.path));
  for (const f of [...files]) {
    for (const imp of f.imports) {
      if (!imp.exists || !imp.inside_target || known.has(imp.path)) continue;
      const r = add(path.join(root, imp.path), 'import', { id: `import:${imp.path}`, load: f.load, imported_by: f.id });
      if (r) known.add(r.path);
    }
  }

  // --- unknown files under .claude
  const classified = new Set(files.map((f) => f.path));
  const unknown = [];
  for (const f of listFiles(dotClaude)) {
    const rp = rel(root, f);
    if (classified.has(rp)) continue;
    if (/^\.claude\/(settings\.json|settings\.local\.json)$/.test(rp)) continue;
    unknown.push(rp);
  }

  // --- memory candidates (structural)
  const memoryCandidates = [];
  for (const m of MEMORY_PATTERNS) {
    const abs = path.join(root, m.rel);
    if (!exists(abs)) continue;
    const dir = isDir(abs);
    memoryCandidates.push({ path: m.rel, kind_hint: m.kind, is_dir: dir, file_count: dir ? listFiles(abs, { maxDepth: 3 }).length : 1, detection: 'structural' });
  }
  // referential: targets mentioned in memory hints that exist
  const mentioned = new Map();
  for (const f of files) for (const h of f.hints.memory) for (const t of h.targets) {
    const abs = path.resolve(root, t.replace(/^~\//, os.homedir() + '/'));
    const rp = rel(root, abs);
    if (!exists(abs) || rp.startsWith('..')) continue;
    if (!mentioned.has(rp)) mentioned.set(rp, { path: rp, kind_hint: 'referenced', is_dir: isDir(abs), detection: 'referential', mentioned_by: [] });
    mentioned.get(rp).mentioned_by.push({ file: f.id, line: h.line, direction: h.direction });
  }
  for (const m of mentioned.values()) if (!memoryCandidates.some((c) => c.path === m.path)) memoryCandidates.push(m); else Object.assign(memoryCandidates.find((c) => c.path === m.path), { mentioned_by: m.mentioned_by });

  // --- agent → skill preloading (frontmatter `skills:` injects the skill at spawn)
  const skillById = new Map(files.filter((f) => f.kind === 'skill').map((f) => [f.name, f]));
  for (const a of files.filter((f) => f.kind === 'agent')) {
    const list = Array.isArray(a.frontmatter?.skills) ? a.frontmatter.skills : typeof a.frontmatter?.skills === 'string' ? a.frontmatter.skills.split(/[,\s]+/).filter(Boolean) : [];
    a.preloads_skills = list.map((n) => {
      const s = skillById.get(n);
      // skills with disable-model-invocation: true cannot be preloaded (skipped silently)
      const blocked = !!s && s.frontmatter?.['disable-model-invocation'] === true;
      return { name: n, resolved: !!s, blocked_by_disable_model_invocation: blocked, tokens_est: s && !blocked ? s.size.tokens_est : null };
    });
    for (const n of list) { const s = skillById.get(n); if (s) (s.preloaded_by ??= []).push(a.id); }
    a.context_at_spawn_tokens_est = (a.size.tokens_est ?? 0) + a.preloads_skills.reduce((t, s) => t + (s.tokens_est ?? 0), 0);
  }

  // --- cross references (heuristic; LLM confirms in S1/S2)
  const skillNames = files.filter((f) => f.kind === 'skill').map((f) => f.name);
  const commandNames = files.filter((f) => f.kind === 'command').map((f) => f.name);
  const agentNames = files.filter((f) => f.kind === 'agent').map((f) => f.name);
  const harnessPaths = files.map((f) => f.path);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of files) {
    if (!f._lines) continue;
    for (const l of f._lines) {
      if (l.fence) continue;
      for (const n of skillNames) if (n !== f.name && new RegExp(`(?:^|[^\\w/-])/?${esc(n)}(?![\\w-])`).test(l.text)) f.refs.skills.push({ name: n, line: l.n });
      for (const n of commandNames) if (n !== f.name && new RegExp(`(?:^|[^\\w/-])/${esc(n)}(?![\\w-])`).test(l.text)) f.refs.commands.push({ name: n, line: l.n });
      for (const n of agentNames) if (n !== f.name && new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`).test(l.text)) f.refs.agents.push({ name: n, line: l.n });
      for (const p of harnessPaths) if (p !== f.path && new RegExp(`(?<![\\w/.-])${esc(p)}(?![\\w-])`).test(l.text)) f.refs.harness_files.push({ path: p, line: l.n });
    }
  }

  // --- summary
  const counts = {};
  for (const f of files) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  const byLoad = {};
  for (const f of files) byLoad[f.load ?? 'null'] = (byLoad[f.load ?? 'null'] ?? 0) + 1;
  const alwaysTokens = files.filter((f) => f.load === 'always').reduce((a, f) => a + (f.size.tokens_est ?? 0), 0);
  const topLevel = fs.readdirSync(root, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name)).sort();

  for (const f of files) { delete f._text; delete f._lines; }
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schema: 'harness-review/discover@1',
    target: { path: posix(root), name: path.basename(root), scanned_at: new Date().toISOString(), layouts, top_level: topLevel, nested_claude_dirs: nestedClaudeDirs },
    summary: {
      counts, by_load: byLoad, always_loaded_tokens_est: alwaysTokens,
      hooks: hooks.length, permissions_sources: permissions.length, mcp_servers: mcpServers.length,
      memory_candidates: memoryCandidates.length,
      spawn_hints: files.reduce((a, f) => a + f.hints.spawn.length, 0),
      memory_hints: files.reduce((a, f) => a + f.hints.memory.length, 0),
      frontmatter_errors: files.filter((f) => f.frontmatter_error).map((f) => f.path),
      unknown_claude_files: unknown.length,
    },
    files, hooks, permissions, settings, mcp_servers: mcpServers, memory_candidates: memoryCandidates,
    unknown_claude_files: unknown.slice(0, 200), notes,
  };
}

// ---------------------------------------------------------------- cli

function main(argv) {
  const args = argv.slice(2);
  let target = null, out = null, maxDepth = 6;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--max-depth') maxDepth = Number(args[++i]);
    else if (!target) target = args[i];
    else { console.error(`unexpected argument: ${args[i]}`); process.exit(2); }
  }
  if (!target) { console.error('usage: node discover.mjs <target-dir> [--out <file>] [--max-depth <n>]'); process.exit(2); }
  const root = path.resolve(target);
  if (!isDir(root)) { console.error(`not a directory: ${root}`); process.exit(1); }
  const result = discover(root, { maxDepth });
  const json = JSON.stringify(result, null, 2);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, json); }
  else process.stdout.write(json + '\n');
  const s = result.summary;
  console.error(`[discover] ${result.target.name} layouts=${result.target.layouts.join('+') || 'none'} files=${result.files.length} ${JSON.stringify(s.counts)} hooks=${s.hooks} mcp=${s.mcp_servers} memory=${s.memory_candidates} spawnHints=${s.spawn_hints} memoryHints=${s.memory_hints} alwaysTokens≈${s.always_loaded_tokens_est}${s.frontmatter_errors.length ? ' FM_ERRORS=' + s.frontmatter_errors.join(',') : ''}${out ? ' -> ' + out : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv);
