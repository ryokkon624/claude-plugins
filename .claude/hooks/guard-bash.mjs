#!/usr/bin/env node
// PreToolUse hook (Bash): ADR-0014, .claude/rules/git.md.
//  1. block `git push` that targets main/master (explicit ref, HEAD, the current branch when no ref is given, or --delete)
//  2. block shell writes outside the project: a write-ish token (>, >>, sed -i, cp, mv, rm, tee, touch, mkdir, git -C,
//     PowerShell Copy-Item / Set-Content / Out-File ...) combined with a path outside the allowed roots, or any write-ish
//     token while the effective cwd (tracking `cd`) is outside
//  3. block writes to the guard's own files (unless CLAUDE_PLUGINS_GUARD_EDIT=1 at launch)
// Best-effort parsing: this is a gate against mistakes, not a security boundary.
// Exit 2 blocks; exit 0 allows. Unreadable input and internal errors fail closed (exit 2). Never exit 1.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { allowedRoots, guardEditAllowed, guardOff, isAllowed, isGuardDir, isGuardFile, norm, pathTokens, resolveToken, SPACE } from './guard-common.mjs';

const PROTECTED = /^(main|master)$/;
// `>` / `>>` anywhere except inside `2>&1`-style descriptor redirects; plus write-ish commands (POSIX and PowerShell).
const WRITE_TOKEN = /(?<![<>&])>>?(?!&)|(^|\s)(sed\s+-i\S*|cp|mv|rm|rmdir|tee|touch|mkdir|ln|chmod|chown|truncate|dd|unlink|rsync|install)(\s|$)|\bgit\s+-C\s|\bgit\s+(commit|checkout|switch|reset|clean|stash|apply|am|rebase|merge|cherry-pick|restore|mv|rm|add)\b|\bnpm\s+(install|ci|update)\b|\bnode\s+-e\s|\bpython3?\s+-c\s/;
const PS_WRITE_TOKEN = /\b(Copy-Item|Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Rename-Item|Clear-Content|Tee-Object)\b|\s-OutFile\s/i;
const isWrite = (s) => WRITE_TOKEN.test(s) || PS_WRITE_TOKEN.test(s);

// Quoted spans: a path-like span (starts with a drive, a slash, ~/, ./ or ../) is kept as ONE token with its spaces
// replaced by SPACE so it still resolves; any other quoted span containing whitespace is a message (commit -m "...")
// and is blanked out before matching. Quoted spans without whitespace are kept as bare tokens.
function stripMessages(seg) {
  return seg.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (m, d, s) => {
    const inner = d ?? s ?? '';
    if (!/\s/.test(inner)) return inner;
    if (/^(?:[A-Za-z]:)?[\\/]|^~[\\/]|^\.{1,2}[\\/]/.test(inner)) return inner.replace(/\s/g, SPACE);
    return '""';
  });
}

function currentBranch(cwd) {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

function refTargetsProtected(ref, branch) {
  const r = ref.replace(/^\+/, '').replace(/^:/, '');
  let dst = r.includes(':') ? r.split(':').pop() : r;
  dst = dst.replace(/^refs\/heads\//, '');
  if (dst === 'HEAD') dst = branch ?? '';
  return PROTECTED.test(dst);
}

export function decide(input, env = process.env, branchOf = currentBranch) {
  if (guardOff(env)) return { allow: true, reason: 'guard disabled by CLAUDE_PLUGINS_GUARD_OFF' };
  const cmd = String(input?.tool_input?.command ?? '');
  if (!cmd.trim()) return { allow: true, reason: 'empty' };
  const cwd = input?.cwd || process.cwd();
  // Blank out quoted messages BEFORE splitting, so a `|` or `;` inside a quoted string does not split the command
  // (which would leave unbalanced quotes and turn regex literals like /\r?\n/ into "paths").
  const segments = stripMessages(cmd).split(/&&|\|\||;|\||\r?\n/);

  // 1. git push to main/master (including --delete)
  if (/\bgit\b/.test(cmd)) {
    let branch;
    const getBranch = () => (branch === undefined ? (branch = branchOf(cwd)) : branch);
    for (const seg of segments) {
      const m = seg.match(/\bgit\s+(?:-C\s+\S+\s+)?push\b([^\n]*)$/);
      if (!m) continue;
      const args = m[1].trim().split(/\s+/).filter(Boolean);
      const deleting = args.includes('--delete') || args.includes('-d');
      const refs = args.filter((a) => !a.startsWith('-')).slice(1); // first positional is the remote
      let targets = refs.some((r) => refTargetsProtected(r, r.includes('HEAD') ? getBranch() : null));
      let via = targets ? (deleting ? 'delete' : 'explicit ref') : null;
      if (!targets && !deleting && refs.length === 0) { const b = getBranch(); if (b && PROTECTED.test(b)) { targets = true; via = `current branch ${b}`; } }
      if (targets) return { allow: false, kind: 'push', reason: `push to main/master (${via})`, segment: seg.trim() };
    }
  }

  // 2 + 3. writes outside the project / to the guard, tracking `cd` across segments
  if (!segments.some((s) => isWrite(s))) return { allow: true, reason: 'no write-ish token' };
  const roots = allowedRoots(input, env);
  const editOk = guardEditAllowed(env);
  let cur = norm(cwd);
  for (const seg of segments) {
    const cdm = seg.match(/^\s*(?:cd|Set-Location|pushd)\s+(\S+)/i);
    if (cdm && cdm[1] !== '-' && cdm[1] !== '""') cur = resolveToken(cdm[1], cur);
    const writing = isWrite(seg);
    if (writing) {
      if (!isAllowed(cur, roots.list)) return { allow: false, kind: 'write', reason: `cwd is outside the project: ${cur}`, segment: seg.trim() };
      if (!editOk && isGuardDir(cur, roots.projectDir)) return { allow: false, kind: 'write', reason: `writing from inside the guard directory: ${cur}`, segment: seg.trim() };
    }
    if (!writing) continue; // a bare `cd <outside>` only moves the effective cwd; the write check above covers it
    for (const t of pathTokens(seg)) {
      const abs = resolveToken(t, cur);
      if (writing && !editOk && isGuardFile(abs, roots.projectDir)) return { allow: false, kind: 'write', reason: `guard files are protected: ${t.replaceAll(SPACE, ' ')}`, segment: seg.trim() };
      if (!isAllowed(abs, roots.list)) return { allow: false, kind: 'write', reason: `path outside the project: ${t.replaceAll(SPACE, ' ')}`, segment: seg.trim() };
    }
  }
  return { allow: true, reason: 'writes stay inside allowed roots' };
}

function block(msg) { process.stderr.write(msg); process.exit(2); }

// Always runs as the hook entry point (no main-module check: a mismatched URL would silently allow everything).
try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let input;
  try { input = JSON.parse(raw); } catch { block(`[guard-bash] hook 入力を JSON として読めないため fail-closed でブロックしました (ADR-0014)\n`); }
  const d = decide(input);
  if (d.allow) process.exit(0);
  if (d.kind === 'push') block(`[guard-bash] main / master への直接 push / 削除をブロックしました (ADR-0014, .claude/rules/git.md)\n  コマンド: ${d.segment}\n  理由: ${d.reason}\n  作業ブランチに push して PR を作り、マージコミットで取り込む。\n`);
  block(`[guard-bash] プロジェクト外または guard への書き込みらしいコマンドをブロックしました (ADR-0014)\n  コマンド: ${d.segment}\n  理由: ${d.reason}\n  レビュー対象のファイルは変更しない。読むだけなら cat / grep / ls は通る。一時ファイルは scratchpad か一時ディレクトリに書く。guard 自身を直すときは CLAUDE_PLUGINS_GUARD_EDIT=1 を付けて Claude を起動する。\n`);
} catch (e) {
  block(`[guard-bash] 内部エラーのため fail-closed でブロックしました (ADR-0014): ${e?.message ?? e}\n`);
}
