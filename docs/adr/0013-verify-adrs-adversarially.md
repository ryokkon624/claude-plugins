# ADR-0013: 新しい ADR は別コンテキストで反証してから Accepted にする

- Status: Accepted
- Date: 2026-09-30

## Context

- 自己レビュー（run 2026-09-26-0915、finding C2-a585f9）の指摘：ADR-0005 は③のレビュー結果に「正解のない成果物は別コンテキストの敵対的検証が要る」という基準を課しているが、同じ性質を持つ自分の設計判断（ADR）には課していない。ADR は書いた本人（メインセッション）だけで確定している。
- 設計判断は正解のない作業の代表例で、書いた本人のレビューは同意にしかならない（references/C-review.md の独自節）。
- 一方で ADR は 1 本が短く、反証の入力は ADR 本文と既存 ADR だけで足りる。コストは agent 1 回分。
- ADR-0009 は「subagent は結果をファイルに書き、オーケストレータにデータを返さない」と定めているが、これは harness-review パイプライン（`<run>/work/` を持つ S1〜S4 の subagent）でオーケストレータのコンテキストを守るための制約である。ADR の検証結果は 30 行以内で、パイプラインの外にある。

## Decision

- 新しい ADR は `Status: Proposed` で書く。Proposed のまま付随する実装（agent 定義、CLAUDE.md の運用記述など）を進めてよい。`REJECTED` になったら付随変更も戻す。
- `.claude/agents/adr-verifier.md`（tools: Read / Glob / Grep、fresh context）に、**ADR のパスだけ**を渡して反証させる。書いた側の推論過程や会話は渡さない。verifier が見るのは：
  1. Context に書かれた事実が正しいか（リポジトリ内で確認できるものは確認する）
  2. Decision が Context から導けるか。見落とした代替案はないか
  3. Consequences に抜けはないか（特にマイナス面）
  4. 既存 ADR（docs/adr/）と矛盾しないか
- verifier は `CONFIRMED`（そのまま採用できる）/ `PLAUSIBLE`（採用できるが指摘に対応すべき）/ `REJECTED`（前提が誤っている、または既存 ADR と矛盾する）の verdict と根拠を **30 行以内の markdown で返す**。ADR-0009 の「ファイルに書いて 1 行返す」はパイプライン内の subagent への制約であり、adr-verifier には適用しない。
- 結果を ADR 末尾の `## 検証` 節に、**ラウンドごと**（`### 1 回目`、`### 2 回目`…）に記録する：日付、verdict、指摘、対応（Decision / Consequences をどう直したか、または直さない理由）。
- 対応で **Decision を変えた場合は再検証する**。Consequences への追記や Context の事実訂正だけなら再検証しない。往復は最大 2 回とし、決着しなければユーザーに判断を仰ぎ、その旨を対応に書く。
- `CONFIRMED`、または指摘に対応した `PLAUSIBLE` で `Status: Accepted` にする。`REJECTED` は書き直すか `Status: Rejected` にする。
- 反証を探すよう指示された verifier は健全な ADR にも何か言う（公式ドキュメントの警告）。反映するのは **Decision を覆すもの、または Consequences に足すべきもの**だけで、好みや文体の指摘は対応しない旨を「対応」に書く。
- 新 ADR が既存 ADR の**適用範囲を狭める**（Decision は変えない）場合は、既存 ADR の本文は書き換えず、その Status 行に「Accepted — 適用範囲は ADR-XXXX で明確化」と注記する。索引の要約は既存 ADR のタイトルどおりに保つ。
- docs/adr/README.md の索引に Status 列を置き、`Proposed` のまま残っている ADR を可視化する。
- 既存の ADR-0001〜0012 には遡及しない。変更するときは新 ADR として通る。

## Consequences

- (+) 設計判断にも C 軸の基準が適用され、ADR に反証の記録が残る。あとから読む人が「何が検討され、何が反論されたか」を辿れる。
- (+) verifier は ADR 本文だけを見るので、Context の書き方が悪い（事実が足りない）ことがその場で分かる。
- (−) ADR 1 本につき agent 1〜3 回のコストと、verdict を待つ往復が増える。
- (−) `Proposed` のまま放置される ADR が出うる。索引の Status 列で可視化する。
- (−) verifier（`model: opus`）は ADR を書くメインセッションと同系のモデルなので、共有する盲点は外せない。fresh context で推論過程を渡さないことまでが本 ADR の保証で、モデル系の分離は ADR-0005 と同じく選択肢として残す。

## 検証

### 1 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [矛盾] ADR-0009 の Decision は「すべての subagent は `<run>/work/<stage>/<batch>.json` に結果を書き、オーケストレータへの返答は 1 行に限る」で、CLAUDE.md も無条件に書いている。本 ADR の adr-verifier は markdown を返しファイルに書かない。ADR-0009 をパイプライン内の subagent に限る旨が Decision にも CLAUDE.md にもなく、例外として処理されていない。
2. [事実] 「既存の ADR-0001〜0014 には遡及しない」が誤り。実在するのは 0001〜0012 のみ。本 ADR の番号 0015 で索引に 0013〜0014 の欠番が生じる。
3. [結果] Consequences の「索引に Status を出して可視化する」が Decision に入っておらず、索引には Status 列がない。Accepted にしても可視化は実行されない。
4. [結果] PLAUSIBLE の指摘に対応して Decision を直した ADR を再検証するかどうかと、往復の上限が書かれていない。元の finding C2-a585f9 の proposal にあった「2 往復で決着しなければユーザーに判断を仰ぐ」が落ちている。

#### 対応

1. Context に ADR-0009 の適用範囲（パイプライン内）を書き、Decision に「adr-verifier には適用しない」を明記した。CLAUDE.md の ADR-0009 の行も「パイプラインの subagent は」に直した。
2. 本 ADR を 0013 に採番し直し、「0001〜0012 には遡及しない」に訂正した。
3. Decision に「索引に Status 列を置く」を追加し、docs/adr/README.md の索引に Status 列を足した。
4. Decision に「Decision を変えたら再検証、最大 2 往復、決着しなければユーザーに判断を仰ぐ」を追加した。1・3・4 で Decision を変えたので 2 回目の検証にかけた。

### 2 回目

- Date: 2026-09-30
- Verifier: adr-verifier（ネイティブの agent 型で起動）
- Verdict: PLAUSIBLE

#### 指摘

1. [矛盾] ADR-0009 側に本 ADR への参照がなく、範囲の限定が ADR-0009 だけを読む人に届かない。索引行だけが「パイプラインの subagent は…」に書き換わり、ADR-0009 の本文と食い違っている。旧 ADR の Status を更新する経路を通すか、例外を Decision に明記する必要がある。
2. [結果] 検証者のモデル多様性に触れていない。adr-verifier は `model: opus` で、ADR を書くメインセッションと同系。ADR-0005 が論点化した観点が落ちている。
3. [結果] Proposed の間に実装してよいかが決まっていない。agent と CLAUDE.md は既に実装済みで、REJECTED 時の巻き戻しが未定義。
4. [結果] 検証節の多ラウンド化（1 回目 / 2 回目）が Decision に定義されていない。

#### 対応

2 往復で決着しなかったため、規則どおりユーザーに判断を仰いだ。ユーザーの決定：**4 件すべて反映し、3 回目の検証はせずに Accepted にする**（いずれも決定を覆す指摘ではなく運用の穴埋めであるため）。

1. Decision に「既存 ADR の適用範囲を狭めるときは、その Status 行に注記し、索引は本文どおりに保つ」を追加した。ADR-0009 の Status 行に「Accepted — 適用範囲は ADR-0013 で明確化」を注記し、索引の 0009 行を本文のタイトルどおりに戻した。
2. Consequences に「同系モデルのため共有する盲点は外せない」を追加した。
3. Decision に「Proposed のまま付随する実装を進めてよい。REJECTED なら戻す」を追加した。
4. Decision に「検証節はラウンドごとに記録する」を追加した。
