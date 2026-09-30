# D. ADR（決定記録）

## この軸で見ること

設計判断や方針決定が、**結論だけでなく経緯（なぜそうしたか、何を捨てたか）とともに**記録され、あとから辿れるか。そして、その記録がフローの中で**書かれ、読まれている**か。記録場所があるだけでは足りない。

## check 一覧

| ID | チェック | severity 目安 | basis |
|---|---|---|---|
| D1 | 決定を記録する場所が定義されている（`docs/adr/`、`decisions/`、memory 内の決定セクション等） | should | custom |
| D2 | 決定をした直後に記録する step / 指示がフローにある | should | custom |
| D3 | 関連する作業の着手時に決定記録を読む step / 指示がある | should | custom |
| D4 | 1 決定 1 エントリで、Context（背景）・Decision（決定）・Consequences（結果・代償）・Status（有効 / 置換済み）に相当する要素を持つ | nice to have | custom |
| D5 | 決定を変えるときの運用（既存を書き換えず新規追加、旧を Superseded にする）が定義されている | nice to have | custom |
| D6 | CLAUDE.md や rules に書かれた「〜とする」「〜を採用」という決定に、経緯を辿れる参照（ADR へのリンク等）がある | nice to have | custom |

## 公式

出典（取得日 2026-09-25）:
- https://code.claude.com/docs/en/best-practices — CLAUDE.md に含めるものの表に「Architectural decisions specific to your project（プロジェクト固有のアーキテクチャ上の決定）」がある `[BP]`
- https://code.claude.com/docs/en/memory — 「プロジェクトの CLAUDE.md には build/test コマンド、コーディング規約、architectural decisions、命名規約、共通ワークフローを書く」`[BP]`。auto memory の `project` 種別は「コードや git 履歴から導けない、進行中の作業・期限・決定」を保存する `[HARD]`（仕組みの説明）

公式が言っているのはここまで。**決定を「どう」記録するか（経緯・形式・運用）、いつ書き、いつ読むかについて、公式の記述はない。** ADR という形式も公式には出てこない。D1〜D6 はすべて独自基準。

## 独自

### なぜ ADR を求めるか

- 結論だけが CLAUDE.md にあると、あとから「なぜこうなっているのか」「変えていいのか」が判断できない。人間もエージェントも、経緯が分からない決定は壊すか、二重に決め直す
- エージェントは決定の経緯をセッションを跨いで覚えない。CLAUDE.md の一行「X を採用」は、次のセッションでは根拠のない制約に見える
- 決定が memory の `long_term.md` のような雑多なファイルに埋もれると、探せないし、置き換えられたかも分からない

### 何をもって「ある」とするか

- 場所は問わない。`docs/adr/` でも `decisions/` でも、memory ファイル内の明確な「決定」セクションでもよい。ただし **1 決定 1 エントリで、経緯が読める**こと
- 形式は Status / Date / Context / Decision / Consequences を満たせばよい。見出し名は問わない
- 「書く指示」だけあって「読む指示」がないものは write-only。読まれない記録は存在しないのと同じ（A 軸の memory と同じ考え方）

### severity の考え方

- D1 がない：should。ハーネスが小さいうち（CLAUDE.md だけ）は nice to have に下げてよい
- D1 はあるが D2 / D3 がない：should。場所だけ作って運用がない状態は、放置されがち
- D4〜D6：nice to have。運用が回っていれば形式は後から整えられる

## 判定の手引き

### evidence の探し方

1. `harness.json` の `memory[]` で `kind: decision-record` または `adr_like` を探す。なければ `memory_candidates` と `top_level` を見る（`docs/adr`, `decisions`, `DECISIONS.md` 等）
2. `flows.json` の各フローの `steps[]` と `artifacts[]` で、決定記録への `memory-write` / `file` 出力があるか（D2）、`inputs` に決定記録があるか（D3）を見る
3. CLAUDE.md / rules の「〜とする」「〜を採用」「〜は禁止」の行（`instruction_lines` が多いファイル）を Read し、経緯や参照があるか見る（D6）
4. 決定記録が存在する場合、実ファイルを 2〜3 件 Read して形式（D4）と運用（D5）を確認する

### proposal の粒度

- D1 がない場合：置き場所と最小テンプレートを提案する

  ```markdown
  # ADR-0001: <決定の一行要約>
  - Status: Accepted
  - Date: YYYY-MM-DD
  ## Context
  ## Decision
  ## Consequences
  ```

- D2 / D3 がない場合：どのフローのどの step の**後**（書く）／**前**（読む）に、どの一文を足すかまで書く。例：「`skill:developer-workflow` の step 2（実装方針の決定）の直後に『方針が既存の決定と異なる、または新しい決定を含む場合は `docs/adr/` に追加する』を足す」
- D6：該当行の直後に `（経緯: docs/adr/0003）` のような参照を足す提案

### よくある誤判定

- memory の `long_term.md` に「習得したこと」「設計判断」セクションがある場合、**それは D1 を満たしうる**。経緯が読め、1 決定が区別できるなら pass、雑多に混ざっているなら D4 の finding にする。「ADR というディレクトリがない」だけで finding にしない
- spec や仕様書は決定記録ではない（何を作るかであって、なぜそう決めたかではない）。ただし spec 内に「採用理由」節があれば D1 の候補になる
- このリポジトリ自身をレビューする場合、`docs/adr/` があることと、CLAUDE.md が ADR の運用を指示していることを確認する
