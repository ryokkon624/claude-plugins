# ADR-0006: severity は must / should / nice to have の 3 段階とし、pass は findings とは別セクションに出す

- Status: Accepted
- Date: 2026-09-24

## Context

- 指摘の優先度がないと、読み手がどこから直すべきか分からない。
- findings だけでは「見ていないのか、見て問題なかったのか」が区別できない。
- 読み手の順序は「まず findings と改善案 → 次に、何を見ていたのか」である。

## Decision

severity:

| severity | 意味 | 例 |
|---|---|---|
| must | 誤動作・損失を招く。直さないと危ない | ファイル間の矛盾、散文でしか書かれていない禁止事項、write-only な memory |
| should | 品質・信頼性が落ちる。直すべき | 正解なし作業にレビューがない、常駐トークンの肥大 |
| nice to have | 衛生・読みやすさ。余裕があれば | description が「何であるか」止まり、旧配置 |

pass:

- 対象 × 軸のマトリクスで、各セルを finding / pass / n.a. のいずれかにする。pass と n.a. も明示的に出力する。
- HTML では findings セクションの後に「チェックマトリクス」として別セクションで表示する。

## Consequences

- (+) 「見ていない」と「見て OK」が区別でき、③の網羅性がそのまま可視化される。
- (+) 読み手が結論から読める。
- (−) reviewer は finding がない対象にも pass を書く必要があり、出力量が増える。
