# ADR-0004: ①②は事実、③は判断として分離し、finding は 根拠 → 指摘 → 改善案 の 3 点セットとする

- Status: Accepted
- Date: 2026-09-24

## Context

- レビューが「なんとなくダメ」にならないよう、指摘は必ず具体的な根拠（どのファイルの何行目、どのフローのどの step）を引用できる必要がある。
- 読み手は finding を見たらすぐ改善案が欲しい。改善案を独立セクションにすると往復が発生する。

## Decision

- ①ハーネス抽出と②フロー抽出は事実のみを出す。「レビューに相当する step があるか」「AI が裁量で判断する箇所があるか」も、②では「ある / ない / あるならこう」の事実として抽出し、それが十分かの判断は③に委ねる。
- ③のみが判断を行う。改善案は④として独立させず、finding に含める。
- finding の schema:

```
id            hash(axis + target + 正規化した claim)。run を跨いで安定
axis          A 適材適所 / B フォーマット / C レビュー行為 / D ADR / E 自己判断の記録
severity      must / should / nice to have（ADR-0006）
basis         official / custom（ADR-0007）
target        file:line または flow:step
evidence      ①②からの引用。実ファイルを Read して引用する（要約からの推測は不可）
claim         指摘
proposal      具体的な書き換え案、追加する step、移動先
verification  { verdict: CONFIRMED | PLAUSIBLE | REJECTED, note }（ADR-0005）
```

- 改善案は「rules/xxx.md をこう書き換える」「この step の後にレビュー agent を追加する」の粒度まで具体化する。

## Consequences

- (+) finding が検証可能になり、HTML から ①② の該当箇所へリンクできる。
- (−) ②で review_points / judgment_points を事実として切り出す手間が増える。
