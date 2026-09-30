# ADR-0015: 抽出者（S1 / S2）の裁量判断を judgment_notes として記録し、検証ログと最終報告に載せる

- Status: Accepted
- Date: 2026-09-30

## Context

- 自己レビュー（run 2026-09-26-0915、finding E5-010c21）の指摘：②が抽出した `flow:harness-extractor` の judgment_point 3 件（`content_mix` / `purpose` の配分、`hints.memory` を誤検出として除く判断、`is_memory` の運用判断）はすべて `logging_instructed: false`。agent 本文の報告は 1 行に限定され「判断しない」と書かれているため、CLAUDE.md の「自己判断として明記する」も SKILL.md の最終報告の「自己判断」項も、この agent の埋めた判断には届かない。下流の S2 / S3 は `harness.json` を事実として扱うので、埋めた比率や除外した hint は検証されないまま確定する。
- 同じ構造は flow-extractor にもある：implicit フローの確度（`explicit-procedure` / `procedure-like`）、spawn 手がかりの `noise` 分類、`not_flows` の判定はいずれも裁量で、②の網羅性検証は「帰属したか」しか見ない。
- ADR-0004 は「①②は事実のみ、判断は③」と定めている。ここで記録するのは**対象に対する評価ではなく、抽出者が自分の出力を作るときに置いた前提と選択**であり、ADR-0004 の「判断」（対象の良し悪し）とは別物。むしろ「事実として扱われるものに、どこまで裁量が混ざっているか」を事実として残す。
- ADR-0009 により subagent はファイルに書き 1 行返す。記録先はその出力ファイルの中でよい。
- references/E-judgment-log.md の E1〜E3：記録の指示にはトリガー・対象・場所が揃っていること、記録先が人間の目に届く経路にあること、ゼロでも「なし」を明示すること。

## Decision

- 裁量判断は **2 層**で記録する。
  1. **スクリプトが列挙できるもの（derived）**：抽出者が除外した memory 手がかり（discover の `hints.memory` のうち同じ行の `memory_ops` にならなかったもの）、`noise` と判定された spawn 手がかり、`not_flows` と判定された入口。merge が機械的に列挙するので漏れない。
  2. **自己申告（self_reported）**：`extract@1`（S1）と `flows@1`（S2）の batch 出力に `judgment_notes[]` を追加する。列挙できない裁量（`content_mix` / `purpose` の配分、`opening` の判定、implicit の確度、step の境界、review_point / judgment_point に入れるかの判断）と、derived の各項目の**理由**を書く。1 件の形：

     ```json
     { "target": "skill:developer-workflow", "kind": "memory_hint_dropped", "note": "行 190 の application.yml は設定ファイルの参照で memory ではないと判断し除外", "alternative": "読み取り記録として残す" }
     ```

     `target` は S1 では file id または memory id（`memory:<path>`）、S2 では入口 id / フロー id（`flow:x`）/ step（`flow:x#3`）。`kind` は S1: `content_mix | purpose | opening | memory_hint_dropped | memory_kind | audience | other`、S2: `implicit_confidence | noise | not_flow | step_boundary | review_point | judgment_point | other`。`alternative` は採らなかった解釈（任意）。
- harness-extractor / flow-extractor の手順に「裁量で判断したことを `judgment_notes` に書く。無ければ `[]` を必ず書く」を足す。報告行に件数を含める。
- merge S1 / S2 は `judgment_notes` を batch 横断で集め、`harness.json` / `flows.json` の `judgment_notes[]`（batch 名つき）に入れる。**キー自体が無い batch は `judgment_notes_missing[]` に記録し、「0 件」と「未記録」を区別する**。merge S1 は derived の除外 memory 手がかりを `derived_judgments` に入れる。
- merge S4 は `verification.json` に **`stage1` / `stage2` とは別の** `extractor_judgments` を置き、`self_reported`（未検証と明記）、`missing`、`derived` を入れる。網羅性検証の結果と並べて「検証済み」に見せない。
- render は検証ログの節に「抽出者の裁量判断」の小節を置き、未記録 batch の警告、自己申告（未検証と明記）、スクリプトが列挙した裁量を分けて表示する。`target` は `flow:` 接頭辞ならフローへ、`memory:` なら memory 表の行へ、それ以外はファイルへリンクする。**`verification.json` に `extractor_judgments` キー自体が無い run（本 ADR 以前）は「記録なし（ADR-0015 以前）」と表示し、0 件とも未記録 batch とも区別する**。`summary` も同様に `unknown` と出す。`summary` は ①② の行に自己申告件数・未記録 batch・除外 memory 手がかり数（上限値）を出す。SKILL.md の最終報告に同じ内容を足す。
- derived の除外 memory 手がかりは、抽出者が実際に処理したファイルに限って数える。同じ行に `memory_ops` が無いことを条件にするので、隣の行に記録された場合も「除外」に含まれる。**漏れはないが上限値**であり、表示にはその旨を付ける。
- ③のレビュアーは `harness.json` / `flows.json` の `judgment_notes` と derived を読める。裁量が混ざった箇所を finding の evidence にするかは reviewer の判断に委ね、本 ADR では強制しない。
- 対象は S1 / S2 に限る。S3 の裁量のうち finding は S4 が反証する（ADR-0005）。pass / na は `note` / `reason` に理由を持つが v1 では検証されず（ADR-0005）、severity の選択も finding の `claim` に理由がある場合を除き記録されない。これらは本 ADR の対象外として残す。S4 の verdict は `note` に根拠を持つ。オーケストレータの裁量は SKILL.md の最終報告「自己判断」で扱う。
- ADR-0004 の範囲は狭めない。①②が出すのは依然として事実だけで、`judgment_notes` は対象への判断ではなく「事実を作った側の選択」の記録である。したがって ADR-0004 の Status 行への注記はしない。

## Consequences

- (+) ①②の「事実」にどこまで裁量が混ざっているかが人間の目に届く。除外された hint や境界の引き方が後から追える。
- (+) E5 の基準を、このツール自身の抽出者に対して満たす。
- (+) 列挙できる裁量はスクリプトが出すので、自己申告の漏れがあってもゼロにはならない。
- (−) 自己申告は誰も検証しない。抽出者が「何が裁量か」を判断するのも裁量であり、記録漏れは残る。網羅は保証しない。
- (−) S1 / S2 の出力とプロンプトがわずかに増える。件数が多いと検証ログが長くなる（一覧は折りたたみ）。
- (−) この ADR より前の run は、merge を回し直せば全 batch が「未記録」、`verification.json` を回し直さず再 render だけなら「記録なし（ADR-0015 以前）」と表示される。どちらも事実なのでそのままにする。
- (−) derived の除外 memory 手がかりは上限値で、抽出者が別の行番号で記録した分が偽陽性として混ざる。
- (−) S3 の pass / na / severity の裁量は v1 では検証も記録もされないまま残る。

## 検証

### 1 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [事実] Context の引用はすべて実在し、事実の誤りは無い。
2. [結果] 「ゼロのときも `[]` を必ず書く（未記録と区別する）」が成立しない。merge は未記録を空に潰し、render も 0 件を「記録なし」と出す。過去 run の再 render も同じ表示になる点が Consequences に無い。
3. [導出] 機械検出という代替が検討されていない。除外した memory hint、noise、not_flows はスクリプトで漏れなく列挙できる。
4. [結果] `verification.json` の `stage1` / `stage2` は網羅性検証の結果の置き場で、そこに未検証の自己申告を並べると検証済みに見える。
5. [結果] 対象を S1 / S2 に限る理由が無い。
6. [矛盾] ADR-0004 に例外を足すのに注記を規定していない。狭めていない理由を書くべき。
7. [結果] S2 の `file` がフロー id を指すと render のリンクが死ぬ。値域が未定義。

#### 対応

1. 対応不要。
2. merge がキーの無い batch を `judgment_notes_missing` に記録し、render と summary が「未記録」を 0 件と区別して警告するようにした。過去 run の表示を Consequences に書いた。
3. Decision を 2 層（derived / self_reported）に改め、除外 memory 手がかり・noise・not_flows はスクリプトが列挙し、自己申告は列挙できない裁量と理由に絞った。
4. `verification.json` に `stage1` / `stage2` と別の `extractor_judgments` を置き、`self_reported` に未検証の注記を付けた。render も別小節にした。
5. Decision に S3 / S4 / オーケストレータを対象外とする理由を書いた。
6. Decision に「ADR-0004 の範囲は狭めないので注記しない」を書いた。
7. `file` を `target` に改め、値域（file id / flow id / step）を定めた。render は接頭辞でリンク先を切り替える。

2〜7 で Decision を変えたので 2 回目の検証にかけた。

### 2 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [事実] 本 ADR 以前の run を再 render すると `verification.json` にキーが無いため「全 batch が記録済み」と逆に表示される。summary も UNRECORDED を付けない。
2. [結果] derived の除外 memory 手がかりは、抽出対象外のファイルの hint や別行に記録された分を含む偽陽性がある。上限値と明記すべき。
3. [結果] `target` の値域が memory 判断（`memory_kind`、`is_memory`）を覆っておらず、memory 行にアンカーも無いので死リンクになる。
4. [導出] S3 を対象外とする理由が pass / na / severity に及ばない。v1 では pass は検証されない（ADR-0005）。

#### 対応

1. `extractor_judgments` キーが無い run は「記録なし（ADR-0015 以前）」と表示し、summary は `unknown` と出すようにした。Consequences を実装に合わせて直した。
2. derived は抽出者が処理したファイルに限定し、表示と summary に「上限値（≤）」を付けた。Decision と Consequences に明記。
3. `target` の値域に `memory:<path>` を追加し、memory 表の行にアンカーを付け、render がリンク先を切り替えるようにした。
4. Decision の除外理由を「finding のみ S4 が反証。pass / na / severity は v1 では未検証・未記録のまま残す」に直し、Consequences に (−) として残した。

1・3・4 で Decision に触れたが、往復上限（2 回）に達したためユーザーに判断を仰いだ。ユーザーの決定：**反映して確定**（表示と値域の穴埋めであり、中核の「2 層で記録し、未検証と明示し、未記録を区別する」は変わらないため）。
