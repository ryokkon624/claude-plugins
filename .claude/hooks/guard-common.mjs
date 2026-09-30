// Shared helpers for the PreToolUse guard hooks. ADR-0014.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export function norm(p) {
  let s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

export function under(target, root) { return target === root || target.startsWith(root + '/'); }

export function projectDirOf(env = process.env) {
  return env.CLAUDE_PROJECT_DIR ? path.resolve(env.CLAUDE_PROJECT_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

// CLAUDE_PLUGINS_GUARD_OFF=1  : emergency switch, disables both guards entirely (set at Claude Code launch).
// CLAUDE_PLUGINS_GUARD_EDIT=1 : lifts only the guard's self-protection so its own files can be edited;
//                               writes outside the project and pushes to main stay blocked.
export function guardOff(env = process.env) { return env.CLAUDE_PLUGINS_GUARD_OFF === '1'; }
export function guardEditAllowed(env = process.env) { return guardOff(env) || env.CLAUDE_PLUGINS_GUARD_EDIT === '1'; }

// Roots a write may target. `cwd` is deliberately not one of them.
export function allowedRoots(input, env = process.env) {
  const projectDir = projectDirOf(env);
  const raw = [
    projectDir,
    path.join(os.homedir(), '.claude', 'projects'), // auto memory lives here
    input?.scratchpad_dir,                          // hook input field (Claude Code >= 2.1.257)
    os.tmpdir(), env.TEMP, env.TMP, '/tmp',
  ].filter(Boolean);
  return { projectDir, list: raw.map(norm), labels: [projectDir, '~/.claude/projects', 'scratchpad', 'temp'] };
}

export function isAllowed(target, roots) { return roots.some((r) => under(target, r)); }

// The guard's own files: .claude/settings.json, .claude/settings.local.json and everything under .claude/hooks.
export function isGuardFile(target, projectDir) {
  const p = norm(projectDir);
  return target === `${p}/.claude/settings.json` || target === `${p}/.claude/settings.local.json` || under(target, `${p}/.claude/hooks`);
}

// A directory from which a bare-filename write would hit a guard file.
export function isGuardDir(dir, projectDir) {
  const p = norm(projectDir);
  return dir === `${p}/.claude` || under(dir, `${p}/.claude/hooks`);
}

const NULL_DEVICES = new Set(['/dev/null', 'nul', '/dev/stdout', '/dev/stderr', '/dev/stdin']);

// Extract path-like tokens from a shell command (absolute, ~/, ./, ../ or containing a separator).
export function pathTokens(cmd) {
  const out = [];
  // A path may follow whitespace, `=`, an opening quote/paren, or a redirect `>` (e.g. `>C:/x`, `2>err.log`).
  const re = /(?:^|[\s=("'`>])((?:[A-Za-z]:)?[\\/][^\s"'`<>|;&)]+|~[\\/][^\s"'`<>|;&)]*|\.{1,2}[\\/][^\s"'`<>|;&)]*|[^\s"'`<>|;&()=]+[\\/][^\s"'`<>|;&)]+)/g;
  let m;
  while ((m = re.exec(cmd))) {
    const t = m[1];
    if (/^[a-z]+:\/\//i.test(t)) continue;            // URLs
    if (NULL_DEVICES.has(t.toLowerCase())) continue;
    if (/^-/.test(t)) continue;
    out.push(t);
  }
  return out;
}

// Placeholder for spaces inside quoted path-like spans (kept out of `\s` so the token regexes treat it as part of the path).
export const SPACE = '';

export function resolveToken(t, cwd) {
  t = t.replaceAll(SPACE, ' ');
  if (t.startsWith('~')) return norm(path.join(os.homedir(), t.slice(1)));
  return norm(path.isAbsolute(t) || /^[A-Za-z]:/.test(t) ? t : path.join(cwd || process.cwd(), t));
}
