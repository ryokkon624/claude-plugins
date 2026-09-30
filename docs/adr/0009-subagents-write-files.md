# ADR-0009: subagent は結果をファイルに書き、オーケストレータにデータを返さない

- Status: Accepted
- Date: 2026-09-24

## Context

- ①〜③ はそれぞれ複数の subagent に分担させる。subagent の出力をオーケストレータ（メインセッション）が受け取って持ち回ると、大きなハーネスではオーケストレータのコンテキストが溢れる。
- 途中のステージだけ再実行したい場面がある（③の基準文書を直して再レビューする等）。

## Decision

- すべての subagent は `<run>/work/<stage>/<batch>.json` に結果を書き、オーケストレータへの返答は「書いたファイル / 件数 / 失敗の有無」の 1 行に限る。
- マージと網羅性検証はスクリプトが `work/` 配下のファイル同士で行い、`harness.json` / `flows.json` / `findings.json` / `verification.json` を生成する。オーケストレータはデータを保持しない。
- `work/` は消さずに残し、`--from <stage>` で途中のステージから再実行できるようにする。

パイプライン:

```
S0 discover   script          → work/discover.json
S1 extract ①  LLM × N         → work/extract/*.json  → merge → harness.json（＋網羅性検証①）
S2 extract ②  LLM × N         → work/flows/*.json    → merge → flows.json（＋網羅性検証②）
S3 review ③   LLM × 5（軸ごと）→ work/review/{A..E}.json
S4 verify ③   LLM × N         → work/verify/*.json   → merge → findings.json / verification.json
S5 render     script          → report.html / latest.html
```

- オーケストレータは skill `harness-review` とし、メインセッションで動かす。公式ドキュメント（2026-09-25 確認）では subagent は既定で深さ 3 まで subagent を spawn できるので `context: fork` でも成立するが、fork した skill は会話履歴を持たず、進捗の表示や途中の質問がしにくいため、メインセッションを選ぶ。`disable-model-invocation: true` で人だけが起動できるようにする。
- subagent の tools は Read / Glob / Grep / Write に限る。subagent に読み込まれる CLAUDE.md は Claude を起動したこのリポジトリのもの（レビュー対象のものではない）なので、レビュー対象がレビュアーの指示になる事故は起きない。`omitClaudeMd` は v2.1.271 以降で使えるが、現時点（2.1.268）では不要でもある。

## Consequences

- (+) ハーネスの規模に関わらずオーケストレータが安定する。
- (+) `work/` が残るのでデバッグと部分再実行ができる。
- (−) subagent に Write 権限が必要。
