#!/usr/bin/env node
// Tests for the PreToolUse guard hooks. Run: node .claude/hooks/guard.test.mjs [--quiet]
// Each case pipes a hook-input JSON into the script and checks the exit code (0 = allow, 2 = block).
// --quiet (used by the SessionStart hook): prints nothing on success, one warning line on failure,
// and always exits 0 so the warning reaches Claude's context (SessionStart stdout is only injected on exit 0).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const quiet = process.argv.includes('--quiet');
const env = { ...process.env, CLAUDE_PROJECT_DIR: PROJECT };
delete env.CLAUDE_PLUGINS_GUARD_OFF;
delete env.CLAUDE_PLUGINS_GUARD_EDIT;

function run(script, input, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(HERE, script)], { input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...env, ...extraEnv }, encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr };
}

const TARGET = 'C:/work/java-migration/migration-agent-base';
const POSIX_PROJECT = '/' + PROJECT[0].toLowerCase() + PROJECT.slice(2).replace(/\\/g, '/'); // C:\x\y → /c/x/y
const scratch = path.join(os.tmpdir(), 'claude-scratch-test');
const W = (file_path, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path }, cwd: PROJECT, ...extra });
const B = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, cwd: PROJECT, ...extra });
const EDIT = { CLAUDE_PLUGINS_GUARD_EDIT: '1' };
const OFF = { CLAUDE_PLUGINS_GUARD_OFF: '1' };

const cases = [
  // guard-writes: roots
  ['guard-writes.mjs', W(path.join(PROJECT, 'output', 'x.json')), 0, 'write inside project (output/)'],
  ['guard-writes.mjs', { tool_name: 'Edit', tool_input: { file_path: path.join(PROJECT, 'README.md') } }, 0, 'edit inside project'],
  ['guard-writes.mjs', W(`${TARGET}/CLAUDE.md`), 2, 'write into review target'],
  ['guard-writes.mjs', W(path.join(PROJECT, '..', 'sibling', 'a.md')), 2, 'write to a sibling directory'],
  ['guard-writes.mjs', W(path.join(os.homedir(), '.claude', 'projects', 'x', 'memory', 'm.md')), 0, 'write to ~/.claude/projects (auto memory)'],
  ['guard-writes.mjs', W(path.join(os.homedir(), '.claude', 'settings.json')), 2, 'write to ~/.claude/settings.json is NOT allowed'],
  ['guard-writes.mjs', W(path.join(os.tmpdir(), 'x.txt')), 0, 'write to OS temp'],
  ['guard-writes.mjs', W(path.join(scratch, 'y.txt'), { scratchpad_dir: scratch }), 0, 'write to session scratchpad'],
  ['guard-writes.mjs', W(`${TARGET}/x.md`, { cwd: TARGET }), 2, 'cwd inside target does not allow'],
  ['guard-writes.mjs', { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:/elsewhere/n.ipynb' } }, 2, 'notebook outside'],
  // guard-writes: robustness (fail closed)
  ['guard-writes.mjs', { tool_name: 'Write', tool_input: { file_path: 123 } }, 2, 'non-string path fails closed'],
  ['guard-writes.mjs', { tool_name: 'Write', tool_input: {} }, 2, 'missing path fails closed'],
  ['guard-writes.mjs', '{not json', 2, 'unparseable stdin fails closed'],
  ['guard-writes.mjs', '', 2, 'empty stdin fails closed'],
  // guard-writes: the guard protects itself
  ['guard-writes.mjs', W(path.join(PROJECT, '.claude', 'settings.json')), 2, 'editing .claude/settings.json is blocked'],
  ['guard-writes.mjs', W(path.join(PROJECT, '.claude', 'settings.local.json')), 2, 'editing .claude/settings.local.json is blocked'],
  ['guard-writes.mjs', W(path.join(PROJECT, '.claude', 'hooks', 'guard-bash.mjs')), 2, 'editing a hook script is blocked'],
  ['guard-writes.mjs', W(path.join(PROJECT, '.claude', 'hooks', 'guard-bash.mjs')), 0, 'GUARD_EDIT allows editing the guard', EDIT],
  ['guard-writes.mjs', W(`${TARGET}/CLAUDE.md`), 2, 'GUARD_EDIT still blocks writes outside', EDIT],
  ['guard-writes.mjs', W('C:/elsewhere/a.md'), 0, 'GUARD_OFF allows everything', OFF],
  // guard-bash: git push
  ['guard-bash.mjs', B('git push origin main'), 2, 'push origin main'],
  ['guard-bash.mjs', B('git push -u origin master'), 2, 'push -u origin master'],
  ['guard-bash.mjs', B('git push --force origin HEAD:main'), 2, 'force push HEAD:main'],
  ['guard-bash.mjs', B('git push origin refs/heads/main'), 2, 'push refs/heads/main'],
  ['guard-bash.mjs', B('git fetch && git push origin main'), 2, 'push main in a && chain'],
  ['guard-bash.mjs', B('git fetch\ngit push origin main\ngit status'), 2, 'push main in a multi-line command'],
  ['guard-bash.mjs', B('git push origin main\n'), 2, 'push main with trailing newline'],
  ['guard-bash.mjs', B('git push origin main'), 2, 'GUARD_EDIT still blocks push to main', EDIT],
  ['guard-bash.mjs', B('git push -u origin fix/A4-write-guard-hook'), 0, 'push feature branch'],
  ['guard-bash.mjs', B('git push origin --delete docs/git-rules'), 0, 'delete remote feature branch'],
  ['guard-bash.mjs', B('git push --delete origin main'), 2, 'delete remote main is blocked'],
  ['guard-bash.mjs', B('git push origin :master'), 2, 'delete via empty refspec is blocked'],
  ['guard-bash.mjs', B('git status && git log --oneline -3'), 0, 'non-push git'],
  ['guard-bash.mjs', B('git commit -m "fix: git push origin main をブロックする hook を追加 (A4-ba090b, ADR-0014)" && git push -u origin fix/x'), 0, 'commit message quoting the rule is not a push'],
  ['guard-bash.mjs', B(`git commit -m "docs: ${TARGET} の A4 指摘に対応"`), 0, 'commit message naming the target is not a write'],
  // guard-bash: writes outside the project
  ['guard-bash.mjs', B(`echo hi > ${TARGET}/x.txt`), 2, 'redirect into review target'],
  ['guard-bash.mjs', B(`echo hi >${TARGET}/x.txt`), 2, 'redirect without a space'],
  ['guard-bash.mjs', B(`node x.mjs 2>${TARGET}/err.log`), 2, 'stderr redirect into review target'],
  ['guard-bash.mjs', B(`echo hi > "${TARGET}/x.txt"`), 2, 'redirect to a quoted path (no spaces)'],
  ['guard-bash.mjs', B('cp a.md "C:/work/java migration/x.md"'), 2, 'quoted path with spaces outside is blocked'],
  ['guard-bash.mjs', B('cd "C:/other dir" && rm -rf .'), 2, 'cd to a quoted path with spaces then rm is blocked'],
  ['guard-bash.mjs', B(`Copy-Item a.md ${TARGET}/a.md`), 2, 'PowerShell Copy-Item into target'],
  ['guard-bash.mjs', B(`Set-Content -Path ${TARGET}/x.txt -Value y`), 2, 'PowerShell Set-Content into target'],
  ['guard-bash.mjs', B(`Get-Content ${TARGET}/CLAUDE.md`), 0, 'PowerShell Get-Content is read-only'],
  ['guard-bash.mjs', B(`Invoke-WebRequest https://x/y -OutFile ${TARGET}/y`), 2, 'PowerShell -OutFile into target'],
  ['guard-bash.mjs', B(`sed -i 's/a/b/' ${TARGET}/CLAUDE.md`), 2, 'sed -i on review target'],
  ['guard-bash.mjs', B(`cp README.md ${TARGET}/README.md`), 2, 'cp into review target'],
  ['guard-bash.mjs', B(`git -C ${TARGET} commit -am x`), 2, 'git -C target commit'],
  ['guard-bash.mjs', B(`cd ${TARGET} && git checkout -- .`), 2, 'cd target then git checkout'],
  ['guard-bash.mjs', B(`cd "${TARGET}" && echo x > notes.md`), 2, 'cd target (quoted) then bare-filename redirect'],
  ['guard-bash.mjs', B('git commit -m x', { cwd: TARGET }), 2, 'cwd outside project with a write'],
  ['guard-bash.mjs', B(`cat ${TARGET}/CLAUDE.md | head -5`), 0, 'reading the target is fine'],
  ['guard-bash.mjs', B(`grep -rn foo ${TARGET}/.claude`), 0, 'grep on the target is fine'],
  ['guard-bash.mjs', B(`ls ${TARGET}/.claude`, { cwd: TARGET }), 0, 'read-only command with cwd outside'],
  ['guard-bash.mjs', B('echo x > output/harness-review/test.txt'), 0, 'redirect inside project'],
  ['guard-bash.mjs', B('cd output && echo x > test.txt'), 0, 'cd inside project then redirect'],
  ['guard-bash.mjs', B(`cd ${POSIX_PROJECT} && git add -A && git commit -m x`), 0, 'cd to the project via a Git Bash /c/ path then commit'],
  ['guard-bash.mjs', B(`echo x > ${POSIX_PROJECT}/output/t.txt`), 0, 'redirect to a Git Bash /c/ path inside the project'],
  ['guard-bash.mjs', B('echo x > /c/work/java-migration/migration-agent-base/t.txt'), 2, 'redirect to a Git Bash /c/ path outside is blocked'],
  ['guard-bash.mjs', B(`cd C:/other && ls; cd ${PROJECT.replace(/\\/g, '/')} && echo x > f.txt`), 0, 'non-writing cd outside then write inside is fine'],
  // CLAUDE_PROJECT_DIR handed to the hook in Git Bash form (as Claude Code does on Windows)
  ['guard-bash.mjs', B(`cd ${POSIX_PROJECT} && git add -A && git commit -m x`), 0, 'POSIX CLAUDE_PROJECT_DIR: cd /c/ project then commit', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-bash.mjs', B('echo x > output/t.txt'), 0, 'POSIX CLAUDE_PROJECT_DIR: relative write inside (Windows cwd)', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-bash.mjs', B(`echo x > ${TARGET}/t.txt`), 2, 'POSIX CLAUDE_PROJECT_DIR: write outside is blocked', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-writes.mjs', W(path.join(PROJECT, 'README.md')), 0, 'POSIX CLAUDE_PROJECT_DIR: Write inside (Windows path)', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-writes.mjs', W(path.join(PROJECT, '.claude', 'hooks', 'guard-bash.mjs')), 2, 'POSIX CLAUDE_PROJECT_DIR: guard file still protected', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-writes.mjs', W(`${TARGET}/CLAUDE.md`), 2, 'POSIX CLAUDE_PROJECT_DIR: Write outside is blocked', { CLAUDE_PROJECT_DIR: POSIX_PROJECT }],
  ['guard-bash.mjs', B('echo x > output/t.txt', { cwd: POSIX_PROJECT }), 0, 'POSIX cwd in hook input: relative write inside'],
  ['guard-bash.mjs', B('node script.mjs > /dev/null 2>&1'), 0, '/dev/null and 2>&1 are not write targets'],
  ['guard-bash.mjs', B(`echo x > ${path.join(os.tmpdir(), 'x.txt').replace(/\\/g, '/')}`), 0, 'redirect to temp'],
  ['guard-bash.mjs', B('echo x > /tmp/x.txt'), 0, 'redirect to /tmp'],
  ['guard-bash.mjs', B('mkdir -p output/x && cp a.json output/x/'), 0, 'mkdir/cp inside project (relative)'],
  ['guard-bash.mjs', B('cp a.json ../sibling/'), 2, 'cp to a relative path outside'],
  ['guard-bash.mjs', B('curl -sL -o vendor/m.js https://cdn.example.com/m.js'), 0, 'URL is not a path'],
  // guard-bash: the guard protects itself
  ['guard-bash.mjs', B('sed -i s/a/b/ .claude/settings.json'), 2, 'sed on the guard settings is blocked'],
  ['guard-bash.mjs', B('echo x > .claude/settings.local.json'), 2, 'redirect into settings.local.json is blocked'],
  ['guard-bash.mjs', B('cd .claude/hooks && sed -i s/x/y/ guard-bash.mjs'), 2, 'cd into hooks dir then bare-filename edit is blocked'],
  ['guard-bash.mjs', B('cd .claude && echo x > settings.json'), 2, 'cd into .claude then bare-filename redirect is blocked'],
  ['guard-bash.mjs', B('cat .claude/hooks/guard-bash.mjs'), 0, 'reading the guard is fine'],
  ['guard-bash.mjs', B('cp scratch/guard-bash.mjs .claude/hooks/guard-bash.mjs'), 0, 'GUARD_EDIT allows replacing a hook', EDIT],
  ['guard-bash.mjs', B(`cp a.md ${TARGET}/a.md`), 2, 'GUARD_EDIT still blocks writes outside', EDIT],
  ['guard-bash.mjs', B('git push origin main'), 0, 'GUARD_OFF allows everything', OFF],
  // guard-bash: robustness
  ['guard-bash.mjs', '{not json', 2, 'unparseable stdin fails closed'],
  ['guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: ['git', 'push'] } }, 0, 'non-string command is stringified, no push to main'],
];

let failed = 0;
const lines = [];
for (const [script, input, expected, label, extraEnv] of cases) {
  const r = run(script, input, extraEnv);
  const ok = r.code === expected;
  if (!ok) failed++;
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${script.padEnd(16)} exit=${r.code} (expected ${expected})  ${label}${ok ? '' : '\n      stderr: ' + r.stderr.trim()}`);
}
if (quiet) {
  if (failed) console.log(`[guard.test] WARNING: ${failed}/${cases.length} guard hook tests FAILED — the write guards (ADR-0014) may not be protecting anything. Run: node .claude/hooks/guard.test.mjs`);
  process.exit(0);
}
console.log(lines.join('\n'));
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
