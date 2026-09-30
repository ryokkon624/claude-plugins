# ADR-0005: 検証は 2 層とし、①②は網羅性検証、③は別コンテキストによる敵対的検証を行う

- Status: Accepted
- Date: 2026-09-24

## Context

- ①②は「漏れなく抽出する」というゴールが明確な作業なので、網羅性で検証できる。多くは決定的なチェック（スクリプト）で済む。
- ③のレビュー結果には正解がない。正解がない成果物を通常のレビューにかけると、レビュアーは同意するだけになりやすい（ユーザーの経験則）。品質を上げるには、別コンテキストが反証を試みる敵対的検証が要る。
- 敵対的検証がないと、存在しないファイルへの指摘や根拠のない主張が HTML に混ざる。

## Decision

| 対象 | 検証方法 | 担当 |
|---|---|---|
| ① | スクリプトが発見したファイル一覧と `harness.json` の files を diff。欠けがあれば該当分だけ再抽出 | スクリプト |
| ② | spawn の手がかり（`Agent(`、`subagent_type`、`agent(`、`SendMessage`、`teammate`、`run_in_background`、`context: fork`、`/xxx` 呼び出し、hook の command 等）を grep した一覧の各項目が、いずれかのフローの step に帰属しているか。入口候補（skill / command / workflow / hook）がすべてフローになっているか、または「フローではない」と明示分類されているか。未帰属は 1 回だけ追加パスを回し attributed / noise（散文で触れているだけ）/ unclassified に分類 | スクリプト ＋ LLM 1 パス |
| ③ | reviewer とは別コンテキストの finding-verifier が、finding ごとに evidence の実在、claim の妥当性、proposal の他ファイルとの整合を反証しにいき、CONFIRMED / PLAUSIBLE / REJECTED を付ける | LLM |

- REJECTED は `findings.json` から外し、理由とともに `verification.json` に残す。
- v1 では pass（問題なし判定）は検証対象にしない。レビュアーの見落としを拾うには pass の反証も要るが、コストがほぼ倍になるため、必要になってから足す。
- finding-verifier を reviewer と別のモデル系にする選択肢を残す（同じ盲点を共有しないため）。

## Consequences

- (+) ハルシネーション由来の指摘を出力から排除できる。
- (+) ①②の検証は安価で確実。
- (−) agent 数とコストが増える。
- (−) pass の見落としは v1 では拾えない。
