#!/usr/bin/env node
// S5: render report.html from a run directory's JSON files. Self-contained (mermaid inlined). No npm deps.
//
//   node render.mjs <run-dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const AXES = { A: '適材適所', B: 'フォーマット', C: 'レビュー行為', D: 'ADR', E: '自己判断の記録' };
const SEV_ORDER = { must: 0, should: 1, 'nice to have': 2 };

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => (exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => String(s).replace(/[^\w-]+/g, '_');
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const sevClass = (s) => ({ must: 'sev-must', should: 'sev-should', 'nice to have': 'sev-nice' }[s] ?? 'sev-other');
const verdictClass = (v) => ({ CONFIRMED: 'v-ok', PLAUSIBLE: 'v-maybe', REJECTED: 'v-no', UNVERIFIED: 'v-none' }[v] ?? 'v-none');
const mmLabel = (s) => String(s ?? '').replace(/["<>]/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 60);
const mmActor = (s) => String(s ?? 'unknown').replace(/[^\w]/g, '_');

function main() {
  const runDir = path.resolve(process.argv[2] ?? '');
  if (!exists(path.join(runDir, 'run.json'))) { console.error('usage: node render.mjs <run-dir>'); process.exit(1); }
  const run = readJson(path.join(runDir, 'run.json'));
  const harness = readJson(path.join(runDir, 'harness.json'));
  const flows = readJson(path.join(runDir, 'flows.json'));
  const findings = readJson(path.join(runDir, 'findings.json'));
  const verification = readJson(path.join(runDir, 'verification.json'));
  const mermaid = fs.readFileSync(path.join(SKILL_DIR, 'vendor', 'mermaid.min.js'), 'utf8');

  const html = page({ run, harness, flows, findings, verification, mermaid });
  const outPath = path.join(runDir, 'report.html');
  fs.writeFileSync(outPath, html);
  const latest = path.join(path.dirname(runDir), 'latest.html');
  fs.copyFileSync(outPath, latest);
  run.stages.S5 = { ...(run.stages.S5 ?? {}), status: 'done', finished_at: new Date().toISOString(), report: 'report.html', bytes: Buffer.byteLength(html) };
  const allDone = ['S1', 'S2', 'S3', 'S4'].every((s) => ['done', 'skipped'].includes(run.stages[s]?.status));
  run.finished_at = allDone ? new Date().toISOString() : null;
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ report: outPath.split(path.sep).join('/'), latest: latest.split(path.sep).join('/'), bytes: Buffer.byteLength(html) }));
}

// ---------------------------------------------------------------- page

function page(d) {
  const { run, harness, flows, findings, verification } = d;
  const title = `harness-review: ${run.target.name}`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} ${esc(run.run_id)}</title>
<style>${css()}</style>
</head>
<body>
<nav class="toc">
  <a href="#top"><strong>harness-review</strong></a>
  <a href="#findings">Findings</a>
  <a href="#harness">① ハーネス</a>
  <a href="#flows">② フロー</a>
  <a href="#matrix">マトリクス</a>
  <a href="#verification">検証ログ</a>
</nav>
<main>
${header(d)}
${findingsSection(findings, harness)}
${harnessSection(harness)}
${flowsSection(flows, harness)}
${matrixSection(findings)}
${verificationSection(verification, findings, run)}
</main>
<script>${d.mermaid}</script>
<script>
${mermaidScript()}
${filterScript()}
</script>
</body>
</html>`;
}

function header({ run, harness, flows, findings }) {
  const s = findings?.summary;
  const sev = s?.by_severity ?? {};
  const vp = s?.vs_previous;
  return `<header id="top">
<h1>${esc(run.target.name)} <small>ハーネスレビュー</small></h1>
<p class="meta">対象: <code>${esc(run.target.path)}</code> ／ run: <code>${esc(run.run_id)}</code> ／ 開始 ${esc(run.started_at)}${run.finished_at ? ` ／ 終了 ${esc(run.finished_at)}` : ''}${run.options?.skip_verify ? ' ／ <span class="badge warn">検証スキップ</span>' : ''}</p>
<div class="cards">
  <div class="card"><div class="k">ファイル</div><div class="v">${num(harness?.files?.length)}</div><div class="s">常駐 ≈ ${num(harness?.summary?.always_loaded_tokens_est)} tok</div></div>
  <div class="card"><div class="k">フロー</div><div class="v">${num(flows?.summary?.total)}</div><div class="s">${flows ? Object.entries(flows.summary.by_kind).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') : ''}</div></div>
  <div class="card"><div class="k">Findings</div><div class="v">${num(findings?.findings?.length)}</div><div class="s"><span class="sev-must pill">must ${sev.must ?? 0}</span> <span class="sev-should pill">should ${sev.should ?? 0}</span> <span class="sev-nice pill">nice to have ${sev['nice to have'] ?? 0}</span></div></div>
  <div class="card"><div class="k">前回比</div><div class="v">${vp?.previous_run ? `${vp.resolved} 解消` : '初回'}</div><div class="s">${vp?.previous_run ? `新規 ${vp.new} · 継続 ${vp.continued} · 前回 ${esc(vp.previous_run)}` : '比較対象なし'}</div></div>
</div>
</header>`;
}

// ---------------------------------------------------------------- findings

function findingsSection(findings, harness) {
  if (!findings) return `<section id="findings"><h2>Findings と改善案</h2><p class="empty">findings.json がありません（③未実行）。</p></section>`;
  const list = [...findings.findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const fileIds = new Map((harness?.files ?? []).map((f) => [f.path, f.id]));
  const chips = (name, values) => values.map((v) => `<label class="chip"><input type="checkbox" data-filter="${name}" value="${esc(v)}" checked> ${esc(v)}</label>`).join('');
  const axes = [...new Set(list.map((f) => f.axis))].sort();
  const verdicts = [...new Set(list.map((f) => f.verification?.verdict ?? 'UNVERIFIED'))];
  return `<section id="findings">
<h2>Findings と改善案</h2>
<div class="filters">
  <div><span class="fl">severity</span> ${chips('severity', ['must', 'should', 'nice to have'])}</div>
  <div><span class="fl">軸</span> ${chips('axis', axes)}</div>
  <div><span class="fl">basis</span> ${chips('basis', ['official', 'custom'])}</div>
  <div><span class="fl">verdict</span> ${chips('verdict', verdicts)}</div>
  <div><span class="fl">状態</span> ${chips('status', ['new', 'continued'])}</div>
  <span class="count" id="findings-count"></span>
</div>
${list.map((f) => findingCard(f, fileIds)).join('\n')}
${findings.resolved?.length ? `<details class="resolved"><summary>前回から解消した finding（${findings.resolved.length}）</summary><ul>${findings.resolved.map((r) => `<li><span class="${sevClass(r.severity)} pill">${esc(r.severity)}</span> <code>${esc(r.id)}</code> ${esc(r.target?.id ?? '')} — ${esc(r.claim)}</li>`).join('')}</ul></details>` : ''}
</section>`;
}

function findingCard(f, fileIds) {
  const v = f.verification ?? {};
  const ev = (f.evidence ?? []).map((e) => {
    const fid = fileIds.get(e.file);
    const link = fid ? `<a href="#file-${slug(fid)}">${esc(e.file)}</a>` : esc(e.file);
    return `<li>${link}${e.line != null ? `:${e.line}` : ''}${e.quote ? ` — <q>${esc(e.quote)}</q>` : ''}</li>`;
  }).join('');
  const targetLink = f.target?.type === 'flow' || f.target?.type === 'step' ? `<a href="#flow-${slug(String(f.target.id).split('#')[0])}">${esc(f.target.id)}</a>` : f.target?.type === 'file' && f.target?.id ? `<a href="#file-${slug(f.target.id)}">${esc(f.target.id)}</a>` : esc(f.target?.id ?? 'harness');
  return `<article class="finding ${sevClass(f.severity)}" id="${esc(f.id)}" data-severity="${esc(f.severity)}" data-axis="${esc(f.axis)}" data-basis="${esc(f.basis)}" data-verdict="${esc(v.verdict ?? 'UNVERIFIED')}" data-status="${esc(f.status ?? 'new')}">
<header>
  <span class="pill ${sevClass(f.severity)}">${esc(f.severity)}</span>
  <span class="pill axis">${esc(f.axis)} ${esc(AXES[f.axis] ?? '')}</span>
  <span class="pill check">${esc(f.check ?? '')}</span>
  <span class="pill ${f.basis === 'official' ? 'basis-official' : 'basis-custom'}">${esc(f.basis)}</span>
  <span class="pill ${verdictClass(v.verdict)}">${esc(v.verdict ?? 'UNVERIFIED')}</span>
  ${f.status === 'continued' ? '<span class="pill continued">継続</span>' : '<span class="pill new">新規</span>'}
  <code class="fid">${esc(f.id)}</code>
</header>
<div class="target">対象: ${targetLink}${f.target?.line != null ? `:${f.target.line}` : ''}</div>
<div class="claim">${esc(f.claim)}</div>
<div class="block"><div class="bl">根拠</div><ul class="evidence">${ev || '<li class="empty">（evidence なし）</li>'}</ul></div>
<div class="block"><div class="bl">改善案</div><div>${esc(f.proposal?.summary ?? '')}</div>${f.proposal?.change ? `<pre class="change">${esc(f.proposal.change)}</pre>` : ''}</div>
${v.note ? `<div class="block verify"><div class="bl">検証</div><div>${esc(v.note)}</div>${v.evidence_check ? `<div class="s">evidence ${esc(v.evidence_check)} · claim ${esc(v.claim_check)} · proposal ${esc(v.proposal_check)}</div>` : ''}</div>` : ''}
</article>`;
}

// ---------------------------------------------------------------- harness ①

function harnessSection(h) {
  if (!h) return `<section id="harness"><h2>① ハーネス</h2><p class="empty">harness.json がありません。</p></section>`;
  const byLoad = Object.entries(h.summary.by_load ?? {}).map(([k, v]) => `<span class="pill load-${esc(k)}">${esc(k)} ${v}</span>`).join(' ');
  const counts = Object.entries(h.summary.counts ?? {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`).join('');
  const files = [...h.files].sort((a, b) => (a.kind + a.path).localeCompare(b.kind + b.path));
  const rows = files.map((f) => `<tr id="file-${slug(f.id)}" class="filerow">
<td><span class="pill kind">${esc(f.kind)}</span></td>
<td><code>${esc(f.path)}</code>${f.name_mismatch ? ` <span class="badge warn">name≠${esc(f.name_mismatch)}</span>` : ''}${f.loadable === false ? ` <span class="badge err">ロード不可</span>` : ''}${f.referenced === false ? ` <span class="badge warn">未参照</span>` : ''}</td>
<td><span class="pill load-${esc(f.load)}">${esc(f.load)}</span></td>
<td class="n">${num(f.size?.lines)}</td><td class="n">${num(f.size?.tokens_est)}</td>
<td>${esc(f.summary ?? '')}${fileDetails(f)}</td>
</tr>`).join('\n');
  const memRows = (h.memory ?? []).map((m) => `<tr id="memory-${slug(m.id ?? `memory:${m.path}`)}">
<td><code>${esc(m.path)}</code>${m.exists === false ? ' <span class="badge err">存在しない</span>' : ''}</td>
<td>${esc(m.kind)}</td><td>${esc(m.lifecycle ?? '')}</td>
<td>${esc(m.description ?? '')}</td>
<td>${opsList(m.writers)}</td><td>${opsList(m.readers)}</td>
<td>${!m.writers?.length && m.readers?.length ? '<span class="badge warn">read-only</span>' : ''}${m.writers?.length && !m.readers?.length ? '<span class="badge warn">write-only</span>' : ''}</td>
</tr>`).join('\n');
  const hookRows = (h.hooks ?? []).map((k) => `<tr><td><code>${esc(k.event)}</code></td><td><code>${esc(k.matcher)}</code></td><td>${esc(k.type)}</td><td><code>${esc(k.command ?? k.prompt ?? k.url ?? '')}</code></td><td>${k.script ? `${esc(k.script.path)} ${k.script.exists ? '' : '<span class="badge err">存在しない</span>'}${k.script.outside_target ? '<span class="badge warn">対象外</span>' : ''}` : ''}</td><td>${esc(k.source)}</td></tr>`).join('\n');
  const mcpRows = (h.mcp_servers ?? []).map((m) => `<tr><td><code>${esc(m.name)}</code></td><td>${esc(m.transport)}</td><td><code>${esc(m.command ?? m.url ?? '')}</code></td><td>${esc(m.source)}</td></tr>`).join('\n');
  const perms = (h.permissions ?? []).map((p) => `<li><code>${esc(p.source)}</code>: allow ${(p.allow ?? []).length} / deny ${(p.deny ?? []).length} / ask ${(p.ask ?? []).length}${p.defaultMode ? ` / defaultMode ${esc(p.defaultMode)}` : ''}</li>`).join('');
  return `<section id="harness">
<h2>① ハーネス</h2>
<div class="row">
  <table class="small"><thead><tr><th>種別</th><th>数</th></tr></thead><tbody>${counts}</tbody></table>
  <div><div class="bl">ロードタイミング</div><p>${byLoad}</p><div class="bl">常駐トークン概算</div><p><strong>${num(h.summary.always_loaded_tokens_est)}</strong></p><div class="bl">レイアウト</div><p>${esc((h.target.layouts ?? []).join(' + ') || 'なし')}</p></div>
</div>
<h3>ファイル</h3>
<div class="scroll"><table class="files"><thead><tr><th>種別</th><th>パス</th><th>load</th><th>行</th><th>tok≈</th><th>要約</th></tr></thead><tbody>${rows}</tbody></table></div>
<h3>memory</h3>
${h.memory?.length ? `<p>${h.summary.memory?.has_custom_memory ? '独自 memory あり' : '独自 memory なし'} ／ write-only ${h.summary.memory?.write_only?.length ?? 0} ／ read-only ${h.summary.memory?.read_only?.length ?? 0} ／ ADR 相当 ${h.summary.memory?.adr_like?.length ?? 0}</p>
<div class="scroll"><table><thead><tr><th>場所</th><th>種類</th><th>寿命</th><th>説明</th><th>書く</th><th>読む</th><th></th></tr></thead><tbody>${memRows}</tbody></table></div>` : '<p class="empty">memory は検出されませんでした。</p>'}
<h3>hooks</h3>
${hookRows ? `<div class="scroll"><table><thead><tr><th>event</th><th>matcher</th><th>type</th><th>command</th><th>script</th><th>source</th></tr></thead><tbody>${hookRows}</tbody></table></div>` : '<p class="empty">hooks なし</p>'}
<h3>permissions / MCP</h3>
${perms ? `<ul>${perms}</ul>` : '<p class="empty">permissions の設定なし</p>'}
${mcpRows ? `<div class="scroll"><table><thead><tr><th>server</th><th>transport</th><th>command / url</th><th>source</th></tr></thead><tbody>${mcpRows}</tbody></table></div>` : '<p class="empty">MCP サーバなし</p>'}
</section>`;
}

function opsList(ops) {
  if (!ops?.length) return '<span class="empty">—</span>';
  return `<ul class="ops">${ops.map((o) => `<li><code>${esc(o.file)}</code>${o.line != null ? `:${o.line}` : ''}${o.trigger ? ` <span class="s">${esc(o.trigger)}</span>` : ''}</li>`).join('')}</ul>`;
}

function fileDetails(f) {
  const fm = f.frontmatter ? `<div><span class="bl">frontmatter</span> <code>${esc(JSON.stringify(f.frontmatter))}</code>${f.frontmatter_error ? ` <span class="badge err">${esc(f.frontmatter_error)}</span>` : ''}${f.frontmatter_unknown_keys?.length ? ` <span class="badge warn">未知キー: ${esc(f.frontmatter_unknown_keys.join(', '))}</span>` : ''}${f.frontmatter_ignored_keys?.length ? ` <span class="badge warn">無視されるキー: ${esc(f.frontmatter_ignored_keys.join(', '))}</span>` : ''}</div>` : '';
  const heads = f.headings?.length ? `<div><span class="bl">見出し</span> ${f.headings.slice(0, 40).map((h) => `<span class="h${h.level}">${esc(h.text)}</span>`).join(' › ')}${f.headings.length > 40 ? ' …' : ''}</div>` : '';
  const opening = f.opening ? `<div><span class="bl">冒頭</span> 役割 ${f.opening.states_role ? '✓' : '✗'} · いつ ${f.opening.states_when ? '✓' : '✗'} · 出力 ${f.opening.states_output ? '✓' : '✗'} — ${esc(f.opening.note ?? '')}</div>` : '';
  const mix = f.content_mix ? `<div><span class="bl">内容</span> ${Object.entries(f.content_mix).filter(([, v]) => v > 0).map(([k, v]) => `${esc(k)} ${Math.round(v * 100)}%`).join(' · ')}</div>` : '';
  const facts = f.facts?.length ? `<div><span class="bl">事実</span><ul>${f.facts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const pre = f.preloads_skills?.length ? `<div><span class="bl">注入 skill</span> ${f.preloads_skills.map((s) => `<code>${esc(s.name)}</code>${s.resolved ? '' : ' <span class="badge err">存在しない</span>'}${s.blocked_by_disable_model_invocation ? ' <span class="badge warn">注入不可</span>' : ''}`).join(', ')} ／ 起動時 ≈ ${num(f.context_at_spawn_tokens_est)} tok</div>` : '';
  const preBy = f.preloaded_by?.length ? `<div><span class="bl">注入先</span> ${f.preloaded_by.map((a) => `<code>${esc(a)}</code>`).join(', ')}</div>` : '';
  const exitc = f.exit_codes_used ? `<div><span class="bl">exit code</span> ${Object.entries(f.exit_codes_used).map(([c, ls]) => `exit ${esc(c)} (L${ls.join(', ')})`).join(' · ')}</div>` : '';
  const body = [fm, opening, mix, heads, pre, preBy, exitc, facts].filter(Boolean).join('');
  return body ? `<details class="fd"><summary>詳細</summary>${body}<div class="s">sha256 ${esc((f.sha256 ?? '').slice(0, 12))} · ${esc(f.id)}</div></details>` : '';
}

// ---------------------------------------------------------------- flows ②

function flowsSection(fl, h) {
  if (!fl) return `<section id="flows"><h2>② フロー</h2><p class="empty">flows.json がありません（②未実行）。</p></section>`;
  const rows = fl.flows.map((f) => `<tr><td><a href="#flow-${slug(f.id)}">${esc(f.name)}</a></td><td><span class="pill kind">${esc(f.kind)}</span>${f.confidence ? ` <span class="s">${esc(f.confidence)}</span>` : ''}</td><td>${esc(f.entry?.type ?? '')}</td><td class="n">${(f.participants ?? []).length}</td><td>${(f.artifacts ?? []).map((a) => esc(a.type)).join(', ')}</td><td class="n">${(f.review_points ?? []).length}</td><td class="n">${(f.judgment_points ?? []).length}</td></tr>`).join('\n');
  const nodeId = new Map(fl.flows.map((f, i) => [f.id, `f${i}`]));
  const graphLines = ['graph LR'];
  for (const f of fl.flows) graphLines.push(`  ${nodeId.get(f.id)}["${mmLabel(f.name)}"]`);
  for (const e of fl.graph ?? []) {
    const from = nodeId.get(e.from);
    const to = nodeId.get(e.to) ?? (() => { const id = `u${graphLines.length}`; graphLines.push(`  ${id}(["${mmLabel(e.to)}"])`); return id; })();
    if (from) graphLines.push(`  ${from} --> ${to}`);
  }
  const graph = graphLines.length > 1 ? `<pre class="mermaid">${esc(graphLines.join('\n'))}</pre>` : '';
  const notFlows = fl.not_flows?.length ? `<details><summary>フローではないと判定した入口（${fl.not_flows.length}）</summary><ul>${fl.not_flows.map((n) => `<li><code>${esc(n.entry)}</code> — ${esc(n.reason)}</li>`).join('')}</ul></details>` : '';
  return `<section id="flows">
<h2>② フロー</h2>
<p>${num(fl.summary.total)} 本 ／ レビュー行為あり ${fl.summary.with_review_points} ／ 自己判断点あり ${fl.summary.with_judgment_points}${fl.summary.entries_without_flow?.length ? ` ／ <span class="badge warn">フロー未抽出の入口 ${fl.summary.entries_without_flow.length}</span>` : ''}</p>
<div class="scroll"><table><thead><tr><th>フロー</th><th>kind</th><th>入口</th><th>参加</th><th>成果物</th><th>レビュー</th><th>判断点</th></tr></thead><tbody>${rows}</tbody></table></div>
${notFlows}
<h3>フロー間グラフ</h3>
${graph || '<p class="empty">呼び出し関係なし</p>'}
${fl.flows.map((f) => flowDetail(f, h)).join('\n')}
</section>`;
}

function flowDetail(f, h) {
  const fileIds = new Map((h?.files ?? []).map((x) => [x.path, x.id]));
  const steps = (f.steps ?? []).map((s) => `<tr><td class="n">${s.n}</td><td><code>${esc(s.actor)}</code></td><td>${esc(s.action)}${s.spawn ? `<div class="s">spawn → <code>${esc(s.spawn.target)}</code> (${esc(s.spawn.timing)}${s.spawn.max_iterations ? `, max ${s.spawn.max_iterations}` : ''}${s.spawn.model ? `, ${esc(s.spawn.model)}` : ''})</div>` : ''}</td><td>${(s.outputs ?? []).map((o) => `<code>${esc(o)}</code>`).join(' ')}</td><td class="s">${s.evidence ? `${esc(s.evidence.file)}:${s.evidence.line}` : ''}</td></tr>`).join('');
  const reviews = (f.review_points ?? []).map((r) => `<li>step ${r.step}: <code>${esc(r.reviewer)}</code> が <code>${esc(r.reviewee)}</code> の「${esc(r.subject)}」を検査 ／ 基準: ${esc(r.criteria)} ／ 別コンテキスト: ${esc(String(r.separate_context))} ／ 不合格時: ${esc(r.on_fail)}</li>`).join('');
  const judgments = (f.judgment_points ?? []).map((j) => `<li>step ${j.step}: ${esc(j.description)} ／ 記録指示: ${j.logging_instructed ? `あり → <code>${esc(j.log_target ?? '')}</code>` : '<span class="badge warn">なし</span>'}</li>`).join('');
  const mm = f.mermaid && f.mermaid.trim() ? f.mermaid : fallbackSequence(f);
  const defs = (f.defined_in ?? []).map((d) => { const id = fileIds.get(d.file); return id ? `<a href="#file-${slug(id)}">${esc(d.file)}</a>${d.lines ? ` (${esc(d.lines)})` : ''}` : esc(d.file); }).join(', ');
  return `<details class="flow" id="flow-${slug(f.id)}">
<summary><strong>${esc(f.name)}</strong> <span class="pill kind">${esc(f.kind)}</span> <span class="s">step ${(f.steps ?? []).length} · レビュー ${(f.review_points ?? []).length} · 判断点 ${(f.judgment_points ?? []).length}</span> <code class="fid">${esc(f.id)}</code></summary>
<div class="s">定義: ${defs} ／ 入口: ${esc(f.entry?.type)} — ${esc(f.entry?.detail ?? '')} ／ オーケストレータ: <code>${esc(f.orchestrator?.context ?? '')}</code></div>
<pre class="mermaid">${esc(mm)}</pre>
<details><summary>mermaid ソース</summary><pre>${esc(mm)}</pre></details>
<div class="scroll"><table class="steps"><thead><tr><th>#</th><th>actor</th><th>action</th><th>出力</th><th>根拠</th></tr></thead><tbody>${steps}</tbody></table></div>
<div class="row2">
  <div><div class="bl">成果物</div><ul>${(f.artifacts ?? []).map((a) => `<li>${esc(a.type)}: <code>${esc(a.target ?? '')}</code></li>`).join('') || '<li class="empty">なし</li>'}</ul></div>
  <div><div class="bl">レビュー行為</div><ul>${reviews || '<li class="empty">なし</li>'}</ul></div>
  <div><div class="bl">自己判断点</div><ul>${judgments || '<li class="empty">なし</li>'}</ul></div>
</div>
${f.termination ? `<div class="s">終了: ${esc(f.termination)}</div>` : ''}
</details>`;
}

function fallbackSequence(f) {
  const lines = ['sequenceDiagram'];
  const actors = [...new Set((f.steps ?? []).map((s) => s.actor ?? 'main'))];
  for (const a of actors) lines.push(`  participant ${mmActor(a)} as ${mmLabel(a)}`);
  for (const s of f.steps ?? []) {
    const from = mmActor(s.actor ?? 'main');
    const to = s.spawn ? mmActor(s.spawn.target) : from;
    if (s.spawn && !actors.includes(s.spawn.target)) { actors.push(s.spawn.target); lines.push(`  participant ${to} as ${mmLabel(s.spawn.target)}`); }
    lines.push(`  ${from}${s.spawn ? '->>' : '->>'}${to}: ${s.n}. ${mmLabel(s.action)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- matrix

function matrixSection(findings) {
  if (!findings?.matrix) return `<section id="matrix"><h2>チェックマトリクス</h2><p class="empty">③未実行</p></section>`;
  const { checks, cells } = findings.matrix;
  const cell = new Map(cells.map((c) => [`${c.target}|${c.check}`, c]));
  const sym = { finding: '●', pass: '✓', na: '—', unchecked: '?', 'rejected-only': '✕' };
  const legend = Object.entries(findings.summary.matrix ?? {}).map(([k, v]) => `<span class="pill m-${esc(k)}">${sym[k] ?? k} ${esc(k)} ${v}</span>`).join(' ');
  const axisTables = Object.keys(AXES).map((ax) => {
    const axChecks = checks.filter((c) => c.axis === ax);
    const axTargets = [...new Set(cells.filter((c) => c.axis === ax).map((c) => c.target))].sort();
    if (!axChecks.length || !axTargets.length) return `<h3>${esc(ax)} ${esc(AXES[ax])}</h3><p class="empty">この軸の出力がありません</p>`;
    const head = axChecks.map((c) => `<th title="${esc(c.title)}">${esc(c.id)}</th>`).join('');
    const rows = axTargets.map((t) => `<tr><th class="tgt"><code>${esc(t)}</code></th>${axChecks.map((c) => { const x = cell.get(`${t}|${c.id}`); const st = x?.status ?? 'unchecked'; const link = x?.finding_ids?.length ? `<a href="#${esc(x.finding_ids[0])}" title="${esc(x.finding_ids.join(', '))}">${sym[st]}${x.finding_ids.length > 1 ? x.finding_ids.length : ''}</a>` : sym[st]; return `<td class="m-${st}">${link}</td>`; }).join('')}</tr>`).join('\n');
    const counts = {};
    for (const c of cells.filter((c) => c.axis === ax)) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const checkList = axChecks.map((c) => `<li><code>${esc(c.id)}</code> ${esc(c.title)} <span class="s">(${esc(c.severity_hint)}, ${esc(c.basis)})</span></li>`).join('');
    return `<details class="axis-matrix"><summary><strong>${esc(ax)} ${esc(AXES[ax])}</strong> <span class="s">対象 ${axTargets.length} × check ${axChecks.length} — ${Object.entries(counts).map(([k, v]) => `${sym[k] ?? k} ${v}`).join(' · ')}</span></summary>
<ul class="s">${checkList}</ul>
<div class="scroll"><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
</details>`;
  }).join('\n');
  return `<section id="matrix">
<h2>チェックマトリクス</h2>
<p>${legend}</p>
<p class="s">軸ごとに、その軸のレビュアーが扱った対象 × その軸の check。● finding、✓ pass（見て問題なし）、— n.a.、? 未チェック（レビュアーの見落とし候補）、✕ 検証で却下された finding のみ。</p>
${axisTables}
</section>`;
}

// ---------------------------------------------------------------- verification log

function verificationSection(v, findings, run) {
  if (!v) return `<section id="verification"><h2>検証ログ</h2><p class="empty">verification.json がありません。</p></section>`;
  const s1 = v.stage1 ? `<li>①: 発見 ${v.stage1.discovered} ／ 抽出 ${v.stage1.extracted}${v.stage1.missing?.length ? ` ／ <span class="badge err">欠落 ${v.stage1.missing.length}: ${esc(v.stage1.missing.join(', '))}</span>` : ' ／ 欠落なし'}</li>` : '';
  const s2 = v.stage2 ? `<li>②: 手がかり ${v.stage2.hints} ／ 帰属 ${v.stage2.attributed} ／ noise ${v.stage2.noise} ／ 未分類 ${v.stage2.unclassified?.length ?? 0}${v.stage2.entries_without_flow?.length ? ` ／ <span class="badge warn">フロー未抽出の入口: ${esc(v.stage2.entries_without_flow.join(', '))}</span>` : ''}</li>` : '';
  const s3 = v.stage3 ? `<li>③: 軸 ${esc((v.stage3.axes ?? []).join(''))} ／ 未チェックのセル ${v.stage3.unchecked_cells}${v.stage3.invalid_findings?.length ? ` ／ <span class="badge err">形式不備で除外した finding ${v.stage3.invalid_findings.length}</span>` : ''}${v.stage3.invalid_passes || v.stage3.invalid_na ? ` ／ 不正な check id の pass/na ${(v.stage3.invalid_passes ?? 0) + (v.stage3.invalid_na ?? 0)}` : ''}</li>` : '';
  const inv = v.stage3?.invalid_findings?.length ? `<details open><summary>形式不備で除外した finding（${v.stage3.invalid_findings.length}）</summary><ul>${v.stage3.invalid_findings.map((i) => `<li><span class="pill axis">${esc(i.axis)}</span> <code>${esc(i.check ?? '-')}</code> ${esc(i.target?.id ?? '')} — ${esc(String(i.claim ?? '').slice(0, 160))}<div class="s">${esc(i.reasons.join(' / '))}</div></li>`).join('')}</ul></details>` : '';
  const s4 = v.stage4 ? `<li>④: ${v.stage4.skipped ? '<span class="badge warn">スキップ</span>' : `finding ${v.stage4.total} ／ CONFIRMED ${v.stage4.confirmed} ／ PLAUSIBLE ${v.stage4.plausible} ／ REJECTED ${v.stage4.rejected?.length ?? 0}${v.stage4.unverified ? ` ／ <span class="badge warn">未検証 ${v.stage4.unverified}</span>` : ''}`}</li>` : '';
  const uncl = v.stage2?.unclassified?.length ? `<details><summary>未分類の spawn 手がかり（${v.stage2.unclassified.length}）</summary><ul>${v.stage2.unclassified.map((u) => `<li><code>${esc(u.path ?? u.file)}</code>:${u.line} — ${esc(u.text)}</li>`).join('')}</ul></details>` : '';
  const ej = v.extractor_judgments;
  const notes = [...(ej?.self_reported?.stage1 ?? []).map((n) => ({ stage: '①', ...n })), ...(ej?.self_reported?.stage2 ?? []).map((n) => ({ stage: '②', ...n }))];
  const missing = [...(ej?.missing?.stage1 ?? []).map((b) => `① ${b}`), ...(ej?.missing?.stage2 ?? []).map((b) => `② ${b}`)];
  const targetLink = (t) => { const id = String(t ?? ''); const anchor = id.startsWith('flow:') ? `flow-${slug(id.split('#')[0])}` : id.startsWith('memory:') ? `memory-${slug(id)}` : `file-${slug(id)}`; return `<a href="#${anchor}"><code>${esc(id)}</code></a>`; };
  const derived = ej?.derived ?? {};
  const dropped = derived.dropped_memory_hints ?? [], noise = derived.noise_hints ?? [], notFlowsD = derived.not_flows ?? [];
  const jn = `<h3>抽出者の裁量判断</h3>
<p class="s">①②の「事実」に混ざった抽出者（S1 / S2）自身の選択（ADR-0015）。<strong>自己申告は検証されていない</strong>。機械的に列挙できるものはスクリプトが出す。</p>
${!ej ? '<p><span class="badge warn">記録なし</span> この run には裁量判断の記録がありません（ADR-0015 以前の run。0 件の記録とは区別する）</p>' : ''}
${ej && (ej.self_reported?.stage1 === null || ej.self_reported?.stage2 === null) ? `<p><span class="badge warn">記録なし</span> ${[ej.self_reported?.stage1 === null ? '①（harness.json）' : null, ej.self_reported?.stage2 === null ? '②（flows.json）' : null].filter(Boolean).join('・')} は ADR-0015 以前の出力で、裁量判断の記録がありません（0 件の記録とは区別する）</p>` : ''}
${missing.length ? `<p><span class="badge warn">未記録の batch ${missing.length}</span> ${esc(missing.join(', '))} — この batch の抽出者は judgment_notes を書かなかった（0 件の記録とは区別する）</p>` : ''}
${ej ? `<details><summary>自己申告（${notes.length}）${missing.length ? '' : ' <span class="s">— 全 batch が記録済み</span>'}</summary>${notes.length ? `<ul>${notes.map((n) => `<li><span class="pill kind">${esc(n.stage)} ${esc(n.kind ?? 'other')}</span> ${targetLink(n.target ?? n.file)} — ${esc(n.note ?? '')}${n.alternative ? `<div class="s">別の解釈: ${esc(n.alternative)}</div>` : ''}<div class="s">batch ${esc(n.batch ?? '')}</div></li>`).join('')}</ul>` : '<p class="empty">0 件（抽出者は裁量判断なしと報告）</p>'}</details>
<details><summary>スクリプトが列挙した裁量（除外した memory 手がかり ≤${dropped.length} · noise 判定 ${noise.length} · フローでないと判定した入口 ${notFlowsD.length}）</summary>
${dropped.length ? `<div class="bl">discover の memory 手がかりのうち、同じ行の memory_ops にならなかったもの（上限値：隣の行に記録された場合も含まれる）</div><ul>${dropped.map((d) => `<li>${targetLink(d.file)}:${d.line} <span class="s">${esc(d.direction ?? '')}</span> — ${esc(d.text ?? '')}</li>`).join('')}</ul>` : ''}
${noise.length ? `<div class="bl">spawn 手がかりのうち noise と判定されたもの</div><ul>${noise.map((n) => `<li><code>${esc(n.path ?? n.file)}</code>:${n.line} — ${esc(n.text ?? '')}${n.reason ? `<div class="s">${esc(n.reason)}</div>` : ''}</li>`).join('')}</ul>` : ''}
${notFlowsD.length ? `<div class="bl">フローではないと判定した入口</div><ul>${notFlowsD.map((n) => `<li><code>${esc(n.entry)}</code> — ${esc(n.reason ?? '')}</li>`).join('')}</ul>` : ''}
</details>` : ''}`;
  const rej = v.stage4?.rejected?.length ? `<details open><summary>REJECTED された finding（${v.stage4.rejected.length}）</summary>${v.stage4.rejected.map((r) => `<article class="finding rejected"><header><span class="pill ${sevClass(r.finding.severity)}">${esc(r.finding.severity)}</span> <span class="pill axis">${esc(r.finding.axis)}</span> <span class="pill check">${esc(r.finding.check)}</span> <code class="fid">${esc(r.finding.id)}</code></header><div class="claim">${esc(r.finding.claim)}</div><div class="block verify"><div class="bl">却下理由</div>${esc(r.note ?? '')}<div class="s">evidence ${esc(r.evidence_check)} · claim ${esc(r.claim_check)} · proposal ${esc(r.proposal_check)}</div></div></article>`).join('')}</details>` : '';
  const stages = Object.entries(run.stages ?? {}).map(([k, s]) => `<span class="pill st-${esc(s.status)}">${esc(k)} ${esc(s.status)}${s.batches ? ` (${s.batches})` : ''}</span>`).join(' ');
  return `<section id="verification">
<h2>検証ログ</h2>
<p>${stages}</p>
<ul>${s1}${s2}${s3}${s4}</ul>
${uncl}
${jn}
${inv}
${rej}
</section>`;
}

// ---------------------------------------------------------------- css / js

function css() {
  return `
:root{--bg:#fafaf8;--fg:#1f2328;--muted:#656d76;--line:#d9dde3;--card:#fff;--must:#c62828;--should:#e08a00;--nice:#3b7dd8;--ok:#2e7d32;--warn:#b26a00;--err:#c62828;--acc:#5b4bd6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
nav.toc{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap}nav.toc a{color:var(--fg);text-decoration:none}nav.toc a:hover{color:var(--acc)}
main{max-width:1280px;margin:0 auto;padding:16px}
h1{font-size:24px;margin:8px 0}h1 small{font-weight:400;color:var(--muted);font-size:14px}h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}h3{font-size:16px;margin:24px 0 8px}h4{font-size:15px;margin:0 0 6px}
.meta{color:var(--muted);font-size:13px}code{font:12px/1.5 ui-monospace,Consolas,monospace;background:#f0f1f3;padding:1px 4px;border-radius:3px}pre{font:12px/1.5 ui-monospace,Consolas,monospace;background:#f6f7f9;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;white-space:pre-wrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}.card .k{color:var(--muted);font-size:12px}.card .v{font-size:26px;font-weight:600}.card .s{font-size:12px;color:var(--muted)}
.pill{display:inline-block;padding:0 8px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:#fff;white-space:nowrap}
.sev-must.pill,.pill.sev-must{border-color:var(--must);color:var(--must);font-weight:600}.sev-should.pill,.pill.sev-should{border-color:var(--should);color:var(--should);font-weight:600}.sev-nice.pill,.pill.sev-nice{border-color:var(--nice);color:var(--nice)}
.pill.axis{background:#eef0ff;border-color:#c9cdf5}.pill.check{background:#f0f1f3}.pill.basis-official{background:#e8f4ea;border-color:#b8dcc0}.pill.basis-custom{background:#fff4e0;border-color:#f0d6a0}
.pill.v-ok{background:#e8f4ea;color:var(--ok)}.pill.v-maybe{background:#fff4e0;color:var(--warn)}.pill.v-no{background:#fde8e8;color:var(--err)}.pill.v-none{color:var(--muted)}
.pill.continued{color:var(--muted)}.pill.new{color:var(--acc);border-color:var(--acc)}.pill.kind{background:#f0f1f3}
.badge{display:inline-block;font-size:11px;padding:0 6px;border-radius:4px;margin-left:4px}.badge.warn{background:#fff4e0;color:var(--warn)}.badge.err{background:#fde8e8;color:var(--err)}
.filters{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0 16px;font-size:13px}.filters>div{margin:2px 0}.fl{display:inline-block;width:72px;color:var(--muted)}.chip{margin-right:8px;cursor:pointer}.count{color:var(--muted);font-size:12px}
article.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}article.finding.sev-must{border-left-color:var(--must)}article.finding.sev-should{border-left-color:var(--should)}article.finding.sev-nice{border-left-color:var(--nice)}article.finding.rejected{opacity:.8;border-left-color:var(--muted)}article.finding.hidden{display:none}
article.finding header{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}.fid{color:var(--muted);background:none}
.target{font-size:13px;color:var(--muted)}.claim{font-weight:600;margin:6px 0}.block{margin:8px 0}.bl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}ul.evidence{margin:0;padding-left:18px}ul.evidence q{color:#333;font-style:normal}ul.evidence q::before,ul.evidence q::after{content:'"'}pre.change{margin:6px 0 0}.verify{background:#f6f7f9;border-radius:6px;padding:8px 10px}.s{font-size:12px;color:var(--muted)}.empty{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:#f0f1f3;font-weight:600}td.n,th.n{text-align:right;white-space:nowrap}.scroll{overflow-x:auto;margin:8px 0}table.small{width:auto}
.row{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:start}.row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.pill[class*="load-"]{background:#f0f1f3}.pill.load-always{background:#fde8e8;border-color:#f3b4b4}.pill.load-path-scoped{background:#fff4e0}.pill.load-spawned{background:#eef0ff}.pill.load-triggered{background:#e8f4ea}
details.fd{margin-top:4px;font-size:12px}details.fd summary{cursor:pointer;color:var(--acc)}details.fd .bl{display:inline;margin-right:4px}details.fd .h1{font-weight:700}details.fd .h2{font-weight:600}details.fd .h3,details.fd .h4{color:var(--muted)}ul.ops{margin:0;padding-left:16px}
details.flow{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:10px 0}details.flow>summary{cursor:pointer;padding:4px 0}details.flow[open]>summary{border-bottom:1px solid var(--line);margin-bottom:8px}pre.mermaid{background:#fff;border:1px dashed var(--line);text-align:center}
table.matrix th.tgt{text-align:left;white-space:nowrap}table.matrix td{text-align:center;padding:2px 4px;font-size:12px;min-width:26px}table.matrix .rot{display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px}
.m-finding{background:#fde8e8}.m-pass{background:#e8f4ea;color:var(--ok)}.m-na{color:#bbb}.m-unchecked{background:#fff4e0;color:var(--warn)}.m-rejected-only{background:#f0f1f3;color:var(--muted)}table.matrix td a{color:var(--must);text-decoration:none;font-weight:700}
.pill.st-done{background:#e8f4ea}.pill.st-running{background:#fff4e0}.pill.st-failed{background:#fde8e8}.pill.st-pending{color:var(--muted)}
details.resolved{margin-top:16px}
@media (max-width:720px){.row{grid-template-columns:1fr}nav.toc{gap:10px}}
`;
}

function mermaidScript() {
  return `
(function(){
  try { mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral', sequence: { useMaxWidth: true } }); } catch (e) { console.error(e); return; }
  function pending(root){ return [...root.querySelectorAll('pre.mermaid:not([data-processed])')].filter(p => { let d=p.closest('details'); while(d){ if(!d.open) return false; d=d.parentElement && d.parentElement.closest('details'); } return true; }); }
  function run(root){ const nodes=pending(root); if(nodes.length) mermaid.run({ nodes }).catch(e=>console.error(e)); }
  document.querySelectorAll('details.flow').forEach(d => d.addEventListener('toggle', () => { if (d.open) run(d); }));
  function openHash(){ const id=decodeURIComponent(location.hash.slice(1)); if(!id) return; const el=document.getElementById(id); if(!el) return; let d=el.tagName==='DETAILS'?el:el.closest('details'); while(d){ d.open=true; d=d.parentElement && d.parentElement.closest('details'); } el.scrollIntoView(); }
  window.addEventListener('hashchange', openHash);
  openHash();
  run(document);
})();`;
}

function filterScript() {
  return `
(function(){
  const boxes=[...document.querySelectorAll('input[data-filter]')];
  const cards=[...document.querySelectorAll('#findings article.finding')];
  const countEl=document.getElementById('findings-count');
  function apply(){
    const on={};
    for(const b of boxes){(on[b.dataset.filter]??=new Set());if(b.checked)on[b.dataset.filter].add(b.value);}
    let n=0;
    for(const c of cards){
      const show=Object.keys(on).every(k=>on[k].has(c.dataset[k]));
      c.classList.toggle('hidden',!show);if(show)n++;
    }
    if(countEl)countEl.textContent=n+' / '+cards.length+' 件';
  }
  boxes.forEach(b=>b.addEventListener('change',apply));apply();
})();`;
}

main();
