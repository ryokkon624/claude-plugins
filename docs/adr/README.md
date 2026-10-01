# Architecture Decision Records

harness-review の設計判断を 1 決定 1 ファイルで記録する。形式は Status / Date / Context / Decision / Consequences（＋ 検証）。

新しい設計判断をしたら、実装より先に ADR を追加する。決定を変えるときは既存の ADR を書き換えず、新しい ADR を追加して旧 ADR の Status を `Superseded by ADR-XXXX` にする。

新しい ADR は `Status: Proposed` で書き、`adr-verifier` agent（`.claude/agents/adr-verifier.md`）に ADR のパスだけを渡して反証させ、返ってきた結果を末尾の `## 検証` 節にラウンドごとに貼って対応を書いてから `Accepted` にする。Decision を変える対応をしたら再検証する（最大 2 往復。決着しなければユーザーに判断を仰ぐ）。既存 ADR の適用範囲を狭める ADR は、既存側の Status 行に注記する。ADR-0001〜0012 は制定時にこの手順がなかったため検証節を持たない（ADR-0013）。

| # | Status | 決定 |
|---|---|---|
| [0001](0001-single-self-contained-html-from-json.md) | Accepted | レビュー結果は単一の自己完結 HTML で出力し、中間 JSON からスクリプトで生成する |
| [0002](0002-timestamped-output-history.md) | Accepted | 出力は実行ごとのタイムスタンプディレクトリに履歴として残し、latest.html を併置する |
| [0003](0003-harness-scope.md) | Accepted | ハーネスの範囲はプロジェクトレベル全部（hooks / settings / MCP を含む）とし、ユーザーレベルは対象外とする |
| [0004](0004-facts-vs-judgment-finding-triplet.md) | Accepted | ①②は事実、③は判断として分離し、finding は 根拠 → 指摘 → 改善案 の 3 点セットとする |
| [0005](0005-two-layer-verification.md) | Accepted | 検証は 2 層とし、①②は網羅性検証、③は別コンテキストによる敵対的検証を行う |
| [0006](0006-severity-and-pass.md) | Accepted（母集団は 0016 で明確化） | severity は must / should / nice to have の 3 段階とし、pass は findings とは別セクションに出す |
| [0007](0007-two-tier-reference-model.md) | Accepted | 判断基準は references/ に「公式」と「独自」の 2 層で持ち、finding に basis を付ける |
| [0008](0008-flow-definition.md) | Accepted | フローは「入口があるものすべて」と定義し、散文の手順（implicit）も含めて kind で分類する |
| [0009](0009-subagents-write-files.md) | Accepted（範囲は 0013 で明確化） | subagent は結果をファイルに書き、オーケストレータにデータを返さない |
| [0010](0010-no-content-snapshot.md) | Accepted | ファイル本文はスナップショットせず、hash ＋ 行数 ＋ 見出し構造のみ保持する |
| [0011](0011-plain-claude-project-layout.md) | Accepted | プレーンな `.claude/` プロジェクトとして構成し、プラグイン / marketplace 化しない |
| [0012](0012-node-no-deps.md) | Accepted | スクリプトは Node（npm 依存なし）で書く |
| [0013](0013-verify-adrs-adversarially.md) | Accepted | 新しい ADR は別コンテキストで反証してから Accepted にする |
| [0014](0014-write-guard-hooks.md) | Accepted | プロジェクト外への書き込みと main への直接 push を PreToolUse hook で機械的に止める |
| [0015](0015-extractor-judgment-notes.md) | Accepted | 抽出者（S1 / S2）の裁量判断を judgment_notes として記録し、検証ログと最終報告に載せる |
| [0016](0016-review-matrix-universe-and-gap-fill.md) | Accepted | ③の check ごとに対象種別を定義して母集団を固定し、未チェックのセルは第 2 パスで埋める |
