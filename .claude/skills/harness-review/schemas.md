# harness-review データ schema

各ステージの入出力 JSON の形。subagent はこの形でファイルに書き、スクリプトはこの形を前提にマージ・検証・描画する。
キーは英語、自由記述の値は日本語でよい。列挙値（kind / load / severity / verdict 等）は必ずここにある値を使う。

```
S0 discover   → work/discover.json            (script)
S1 extract ①  → work/extract/<batch>.json     (LLM)  → merge → harness.json
S2 extract ②  → work/flows/<batch>.json       (LLM)  → merge → flows.json
S3 review ③   → work/review/<axis>.json       (LLM)  → merge → work/review/all.json + validation.json
S4 verify ③   → work/verify/<batch>.json      (LLM)  → merge → findings.json / verification.json
S5 render     → report.html                   (script)
```

## 共通の参照 ID

| 形 | 例 | 意味 |
|---|---|---|
| `claude-md:<path>` | `claude-md:CLAUDE.md` | CLAUDE.md 系（discover の `files[].id`） |
| `rule:<name>` | `rule:git` | rule |
| `skill:<name>` | `skill:developer-workflow` | skill |
| `skill-support:<path>` | `skill-support:.claude/skills/x/templates/a.html` | skill 同梱ファイル |
| `command:<name>` | `command:deploy` | command（旧配置） |
| `agent:<name>` | `agent:security-verifier` | agent |
| `hook:<source>:<event>:<i>.<j>` | `hook:settings.json:PreToolUse:0.0` | hook エントリ（discover の `hooks[].id`） |
| `hook-script:<path>` | `hook-script:.claude/hooks/pre-commit.sh` | hook スクリプト |
| `mcp:<name>` | `mcp:discord` | MCP サーバ |
| `memory:<path>` | `memory:memory/dev/short_term.md` | memory（harness.json の `memory[].id`） |
| `flow:<slug>` | `flow:developer-workflow` | フロー（flows.json の `flows[].id`） |
| `flow:<slug>#<n>` | `flow:developer-workflow#3` | フローの step |

位置の指定は `{ "file": "<相対パス>", "line": <行番号> }`。行番号は discover / Read で見た実際の行。

## S0: work/discover.json（スクリプト生成、参照のみ）

`schema: "harness-review/discover@1"`。主なもの:

- `target`: `{ path, name, scanned_at, layouts: ["project"|"plugin"|"marketplace"], top_level: [], nested_claude_dirs: [] }`
- `summary`: 件数、`by_load`、`always_loaded_tokens_est`、hints 数、`frontmatter_errors`
- `files[]`: `{ id, kind, path, load, size:{bytes,lines,tokens_est}, sha256, frontmatter, frontmatter_error, frontmatter_stats, headings:[{level,text,line}], imports:[], hints:{spawn:[{line,kinds,in_code,text}], memory:[{line,direction,targets,memory_word,text}]}, instruction_lines, first_body_line, refs:{skills,agents,commands,harness_files}, preloaded_by?, preloads_skills?, context_at_spawn_tokens_est?, referenced?(hook-script), paths?(rule), exec?(skill) }`
  - `kind`: `claude-md | rule | skill | skill-support | command | agent | settings | mcp-config | hooks-config | hook-script | workflow | plugin-manifest | marketplace-manifest | import`
  - `load`: `always | path-scoped | on-demand | invoked | spawned | triggered | support | meta`
- `hooks[]`: `{ id, source, event, matcher, type, command, prompt, url, timeout, if, once, async, script:{path,exists,outside_target,sha256,lines} }`
- `permissions[]`, `settings[]`, `mcp_servers[]`
- `memory_candidates[]`: `{ path, kind_hint, is_dir, file_count, detection: "structural"|"referential", mentioned_by:[{file,line,direction}] }`
- `unknown_claude_files[]`, `notes[]`

## S1: work/extract/<batch>.json（harness-extractor が書く）

batch は種別ごと最大 10 ファイル（`claude-md-1`, `rules-1`, `skills-1`, `skills-2`, `agents-1`, …）。加えて memory 評価用の `memory-1` を 1 つ。

```json
{
  "schema": "harness-review/extract@1",
  "batch": "skills-1",
  "files": [
    {
      "id": "skill:developer-workflow",
      "summary": "DEV ロールの行動フロー。Planning → TDD 実装 → 完了報告 → レビュー対応の手順。",
      "purpose": "procedure",
      "content_mix": { "project_context": 0.0, "conventions": 0.2, "procedure": 0.7, "prohibitions": 0.1, "reference": 0.0, "template": 0.0 },
      "opening": {
        "states_role": true, "states_when": true, "states_output": false,
        "note": "冒頭 3 行で DEV としての行動フローと参照タイミングは分かるが、成果物の形は本文後半まで出てこない"
      },
      "audience": ["agent:developer"],
      "memory_ops": [
        { "line": 52, "direction": "write", "target": "memory/dev/short_term.md", "trigger": "実装方針を決めた直後（ユーザー提示前）", "what": "実装方針" }
      ],
      "facts": [
        "frontmatter の skills で agent:developer に注入される（discover.preloaded_by）",
        "行 131-133 で backlog/sprint_XX/implementation-notes.md に仕様外の判断を記録するよう指示している"
      ]
    }
  ],
  "memory_assessment": [
    {
      "path": "memory/dev/short_term.md",
      "is_memory": true,
      "kind": "memory",
      "description": "DEV ロールのスプリント内の作業状態。実装方針・レビュー指摘を保持する",
      "lifecycle": "per-sprint",
      "sample_read": true
    }
  ]
}
```

- `purpose`: `project_context | conventions | procedure | prohibitions | reference | template | role-definition | config | mixed`
- `content_mix`: 合計 1.0 の概算
- `opening`: 冒頭（frontmatter の description ＋ 本文の最初の数行）だけを読んで判断する
- `memory_ops[].direction`: `write | read | both`。`trigger` は「いつ」、`what` は「何を」
- `facts`: 事実だけ。判断（良い / 悪い）は書かない
- `judgment_notes`（batch 直下、必須。無ければ `[]`。キーが無い batch は merge が「未記録」として `judgment_notes_missing` に記録する）: 抽出者自身の裁量判断の記録（ADR-0015）。`{ "target": "<id>", "kind": "content_mix | purpose | opening | memory_hint_dropped | memory_kind | audience | other", "note": "何を・なぜ", "alternative": "採らなかった解釈（任意）" }`。`target` は file id（`skill:x`）または memory id（`memory:docs/adr`。memory batch の `memory_kind` 判断用）。対象の評価ではなく、出力を作るときに置いた前提と選択。検証されない自己申告
- `memory_assessment` は `memory-1` batch だけが書く。`kind`: `memory | decision-record | backlog | reports | spec | log | template | artifact | not-memory`、`lifecycle`: `session | per-task | per-sprint | long-term | unknown`

## harness.json（merge スクリプトが生成）

`schema: "harness-review/harness@1"`。discover の内容に S1 の `summary / purpose / content_mix / opening / audience / memory_ops / facts` を各 file に合成し、memory を組み立てる。トップレベルに `judgment_notes[]`（batch 横断、各要素に `batch` を付与）、`judgment_notes_missing[]`（キーを書かなかった batch 名）、`derived_judgments.dropped_memory_hints[]`（discover の memory 手がかりのうち、同じ行の `memory_ops` にならなかったもの＝抽出者が除外した手がかりをスクリプトが列挙）を持つ。

```json
{
  "schema": "harness-review/harness@1",
  "target": { "...": "discover.target と同じ" },
  "summary": {
    "counts": {}, "by_load": {}, "always_loaded_tokens_est": 0,
    "memory": { "has_custom_memory": true, "count": 6, "write_only": ["memory:..."], "read_only": [], "adr_like": [] }
  },
  "files": [ { "...": "discover.files[] ＋ S1 の各項目" } ],
  "hooks": [], "permissions": [], "mcp_servers": [],
  "memory": [
    {
      "id": "memory:memory/dev/short_term.md",
      "path": "memory/dev/short_term.md",
      "kind": "memory", "lifecycle": "per-sprint", "exists": true, "is_dir": false,
      "description": "...",
      "writers": [ { "file": "skill:developer-workflow", "line": 52, "trigger": "...", "what": "..." } ],
      "readers": [ { "file": "skill:developer-workflow", "line": 98, "trigger": "...", "what": "..." } ]
    }
  ],
  "coverage": { "discovered": 28, "extracted": 28, "missing": [] }
}
```

## S2: work/flows/<batch>.json（flow-extractor が書く）

batch は入口 5 件ずつ（`entries-1`, `entries-2`, …）、hooks 全部で `hooks-1`、CLAUDE.md ＋ 常駐 rules で `implicit-1`。

```json
{
  "schema": "harness-review/flows@1",
  "batch": "entries-1",
  "flows": [
    {
      "id": "flow:developer-workflow",
      "name": "Developer workflow",
      "kind": "orchestrated",
      "confidence": null,
      "defined_in": [ { "file": ".claude/skills/developer-workflow/SKILL.md", "lines": "1-402" } ],
      "entry": { "type": "model-invoked", "detail": "agent:developer に skills: で注入。DEV として動くとき" },
      "orchestrator": { "context": "agent:developer", "note": "SM から SendMessage で指示を受けて動く" },
      "steps": [
        {
          "n": 1, "actor": "agent:developer", "action": "memory/dev/short_term.md を読み実装方針を確認",
          "inputs": ["memory:memory/dev/short_term.md"], "outputs": [],
          "spawn": null,
          "evidence": { "file": ".claude/skills/developer-workflow/SKILL.md", "line": 98 }
        },
        {
          "n": 5, "actor": "agent:scrum-master", "action": "convention-reviewer を起動してレビュー",
          "inputs": [], "outputs": ["backlog/sprint_XX/review-#N.html"],
          "spawn": { "target": "agent:convention-reviewer", "timing": "sequential", "condition": null, "max_iterations": null, "model": "sonnet", "tools": null, "isolation": null },
          "evidence": { "file": ".claude/skills/scrum-master-workflow/SKILL.md", "line": 210 }
        }
      ],
      "participants": [ { "ref": "agent:developer", "role": "実装", "defined": true } ],
      "artifacts": [ { "type": "memory-write", "target": "memory:memory/dev/short_term.md", "step": 3 } ],
      "review_points": [
        {
          "step": 5, "reviewer": "agent:convention-reviewer", "reviewee": "agent:developer",
          "subject": "実装差分の規約適合", "criteria": "backend-conventions / frontend-conventions",
          "separate_context": true, "on_fail": "DEV に差し戻し（回数上限の記述なし）", "max_iterations": null,
          "evidence": { "file": "...", "line": 210 }
        }
      ],
      "judgment_points": [
        {
          "step": 2, "description": "AC や仕様書にない判断・変更・妥協点",
          "logging_instructed": true, "log_target": "backlog/sprint_XX/implementation-notes.md",
          "evidence": { "file": ".claude/skills/developer-workflow/SKILL.md", "line": 133 }
        }
      ],
      "calls": [ { "flow": "flow:sprint-review-prep", "step": 7 } ],
      "termination": "SM に SendMessage で完了報告",
      "mermaid": "sequenceDiagram\n  participant SM as agent:scrum-master\n  participant DEV as agent:developer\n  ..."
    }
  ],
  "not_flows": [ { "entry": "skill:backend-conventions", "reason": "規約の参照資料。手順を含まない" } ],
  "hint_attribution": [
    { "file": "skill:developer-workflow", "line": 52, "status": "attributed", "flow": "flow:developer-workflow", "step": 3 },
    { "file": "skill:backend-conventions", "line": 759, "status": "noise", "reason": "Java 設計の散文" }
  ]
}
```

- `kind`: `single | orchestrated | workflow | team | hook-chain | implicit`
- `confidence`（implicit のみ）: `explicit-procedure | procedure-like`
- `entry.type`: `user-invoked | model-invoked | hook | called-by-flow | prose`
- `orchestrator.context`: `main-session | forked-skill | workflow-runtime | agent:<name> | hook`
- `steps[].actor`: `main | agent:<name> | teammate:<name> | script:<path> | hook:<id> | human`
- `spawn.target`: `agent:<name> | teammate:<name> | workflow:<name> | claude-cli | unknown`
- `spawn.timing`: `sequential | parallel | background | conditional | loop`
- `artifacts[].type`: `file | memory-write | commit | pr | external-message | report | none`
- `review_points[].separate_context`: `true | false | "unknown"`。`criteria` / `on_fail` に記述がなければ `"none stated"`
- `hint_attribution[].status`: `attributed | noise | unclassified`
- `judgment_notes`（batch 直下、必須。無ければ `[]`）: 抽出者自身の裁量判断の記録（ADR-0015）。`kind`: `implicit_confidence | noise | not_flow | step_boundary | review_point | judgment_point | other`。`target` は入口 id（`skill:x`）、フロー id（`flow:x`）、step（`flow:x#3`）のいずれか。形は S1 と同じ
- `mermaid`: `sequenceDiagram` のソース。参加者は actor、spawn は `->>`、返却は `-->>`、並列は `par`、ループは `loop`

## flows.json（merge スクリプトが生成）

`schema: "harness-review/flows@1"`。batch を結合し、`calls[].flow` を解決（見つからなければ `unresolved:<name>`）、フロー間グラフ `graph: [{from, to, step}]` を作り、hint の帰属を集計する。トップレベルに `judgment_notes[]`（batch 横断、各要素に `batch` を付与）と `judgment_notes_missing[]` を持つ。noise 判定と not_flows はそれぞれ `hint_attribution.items[]` と `not_flows[]` にあり、スクリプトが列挙した裁量として扱う。

```json
{
  "summary": { "total": 9, "by_kind": {}, "with_review_points": 4, "with_judgment_points": 2, "entries_without_flow": [] },
  "flows": [], "not_flows": [], "graph": [],
  "hint_attribution": { "attributed": 60, "noise": 8, "unclassified": 3, "items": [] }
}
```

## S3: work/review/<axis>.json（harness-reviewer が書く）

axis は `A | B | C | D | E`。各軸の check ID（`A1`, `A2`, …）は `references/<axis>-*.md` で定義する。

```json
{
  "schema": "harness-review/review@1",
  "axis": "A",
  "reference": "references/A-placement.md",
  "findings": [
    {
      "axis": "A",
      "check": "A6",
      "severity": "must",
      "basis": "official",
      "target": { "type": "hook", "id": "hook:settings.json:PreToolUse:0.0", "line": null },
      "evidence": [
        { "file": ".claude/settings.json", "line": 7, "quote": "\"command\": \"bash C:/work/claude/scrum-agent-base/.claude/hooks/pre-commit.sh\"" },
        { "file": ".claude/hooks/pre-commit.sh", "line": 1, "quote": "（どこからも参照されていない。53 行 vs 48 行、hash 不一致）" }
      ],
      "claim": "PreToolUse hook が別プロジェクトのスクリプトを実行しており、ローカルの pre-commit.sh は孤立している",
      "proposal": {
        "summary": "command を $CLAUDE_PROJECT_DIR/.claude/hooks/pre-commit.sh に変え、内容を統一する",
        "change": "settings.json:\n  \"command\": \"bash \\\"$CLAUDE_PROJECT_DIR/.claude/hooks/pre-commit.sh\\\"\""
      }
    }
  ],
  "passes": [ { "target": { "type": "file", "id": "rule:database" }, "check": "A3", "note": "paths が指定され、内容もその範囲に限定されている" } ],
  "na": [ { "target": { "type": "file", "id": "skill-support:..." }, "check": "A1", "reason": "HTML テンプレートには適用しない" } ]
}
```

- `severity`: `must | should | nice to have`
- `basis`: `official | custom`
- `target.type`: `file | flow | step | hook | memory | mcp | harness`（`harness` は対象全体への指摘。例: ADR がない）
- `evidence[]` は実ファイルを Read して引用する。要約からの推測で書かない。`quote` は 200 文字以内
- `proposal.change` は書き換え後のテキスト、追加する step、移動先。「検討する」で終わらせない
- `id` は書かない（merge が `hash(axis + target.id + claim 正規化)` で付ける）
- 対象 × check のすべてのセルを `findings / passes / na` のいずれかで埋める

## work/review/validation.json（merge S3 が生成）

merge S3 は S3 出力を機械的に検査し、形式不備の finding を `all.json` から除外してここに記録する。検査項目：check id が `references/` の一覧に実在し、そのファイルの軸に属すること／severity と basis が列挙値であること／`target.id`（`harness` 型を除く）・`evidence[]`（各要素に `file` と `quote`）・`claim`・`proposal.summary` があること。pass / na は check id だけを検査する。

```json
{
  "schema": "harness-review/review-validation@1",
  "merges": 1,
  "invalid_findings": [ { "axis": "A", "check": "A99", "target": { "type": "file", "id": "x" }, "claim": "...", "reasons": [ "unknown check id: A99" ] } ],
  "invalid_passes": 0,
  "invalid_na": 0,
  "warnings": [ "axis A: valid findings decreased from 6 to 4 after retry (see .../A.attempt1.json)" ]
}
```

- `merges`: merge S3 を実行した回数。不備があっても 2 回目以降は S3 を完了扱いにする（再試行は 1 回）
- 不備のあった軸の `<axis>.json` は、初回 merge 時に `<axis>.attempt1.json`（`valid_findings` を付与）としてスナップショットされる。再試行後に有効な finding が減っていれば `warnings` に出る
- ファイルの軸が正。finding / pass / na に書かれた `axis` は無視される

`verification.json` の `stage3` にはこの内容（`invalid_findings` / `invalid_passes` / `invalid_na` / `warnings`）と `unchecked_cells` が入る。`run.json` の `S3` には `merges` と `invalid_findings`（件数）が入る。

## work/review/gaps.json と穴埋め batch（merge S3 / plan S3 --gaps が生成、ADR-0016）

各 check には `references/` の「対象」列で対象種別（`file`、`file:<kind>`、`hook`、`memory`、`mcp`、`flow`、`harness`、` / ` 区切り）が定義されている。母集団＝その種別の対象すべて（`harness.json` / `flows.json` から列挙）。merge S3 は母集団 × check のうち finding / pass / na の無いセルを `gaps.json` に書く。欠落した軸（出力ファイルが無い、または JSON が壊れている）は 1 回再試行し、それでも欠ければ全セルが未チェックとして穴埋めに回る。

```json
{ "schema": "harness-review/review-gaps@1", "merges": 1, "total": 42, "by_axis": { "A": 30, "D": 12 },
  "cells": [ { "axis": "A", "check": "A3", "title": "rule の paths の有無が…", "target": { "type": "file", "id": "rule:git" } } ] }
```

`plan S3`（1 パス目）は軸ごとに `work/review/<axis>.input.json`（`kind: "review"`、`axis`、`reference`、`checks[]`、`cells[]` ＝ check × 母集団。`target` は `{ type, id }`）を書き、reviewer は cells をすべて埋める。未チェックがあり穴埋めがまだなら merge S3 は `gaps.retry: true` で exit 3 になる（1 run に 1 回）。`plan S3 --gaps` は未チェックのある軸ごとに 40 セルずつ `work/review/gaps-<axis>-<n>.input.json`（`kind: "gaps"`、`axis`、`reference`、`existing_output`（軸の出力が無ければ `null`）、`cells[]`）を書く。harness-reviewer は穴埋めモードで **`<axis>.gaps-<n>.json`**（`review@1` と同じ形、未チェック分だけ、`target` はセルのオブジェクトをそのまま）を書き、merge S3 が `<axis>.json` と連結する（同じ対象 × check は既存が優先、連結分には `source: "gap-fill"`）。merge は文字列の `target` を `{ type, id }` に正規化し、`pass` に `note`、`na` に `reason` が無いものを除外し、`対象` 列の未知トークンを `warnings` に出す。既存出力と穴埋め出力の重複排除は**検査後**に行う（不備で除外されたセルは穴埋めで埋められる）。S4 後、REJECTED しか無いセル（`rejected-only`）は未チェックとして数える。穴埋め後の merge は不備の再試行予算（`merges`）を消費しない。`run.json` の `S3.gap_fill` は `null → planned → done`。step を対象にした finding（`flow:x#3`）はマトリクスではフロー `flow:x` のセルに帰属する。母集団外の対象に書かれた finding / pass / na はセルを作り `in_universe: false` で印を付ける（消さない）。

## S4: work/verify/<batch>.json（finding-verifier が書く）

batch は対象ファイルごとにまとめて 8 件程度（`verify-1`, `verify-2`, …）。

```json
{
  "schema": "harness-review/verify@1",
  "batch": "verify-1",
  "results": [
    {
      "finding_id": "A6-3f9c2e",
      "verdict": "CONFIRMED",
      "evidence_check": "ok",
      "claim_check": "holds",
      "proposal_check": "consistent",
      "note": "settings.json 7 行目で確認。ローカルの pre-commit.sh は他に参照なし"
    }
  ]
}
```

- `verdict`: `CONFIRMED`（evidence 実在・claim 成立・proposal 整合）/ `PLAUSIBLE`（claim は成立しそうだが決め手を欠く、または proposal に懸念）/ `REJECTED`（evidence が実在しない、引用が違う、claim が成立しない）
- `evidence_check`: `ok | mismatch | missing`
- `claim_check`: `holds | doubtful | fails`
- `proposal_check`: `consistent | concern | conflicts`

## findings.json（merge スクリプトが生成）

```json
{
  "schema": "harness-review/findings@1",
  "summary": {
    "by_severity": { "must": 3, "should": 7, "nice to have": 4 },
    "by_axis": { "A": 5, "B": 4, "C": 3, "D": 1, "E": 1 },
    "by_verdict": { "CONFIRMED": 11, "PLAUSIBLE": 3 },
    "vs_previous": { "previous_run": "2026-09-24-1530", "resolved": 2, "new": 4, "continued": 10 }
  },
  "findings": [ { "id": "A6-3f9c2e", "...": "S3 の finding ＋ verification: { verdict, note } ＋ status: new|continued" } ],
  "matrix": {
    "checks": [ { "id": "A1", "axis": "A", "title": "..." } ],
    "targets": [ { "id": "skill:developer-workflow", "type": "file" } ],
    "cells": [ { "target": "skill:developer-workflow", "check": "A1", "axis": "A", "status": "pass", "finding_ids": [], "in_universe": true } ]
  }
}
```

`findings[].id` の形は `<check>-<hash6>`。`status` は前回 run との突き合わせ結果（前回がなければ `new`）。REJECTED はここに入れない。

## verification.json（merge スクリプトが生成）

```json
{
  "schema": "harness-review/verification@1",
  "stage1": { "discovered": 28, "extracted": 28, "missing": [] },
  "stage2": { "hints": 71, "attributed": 60, "noise": 8, "unclassified": [ { "file": "...", "line": 0, "text": "..." } ], "entries_without_flow": [] },
  "extractor_judgments": {
    "note": "self_reported は未検証の自己申告。derived はスクリプトが列挙",
    "self_reported": { "stage1": [ { "batch": "skills-1", "target": "skill:x", "kind": "memory_hint_dropped", "note": "..." } ], "stage2": [] },
    "missing": { "stage1": [], "stage2": [ "hooks-1" ] },
    "derived": { "dropped_memory_hints": [ { "file": "skill:x", "line": 190, "direction": "read", "text": "..." } ], "noise_hints": [], "not_flows": [] }
  },
  "stage4": { "total": 16, "confirmed": 11, "plausible": 3, "rejected": [ { "finding": {}, "note": "..." } ] }
}
```

## run.json（オーケストレータ / スクリプトが更新）

```json
{
  "schema": "harness-review/run@1",
  "target": { "path": "...", "name": "..." },
  "run_id": "2026-09-25-1030",
  "started_at": "...", "finished_at": null,
  "options": { "from": null, "skip_verify": false },
  "stages": {
    "S0": { "status": "done", "started_at": "...", "finished_at": "..." },
    "S1": { "status": "done", "batches": 5, "agents": 5, "model": "sonnet" },
    "S2": { "status": "running", "batches": 4 },
    "S3": {}, "S4": {}, "S5": {}
  },
  "previous_run": "2026-09-24-1530"
}
```

`status`: `pending | running | done | failed | skipped`。
