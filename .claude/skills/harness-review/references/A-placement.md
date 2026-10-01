# A. 適材適所

## この軸で見ること

各ファイルの内容が、その**ロードタイミング**（いつコンテキストに入るか）に合った場所にあるか。常駐すべきでないものが常駐していないか、機械的に強制すべきものが散文で頼まれているだけになっていないか、参照が実在するか、memory が書かれ・読まれているか。

## ロードタイミング（①の `load` 値）

| load | 何が | いつコンテキストに入るか |
|---|---|---|
| always | CLAUDE.md（ルート・.local・.claude/）、`paths` なしの rules、`@import` 先 | 毎セッション起動時 |
| path-scoped | `paths` 付き rules、サブディレクトリの CLAUDE.md、`paths` 付き skill | 該当パスのファイルを読んだとき |
| on-demand | skill（既定） | description が常駐し、本文は Claude が選んだとき／`/name` で呼んだとき |
| invoked | `disable-model-invocation: true` の skill、commands | 人が `/name` で呼んだときだけ（description も常駐しない） |
| spawned | agents | Agent tool で起動されたとき。本文（system prompt）＋ `skills:` で注入した skill の**全文**＋ CLAUDE.md 階層 |
| triggered | hooks とそのスクリプト | イベント発火時。コンテキストではなく実行 |
| support | skill 同梱ファイル | skill 本文から参照されて Read されたとき |
| meta | settings / .mcp.json / manifest | 設定として読まれる。コンテキストには入らない |

## check 一覧

| ID | チェック | severity 目安 | basis | 対象 |
|---|---|---|---|---|
| A1 | 常駐（always）に、複数ステップの手順や、コードベースの一部にしか関係しない内容がない | should | official | file:claude-md / file:rule |
| A2 | CLAUDE.md が 1 ファイル 200 行以下。常駐の合計トークンが肥大していない | should | official | file:claude-md / harness |
| A3 | rule の `paths` の有無が内容と一致している（パス限定の内容に `paths` がある。汎用の内容に `paths` がない） | should | official | file:rule |
| A4 | 「例外なく必ず / 絶対に〜するな」に相当する指示が、散文だけでなく hook または permissions で強制されている | should（破壊的操作・セキュリティに関わるものは must） | official | file:claude-md / file:rule / file:skill / file:agent |
| A5 | ファイル間で指示が重複・矛盾していない | must（矛盾）/ should（重複） | official | harness |
| A6 | 参照が実在する：`skills:` で注入する skill、呼び出す agent / skill、`@import` 先、hook のスクリプトが存在し、対象ディレクトリ内にある。孤立したスクリプトがない | must | custom | file:agent / file:skill / file:claude-md / hook |
| A7 | skill の内容種別と起動制御が合っている：副作用のある task 型に `disable-model-invocation: true`、参照専用に `user-invocable: false`、手順のない skill に `context: fork` がない | should | official | file:skill |
| A8 | agent の起動時コンテキスト（本文＋注入 skill）が過大でない。参照型の大きな skill を、必要のない agent にまで注入していない | should | custom | file:agent |
| A9 | `.claude/commands/`（旧配置）ではなく skills を使っている | nice to have | official | harness |
| A10 | memory に書く指示と読む指示の両方がある（write-only / read-only でない）。記録先が存在する | must（必須の書き込み指示があるのに読まれない）/ should | custom | memory |
| A11 | main conversation / subagent / skill の使い分けが公式の指針に沿っている（往復が要る作業を subagent にしていない、冗長な出力を main で受けていない） | nice to have | official | flow |

## 公式

出典（取得日 2026-09-25）:
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents

### CLAUDE.md に何を置くか（A1, A2）

- `[BP]` 含めるもの：推測できない Bash コマンド、既定と異なるコードスタイル、テスト手順とテストランナー、リポジトリ作法（ブランチ名、PR 規約）、プロジェクト固有のアーキテクチャ上の決定、開発環境の癖（必須の環境変数）、よくある落とし穴
- `[BP]` 含めないもの：コードを読めば分かること、Claude が知っている標準的な言語規約、詳細な API ドキュメント（リンクにする）、頻繁に変わる情報、長い説明やチュートリアル、ファイルごとの解説、「クリーンなコードを書け」のような自明なこと
- `[BP]` 「**各行について『これを消したら Claude が間違えるか？』と問え。違うなら削れ。**肥大化した CLAUDE.md は本来の指示を無視させる」
- `[BP]` 「エントリが複数ステップの手順か、コードベースの一部にしか関係しないなら、**skill か path-scoped rule に移せ**」。CLAUDE.md は「毎セッション持つべき事実：ビルドコマンド、規約、レイアウト、『常に X する』ルール」に留める
- `[BP]` 「**1 ファイル 200 行以下を目標**にする。長いファイルはコンテキストを消費し、遵守率を下げる」。`@import` は整理には役立つが起動時に読み込まれるのでコンテキスト削減にはならない
- `[BP]` 「同じ指示を無視し続けるなら、ファイルが長すぎてルールが埋もれている。CLAUDE.md をコードのように扱え：問題が起きたら見直し、定期的に刈り、変更後は挙動が変わったか観察する」
- `[BP]` 「1 つの指示だけ飛ばされるなら、その行にだけ IMPORTANT を付ける。多くの行を強調すると、どれも目立たない」
- `[HARD]` CLAUDE.md の内容は「system prompt ではなく、その後の user message として渡される。Claude は従おうとするが、厳密な遵守の保証はない。曖昧・矛盾した指示では特に」

### rules（A3）

- `[HARD]` `.claude/rules/*.md` は再帰的に発見される。「`paths` がない rule は起動時に `.claude/CLAUDE.md` と同じ優先度で読み込まれる」。`paths` 付きは「パターンに一致するファイルを Claude が読んだときに発火する」
- `[HARD]` rule の frontmatter で読まれるのは **`paths` だけ**。他のキーはエラーなしで無視される。YAML が壊れていれば `paths` なしとして扱われる
- `[BP]` 「rules は毎セッション、または一致ファイルを開いたときにコンテキストに入る。常時必要でないタスク固有の指示は skill を使え」
- `[HARD]` ユーザー rules とプロジェクト rules は「どちらも他方を上書きしない。矛盾すれば Claude はどちらに従うか分からない」

### hooks は強制、CLAUDE.md は助言（A4）

- `[HARD]` 「CLAUDE.md と auto memory は**コンテキストであって、強制される設定ではない。Claude の判断に関わらず操作をブロックしたいなら PreToolUse hook を使え**」
- `[HARD]` 「CLAUDE.md の指示は助言的だが、hooks は決定的で、その操作が起きることを保証する」「**例外なく毎回起きるべき操作には hooks を使え**」
- `[BP]` 失敗パターン "over-specified CLAUDE.md" の処方：容赦なく刈り、「常に正しい挙動は hook に変換する」
- `[HARD]` 技術的な強制（`permissions.deny`、sandbox 等）は settings、行動・スタイルの指針は CLAUDE.md、という分担

### 重複と矛盾（A5）

- `[BP]` 「CLAUDE.md、ネストした CLAUDE.md、`.claude/rules/` を定期的に見直して矛盾を探せ」

### skills の置き方（A1, A7, A9）

- `[BP]` 「同じ指示・チェックリスト・複数ステップの手順をチャットに貼り続けているとき、または **CLAUDE.md のある節が事実ではなく手順に育ってしまったとき**に skill を作れ。skill の本文は使われるときだけ読み込まれるので、長い参照資料も必要になるまでほぼコストがかからない」
- `[HARD]` skill の **description は毎ターン常駐**し（`when_to_use` と合わせて 1,536 文字で切られる）、**本文は呼ばれたときだけ**読み込まれる。ただし agent の `skills:` で注入された skill は起動時に**全文**が入る
- `[BP]` 内容の 2 種類：**参照型**（規約、パターン、ドメイン知識。inline で動く）と **task 型**（デプロイ、コミット、生成のような手順。「`/skill-name` で直接呼ぶことが多い。`disable-model-invocation: true` を付けて自動起動を防げ」）。「コードが良さそうだからと Claude にデプロイを決めさせたくはないだろう」
- `[HARD]` `disable-model-invocation: true` の skill は description も常駐せず、agent の `skills:` で注入もできない（黙って飛ばされる）
- `[BP]` 参照専用の skill には `user-invocable: false`
- `[BP]` 「`context: fork` は明示的な指示を持つ skill にだけ意味がある。『この API 規約を使え』のような指針だけの skill を fork すると、subagent は指針を受け取るが実行すべきタスクがなく、意味のある出力なしに戻る」
- `[HARD]` `.claude/commands/` は「古い形式。今も動くが、`name` と `paths` を除く同じ frontmatter を受け付ける」。skills が supporting files・起動制御・自動ロードを追加した後継
- `[BP]` skill が多すぎる場合の対処：description を主要ユースケースに絞る、大きな汎用 skill を小さく分割する、参照専用に `user-invocable: false`、詳細を同梱ファイルへ、`paths` で発火を絞る

### subagents の置き方（A8, A11）

- `[BP]` 「サイドタスクが検索結果・ログ・ファイル内容で main conversation を溢れさせそうなときに使え。subagent は自分のコンテキストでやって要約だけ返す。同じ指示で同じ種類のワーカーを何度も起動しているなら custom subagent を定義せよ」
- `[BP]` **main conversation** を使うとき：頻繁な往復や反復的な調整が要る、計画・実装・テストのように複数フェーズが大きなコンテキストを共有する、素早い局所的な変更、レイテンシが重要。**subagent** を使うとき：冗長な出力を main に入れたくない、ツール制限や権限を強制したい、自己完結で要約を返せる。「main conversation で動く再利用可能なプロンプトやワークフローが欲しいなら skill を検討せよ」
- `[HARD]` subagent の起動時コンテキスト：自身の system prompt（本文）＋環境情報＋委譲メッセージ＋ **CLAUDE.md 階層**（`omitClaudeMd: true` で除外可、v2.1.271+）＋ git status ＋ **注入 skill の全文**。会話履歴と auto memory は見えない
- `[BP]` 「description はコンテキストを消費する。短く保ち、詳細は subagent が動くときだけ読み込まれる system prompt に移せ」
- `[HARD]` 全 custom subagent の description 合計が 15,000 トークンを超えると起動時に警告
- `[HARD]` agent ファイルは `name` がないと「ドキュメント扱い」で読み込まれない。`description` がないとスキップ。`name` に `:` や先頭 `-` は不可。いずれもセッション内では報告されない（`--debug` で確認）

### memory（A10）

- `[HARD]` auto memory は Claude が自分で書く（`user` / `feedback` / `project` / `reference` の 4 種）。`~/.claude/projects/<project>/memory/` に `MEMORY.md`（毎セッション先頭 200 行 / 25KB）＋トピックファイル。**subagent には読み込まれない**（fork を除く。subagent は `memory:` フィールドで自前の memory を持てる）
- プロジェクト独自の memory ファイル（`memory/` ディレクトリ等）の運用について、公式の記述はない。A10 は独自基準

## 独自

### 閾値（調整可）

公式が数字を出しているのは「CLAUDE.md 200 行」だけ。以下は経験則で、`references` を編集して調整する。

| 対象 | should | must |
|---|---|---|
| 常駐合計（`summary.always_loaded_tokens_est`） | > 8,000 トークン | > 16,000 トークン |
| agent の起動時コンテキスト（`context_at_spawn_tokens_est`） | > 30,000 トークン | > 60,000 トークン |
| 1 skill 本文 | 500 行超（公式）→ B 軸で扱う | — |

根拠：常駐 8k はセッション開始時点で有効コンテキストの数%を固定費として食う水準。agent 起動時 30k は、注入 skill が agent 本文の 20 倍以上になっていることが多く、「注入すべき skill を選んでいない」兆候。

### A6（参照の整合）を must にする理由

- 存在しない skill を `skills:` に書いても、存在しない agent を呼んでも、**エラーは出ない**。黙って抜けるので、ハーネスの作者は「効いている」と思い続ける。発見できるのはこのツールのような静的検査だけ
- hook が対象ディレクトリの外のスクリプトを指している場合、別環境では動かず、しかも hook の失敗は exit code 次第で黙って通る
- 孤立したスクリプト（どの hook からも参照されない）は、過去に効いていたものが外れた痕跡であることが多い

### A8（注入の過大）の考え方

- `skills:` は「その agent が毎回必要とする手順」を入れる場所。参照型の巨大 skill（規約集）は、agent が必要なときに Read すればよい。全 agent に全規約を注入すると、起動時コンテキストが本文の数十倍になり、agent 自身の指示が埋もれる
- 判定は「その agent の役割に、その skill の全文が毎回必要か」。convention-reviewer に規約集を注入するのは妥当、product-owner に注入するのは過大

### A10（memory の write-only / read-only）

- 書く指示だけあって読む指示がない memory は、**書くコストだけ払って誰にも効かない**。人間が読む運用なら、それが明記されているべき（E2 と同じ考え方）
- 読む指示だけあって書く指示がない memory は、内容が古びる一方になる。初期投入だけで運用がないことが多い
- 判定は `harness.json` の `memory[].writers / readers` で機械的にできる。ただし「人間が書く」「別プロジェクトが書く」場合があるので、reviewer は記録先の中身を 1 つ Read して、実際に更新されているか（`mtime`、内容の日付）を見る

## 判定の手引き

### evidence の探し方

1. **A1 / A2**：`harness.json` で `load: always` のファイルを列挙し、`size.lines`、`summary.always_loaded_tokens_est`、`content_mix` を見る。`procedure` の比率が高い常駐ファイルは A1 の候補。該当節を Read して見出しと行範囲を引用する
2. **A3**：`rule` の `paths` と `content_mix` / `summary` を突き合わせる。`paths` なしで内容が特定パス（`flyway/`、`src/api/` 等）に閉じていれば finding
3. **A4**：`instruction_lines` が多いファイルを Read し、「必ず」「絶対」「禁止」「never」「always」の行を拾う。それぞれについて `hooks[]` と `permissions[]` に対応する強制があるか確認する。破壊的操作（push、削除、本番反映、秘密情報）に関わるものは must
4. **A5**：`refs.harness_files` と `refs.skills` で相互参照の多いファイル群を Read し、同じ話題の指示を比較する。矛盾は両方の行を引用する
5. **A6**：`preloads_skills[].resolved === false`、`refs.agents` に出るが `agent:` に存在しない名前、`imports[].exists === false`、`hooks[].script.exists === false || outside_target === true`、`hook-script` で `referenced === false`。すべて discover の事実なので、引用して終わり
6. **A7**：skill の `purpose`（task / reference）と frontmatter（`disable-model-invocation`、`user-invocable`、`context`）の組み合わせ
7. **A8**：`context_at_spawn_tokens_est` と `preloads_skills[]` の内訳。閾値超えの agent について、各注入 skill が役割に必要かを判断する
8. **A9**：`kind: command` の存在
9. **A10**：`harness.json` の `summary.memory.write_only / read_only`、`memory[].writers / readers`
10. **A11**：`flows.json` で `orchestrator.context` と steps の往復回数を見る。確度が高い場合だけ finding にし、迷ったら pass にしない（n.a. にして理由を書く）

### proposal の粒度

- A1：どの節（見出しと行範囲）を、どの skill（既存 or 新規、名前つき）または rule（`paths` 案つき）に移すかを書く
- A2：分割案（何を残し、何を移すか）を A1 と合わせて書く
- A3：`paths:` の具体的なパターンを書く
- A4：hook の定義（event / matcher / command の骨子）または `permissions.deny` のエントリを書く
- A5：どちらを正とし、もう一方をどう直すか
- A6：正しい参照先、または削除。hook のパス修正は `$CLAUDE_PROJECT_DIR` を使った書き方まで
- A7：足す / 外す frontmatter の行
- A8：`skills:` から外す skill と、代わりに本文へ足す「必要なら `.claude/skills/<name>/SKILL.md` を Read せよ」の一文
- A10：読む step をどのフローのどこに足すか（write-only）、書く step をどこに足すか（read-only）

### よくある誤判定

- CLAUDE.md にプロジェクトのパス構成やロールの起動方法が書かれているのは A1 違反ではない（毎セッション必要な事実）。違反になるのは**手順**（ステップの列）と**特定パス限定の規約**
- 「必ず」が付いていても、行動指針（「必ず日本語で答える」）は A4 の対象外。A4 は**操作**（コマンド実行、ファイル変更、外部送信）に関する禁止・強制だけ
- `paths` 付き rule が長くても A2 の対象外（常駐しない）。B 軸の長さチェックで扱う
- agent が `Read` で skill を読む運用なら、`skills:` に無くても A6 違反ではない
- このツール自身をレビューするとき：`.claude/agents/` の 4 agent が `skills:` を使わず references を Read する設計なのは意図的（A8 の pass）
