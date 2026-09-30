# Architecture Decision Records

harness-review の設計判断を 1 決定 1 ファイルで記録する。形式は Status / Date / Context / Decision / Consequences。

決定を変えるときは既存の ADR を書き換えず、新しい ADR を追加して旧 ADR の Status を `Superseded by ADR-XXXX` にする。

| # | 決定 |
|---|---|
| [0001](0001-single-self-contained-html-from-json.md) | レビュー結果は単一の自己完結 HTML で出力し、中間 JSON からスクリプトで生成する |
| [0002](0002-timestamped-output-history.md) | 出力は実行ごとのタイムスタンプディレクトリに履歴として残し、latest.html を併置する |
| [0003](0003-harness-scope.md) | ハーネスの範囲はプロジェクトレベル全部（hooks / settings / MCP を含む）とし、ユーザーレベルは対象外とする |
| [0004](0004-facts-vs-judgment-finding-triplet.md) | ①②は事実、③は判断として分離し、finding は 根拠 → 指摘 → 改善案 の 3 点セットとする |
| [0005](0005-two-layer-verification.md) | 検証は 2 層とし、①②は網羅性検証、③は別コンテキストによる敵対的検証を行う |
| [0006](0006-severity-and-pass.md) | severity は must / should / nice to have の 3 段階とし、pass は findings とは別セクションに出す |
| [0007](0007-two-tier-reference-model.md) | 判断基準は references/ に「公式」と「独自」の 2 層で持ち、finding に basis を付ける |
| [0008](0008-flow-definition.md) | フローは「入口があるものすべて」と定義し、散文の手順（implicit）も含めて kind で分類する |
| [0009](0009-subagents-write-files.md) | subagent は結果をファイルに書き、オーケストレータにデータを返さない |
| [0010](0010-no-content-snapshot.md) | ファイル本文はスナップショットせず、hash ＋ 行数 ＋ 見出し構造のみ保持する |
| [0011](0011-plain-claude-project-layout.md) | プレーンな `.claude/` プロジェクトとして構成し、プラグイン / marketplace 化しない |
| [0012](0012-node-no-deps.md) | スクリプトは Node（npm 依存なし）で書く |
