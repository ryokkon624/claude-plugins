#!/usr/bin/env node
// PreToolUse hook (Write|Edit|MultiEdit|NotebookEdit): block writes outside this project. ADR-0014.
// Allowed roots: CLAUDE_PROJECT_DIR (except the guard itself), ~/.claude/projects (auto memory),
// the session scratchpad, the OS temp directory.
// Exit 2 blocks; exit 0 allows. Unreadable input and internal errors fail closed (exit 2). Never exit 1.

import fs from 'node:fs';
import { allowedRoots, guardEditAllowed, guardOff, isAllowed, isGuardFile, norm } from './guard-common.mjs';

export function decide(input, env = process.env) {
  if (guardOff(env)) return { allow: true, reason: 'guard disabled by CLAUDE_PLUGINS_GUARD_OFF' };
  const p = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof p !== 'string' || !p.trim()) return { allow: false, reason: `no usable path in tool_input (${JSON.stringify(p)}); failing closed`, target: String(p), roots: [] };
  const roots = allowedRoots(input, env);
  const target = norm(p);
  if (isGuardFile(target, roots.projectDir) && !guardEditAllowed(env)) return { allow: false, reason: 'guard files are protected (launch Claude with CLAUDE_PLUGINS_GUARD_EDIT=1 to edit them)', target: p, roots: roots.labels };
  const ok = isAllowed(target, roots.list);
  return { allow: ok, reason: ok ? 'inside allowed root' : 'outside project', target: p, roots: roots.labels };
}

function block(msg) { process.stderr.write(msg); process.exit(2); }

// Always runs as the hook entry point (no main-module check: a mismatched URL would silently allow everything).
try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let input;
  try { input = JSON.parse(raw); } catch { block(`[guard-writes] hook 入力を JSON として読めないため fail-closed でブロックしました (ADR-0014)\n`); }
  const d = decide(input);
  if (d.allow) process.exit(0);
  block(`[guard-writes] 書き込みをブロックしました (ADR-0014)\n  対象: ${d.target}\n  理由: ${d.reason}\n  許可される場所: ${d.roots.join(', ')}\n  レビュー対象のファイルは変更しない。一時ファイルは scratchpad か一時ディレクトリに書く（output/ は生成物なので手で書かない）。\n`);
} catch (e) {
  block(`[guard-writes] 内部エラーのため fail-closed でブロックしました (ADR-0014): ${e?.message ?? e}\n`);
}
