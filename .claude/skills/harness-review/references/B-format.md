# B. フォーマット（特に冒頭）

## この軸で見ること

各ファイルの **frontmatter** と **冒頭**が、その役割を果たしているか。モデルが skill / agent を選ぶときに見るのは description だけであり、ファイルを読み始めたときに全体を枠づけるのは最初の数行である。ここが「何であるか」の説明で埋まっていると、選ばれず、読まれても効かない。あわせて、Claude Code が実際に読む形式（必須項目、有効な YAML / JSON、hook の exit code）を満たしているかを見る。

## check 一覧

| ID | チェック | severity 目安 | basis | 対象 |
|---|---|---|---|---|
| B1 | frontmatter が有効：先頭行が `---`、YAML が壊れていない。agent は `name` と `description` がある（無いとロードされない）。skill は `description` がある（無いと本文 1 行目が代用される） | must（agent がロードされない）/ should | official | file:skill / file:agent / file:rule / file:command / file:claude-md |
| B2 | 未知の frontmatter キーがない（エラーなしで無視される）。rule に `paths` 以外のキーがない。command に `name` / `paths` がない | nice to have | official | file:skill / file:agent / file:rule / file:command |
| B3 | description が「何であるか」ではなく「**いつ使うか**」を、主要ユースケースを先頭にして書いている。トリガー句がある。skill は `description` ＋ `when_to_use` が 1,536 文字以内。agent の description は短く、詳細は本文へ | should | official | file:skill / file:agent |
| B4 | 冒頭（本文の最初の数行）で、agent は 役割・ゴール・出力形式、skill / rule は 何をするか・いつ参照するか、CLAUDE.md は プロジェクトが何か、が分かる。前置きや背景説明で始まっていない | should | custom | file:skill / file:agent / file:rule / file:command / file:claude-md |
| B5 | 本文が「何をするか」を命令形で書き、経緯や解説の物語になっていない。skill 本文は 500 行以下、詳細は同梱ファイルに分け、本文から参照している | should | official | file:skill / file:claude-md |
| B6 | 見出しと箇条書きで構造化されている（密な段落でない） | nice to have | official | file:claude-md / file:rule / file:skill / file:agent |
| B7 | hooks の定義が正しい：スクリプトが存在し実行可能、ポリシーを強制する hook が `exit 2` を使っている（`exit 1` はブロックしない）、防ぐべき操作を `PreToolUse` で gate している（`PostToolUse` は取り消せない）、matcher が意図どおり | must（gate が効いていない）/ should | official | hook / file:hook-script |
| B8 | 名前の整合：skill の `name` とディレクトリ名、agent の `name` とファイル名が一致している。plugin の `name` が kebab-case | nice to have | custom | file:skill / file:agent |
| B9 | settings.json / settings.local.json / .mcp.json / hooks.json / plugin.json が有効な JSON で、既知の構造に従っている | must | official | file:settings / file:mcp-config / file:hooks-config / file:plugin-manifest |
| B10 | skill の `allowed-tools` が最小限（許可を**与える**ものであり制限ではない。workspace trust に関係なく効く） | should | official | file:skill |

## 公式

出典（取得日 2026-09-25）:
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/plugins-reference

### skill の frontmatter と本文（B1, B2, B3, B5, B10）

- `[HARD]` frontmatter は「開始の `---` がファイルの先頭行にあるときだけ」読まれる。YAML が壊れていれば「skill はフィールドなしで読み込まれる」。「フィールド名は表と正確に一致しなければならない（ハイフン含む）。**認識しないフィールドはエラーを報告せず無視する**」。すべてのフィールドは任意で、`description` だけが推奨
- `[HARD]` `description` を省略すると「本文の最初の空でない行」が使われる。`name` はプロジェクト skill の呼び出し名を決めない（ディレクトリ名が決める）
- `[HARD]` `description` ＋ `when_to_use` の合計は skill 一覧で **1,536 文字で切られる**
- `[BP]` description の書き方：「Claude は description を見て、いつ skill を呼ぶか決める。**主要ユースケースを description の先頭に置き、`when_to_use` には価値の高いトリガーから並べる**」。トリガー句と例を足して強める。公式の例：
  > `description: Summarizes uncommitted changes and flags anything risky. Use when the user asks what changed, wants a commit message, or asks to review their diff.`
- `[BP]` 本文：「skill が読み込まれると、その内容はターンを跨いでコンテキストに残るので、**すべての行が繰り返しかかるトークンコスト**になる。**どうやるか・なぜかを語るのではなく、何をするかを述べよ**。CLAUDE.md と同じ簡潔さの基準を適用せよ」
- `[BP]` 「**SKILL.md は 500 行以下**に保て。詳細な参照資料は別ファイルに移せ」。同梱ファイルは SKILL.md から参照して、何をいつ読むか Claude に分からせる：
  ```markdown
  ## Additional resources
  - For complete API details, see [reference.md](reference.md)
  ```
- `[HARD]` skill の内容は「**一つのメッセージとして会話に入り、後のターンでも残る**。後で skill ファイルを読み直さないので、タスク全体に効くべき指針は**一回限りの手順ではなく常設の指示として**書け」
- `[HARD]` `allowed-tools` は「skill を呼んだターンの間、列挙したツールを**許可する**（プロンプトなし）。次のメッセージで消える。**他のツールを制限はしない**」。workspace trust に関係なく、未信頼の `-p` 実行でも効く。「リポジトリにチェックインされた skill の `allowed-tools` は、そこで Claude Code を実行する前に確認せよ」
- `[HARD]` `.claude/commands/*.md` は `name` と `paths` を除く同じフィールドを受け付ける（旧形式）
- `[BP]` 参照型の例（規約）と task 型の例（手順＋ `disable-model-invocation: true`）：

  ```yaml
  ---
  name: deploy
  description: Deploy the application to production
  context: fork
  disable-model-invocation: true
  ---

  Deploy the application:
  1. Run the test suite
  2. Build the application
  3. Push to the deployment target
  ```

### agent の frontmatter と本文（B1, B2, B3, B4）

- `[HARD]` 「`name` と `description` だけが必須」。複数語のフィールドは camelCase（`maxTurns`、`disallowedTools`）で「表と正確に一致しなければならず、認識しないフィールドは報告なしに無視される」
- `[HARD]` **黙ってスキップされる条件**：`name` がない（ドキュメント扱い）、開始 `---` が先頭行でない（ドキュメント扱い）、`name` が `-` で始まる／`:` を含む、`name` はあるが `description` がない、YAML が壊れている。セッション内では報告されず `--debug` でだけ分かる。`claude plugin validate <dir>` で事前確認できる
- `[HARD]` 「frontmatter がメタデータと設定を定め、**本文が system prompt になる**。subagent は**この system prompt と作業ディレクトリ等の基本的な環境情報だけ**を受け取り、Claude Code の system prompt は受け取らない」
- `[HARD]` `tools` の項目がどれも実在しない場合、subagent は起動に失敗する。`disallowedTools` に `Bash(git push *)` のような指定子を書いても**ツール全体**が外れる
- `[BP]` description：「Claude は各 subagent の description を見て委譲を判断する。**いつ使うか分かる明確な description を書け**」。「積極的に委譲させたければ『use proactively』のような句を入れよ」。「description はコンテキストを消費する。**短く保ち、詳細は subagent が動くときだけ読み込まれる system prompt に移せ**」。全 subagent の description 合計が 15,000 トークンを超えると起動時に警告
- `[BP]` 公式の例はいずれも**役割宣言で始まり、出力の指示で終わる**：
  ```markdown
  ---
  name: code-reviewer
  description: Reviews code for quality and best practices
  tools: Read, Glob, Grep
  model: sonnet
  ---

  You are a code reviewer. When invoked, analyze the code and provide
  specific, actionable feedback on quality, security, and best practices.
  ```
  ```markdown
  You are a senior security engineer. Review code for:
  - Injection vulnerabilities (SQL, XSS, command injection)
  - ...
  Provide specific line references and suggested fixes.
  ```

### CLAUDE.md と rules（B1, B2, B5, B6）

- `[BP]` 「CLAUDE.md に必須の形式はないが、**短く、人が読める**ものに保て」。「**markdown の見出しと箇条書きで関連する指示をまとめよ**。Claude は読者と同じように構造を走査する。整理された節は密な段落より追いやすい」
- `[BP]` 具体性：「2 スペースインデントを使え」＞「コードを適切にフォーマットせよ」、「コミット前に `npm test` を実行せよ」＞「変更をテストせよ」
- `[BP]` 「1 ファイル 200 行以下を目標」（A2 でも扱う）
- `[HARD]` rule の frontmatter：`paths` だけが読まれる。「他のフィールドはエラーなしで無視される。frontmatter はコンテキストに入る前に取り除かれる。YAML が壊れていれば `paths` なしとして読み込む」
  ```markdown
  ---
  paths:
    - "src/api/**/*.ts"
  ---
  ```

### hooks（B7, B9）

- `[HARD]` 構造は 3 段：イベント名 → matcher グループの配列（各 `matcher`）→ `hooks` 配列（各ハンドラ：`type`、`command` 等）。一致したハンドラは**並列に**実行される
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh" } ] } ] } }
  ```
- `[HARD]` **exit code**：「ほとんどのイベントで、**exit code だけでブロックできるのは 2 だけ**。stdout に有効な JSON がなければ、Claude Code は exit 1 を非ブロッキングエラーとして扱い、操作を続行する。1 が Unix の慣習的な失敗コードであってもだ。**ポリシーを強制する hook なら `exit 2` を使え**」。exit 2 は stdout の JSON に関わらずブロックし、stderr がブロック理由になる
- `[HARD]` ブロックできるイベント：`PreToolUse`（ツール呼び出しを止める）、`UserPromptSubmit`、`Stop`（8 回連続ブロックで上書き終了）、`SubagentStop`、`PreCompact`、`ConfigChange` 等。**`PostToolUse` はブロックできない**（ツールは既に実行済み。「`PostToolUse` hook は操作を取り消せない」）。操作を防ぐ gate は `PreToolUse` でなければならない
- `[HARD]` `PreToolUse` の `permissionDecision: "deny"`（または exit 2）は「**どの permission mode でも、`bypassPermissions` や `--dangerously-skip-permissions` でも**」効く。逆に hook の `allow` は settings の deny を上書きできない（「hooks は制限を強められるが緩められない」）
- `[HARD]` matcher：`"*"`、`""`、省略は**すべてに一致**。英数字・`_`・`-`・空白・`,`・`|` だけなら完全一致（`|` か `,` で複数）、それ以外の文字があれば**アンカーなしの正規表現**。MCP ツールは `mcp__<server>__<tool>` で、`mcp__memory` 単独は完全一致扱いで**何にも一致しない**（`mcp__memory__.*` と書く）。matcher 非対応イベントに書いても黙って無視される
- `[HARD]` `if` フィールドの Bash 照合は「best-effort であり、**hard な allow / deny には permission system を使え**」
- `[HARD]` command の形：`args` があれば exec form（シェルなし、`PATH` 上の実行ファイル）、なければ shell form（`sh -c` / Git Bash / PowerShell）。Windows の exec form は `.exe` のみ（`.cmd` / `.bat` は不可）。`${CLAUDE_PROJECT_DIR}` 等は `command` / `args` 内で展開され、環境変数としても渡る
- `[HARD]` スクリプトが起動できない（パス違い、実行権限なし）場合は非ブロッキングエラーになり、**守られるはずの操作はそのまま進む**（exit 127 等）。「`chmod +x` を忘れるな」「絶対パスか `${CLAUDE_PROJECT_DIR}` を使え」
- `[HARD]` タイムアウト：`command` / `http` / `mcp_tool` は 600 秒（`UserPromptSubmit` は 30 秒）、`prompt` は 30 秒、`agent` は 60 秒。タイムアウトした hook は出力を捨てられ、**ブロックしない**（`PreModelSwitch` を除く）
- `[HARD]` 複数の `PreToolUse` が食い違えば `deny > defer > ask > allow`。一つの deny は他の hook の副作用を止めない
- `[HARD]` `PermissionRequest` の auto-approve で matcher を `.*` や空にすると「ファイル書き込みやシェルコマンドを含む**すべての許可プロンプトを自動承認する**」
- `[BP]` セキュリティ：「command hook はユーザーの全権限でシェルコマンドを実行する」。入力を検証する、シェル変数は必ず引用符で囲む、`..` のパストラバーサルを弾く、絶対パスを使う、`.env` / `.git/` / 鍵を触らない

### plugin（B8, B9）

- `[HARD]` `plugin.json` は `.claude-plugin/` にだけ置く。他の構成物（`skills/`、`agents/`、`hooks/`）はプラグインルート。`name` は必須で、空白・`@`・`:`・パス区切りを含まない kebab-case。認識しないトップレベルキーは削られて読み込まれる（`claude plugin validate` が警告）が、strict なオブジェクト内の未知キーは**エラー**
- `[HARD]` プラグインルートの `CLAUDE.md` は**コンテキストとして読み込まれない**（validate が警告）。コンテキストに入れたい指示は skill に置く
- `[HARD]` 構成物のパスは `./` で始まり、プラグインルート内に収まり、存在しなければならない

## 独自

### 「冒頭 3 行」の基準（B4）

- モデルは上から読む。frontmatter の description は選択時に見る唯一の情報で、本文の最初の数行はファイル全体の読み方を決める。冒頭が背景説明（「このプロジェクトでは〜という経緯で〜」）で始まると、モデルはそれを**参考資料**として扱い、指示として実行しない
- agent の本文は system prompt になる。公式の例が例外なく「You are a ...」で始まり「Provide ...」で終わるのは偶然ではない。**役割（誰として）→ ゴール（何を達成）→ 出力形式（何を返す）**が冒頭で分かる agent は、委譲メッセージが短くても動く
- skill / rule の冒頭は「何をするか」と「いつ参照するか」。description と本文冒頭が同じ内容の繰り返しでも構わない（description は一覧用、冒頭は読み始め用で、見られる場面が違う）
- CLAUDE.md の冒頭は「このリポジトリが何か」の一行。ロール一覧やパス構成はその後

判定は **frontmatter の description ＋ 本文の最初の 10 行だけ**を読んで行う。それ以降を読まないと分からないなら、それ自体が finding。

### 「何であるか」型 description の見分け方（B3）

- 名詞句で終わる（「〜の規約」「〜のワークフロー」「〜のガイド」）だけの description は、モデルにとって「いつ使うか」の手がかりがない。「〜するとき」「〜を依頼されたら」「〜の前に必ず」が入っているかを見る
- 良い例（公式）：「Summarizes uncommitted changes and flags anything risky. **Use when** the user asks what changed, wants a commit message, or asks to review their diff.」
- agent の description が長すぎる（本文を要約している）のも finding。description は「いつ委譲するか」だけ、やり方は本文へ

### 名前の整合（B8）

- skill の frontmatter `name` はプロジェクト skill では呼び出し名を決めない（ディレクトリ名が決める）ので、不一致でも動く。しかし人間が `name` を見て `/name` と打つと動かず、混乱の元になる。agent も同様に `name` と ファイル名が違うと、`refs` や `skills:` の参照で食い違いが起きる
- 機械的に判定できる（discover の `name_mismatch`）ので、一致させる提案を出す

## 判定の手引き

### evidence の探し方

まず discover の事実（`harness.json` の `files[]`）を機械的に見る。ここは Read 不要：

| check | discover のフィールド |
|---|---|
| B1 | `frontmatter_error`、agent の `loadable` / `not_loadable_reason`、skill の `description_source === "first-line-fallback"` |
| B2 | `frontmatter_unknown_keys`、rule / command の `frontmatter_ignored_keys` |
| B3 | `frontmatter_stats.description_chars`（＋ `when_to_use_chars`）、`frontmatter.description` の文面 |
| B5 | `size.lines`（skill 500 行、CLAUDE.md 200 行）、`support_files` と本文からの参照の有無（`refs.harness_files`） |
| B6 | `headings` の数と `size.lines` の比 |
| B7 | `hooks[]` の `script.exists` / `outside_target`、`type`、`matcher`、`event`、`hook-script` の `exit_codes_used`、`referenced` |
| B8 | `name_mismatch` |
| B9 | `settings` / `mcp-config` / `hooks-config` / `plugin-manifest` の `parse_error` |
| B10 | skill の `frontmatter["allowed-tools"]` |

次に、B3 / B4 / B5 のために各ファイルの**冒頭だけ**を Read する（frontmatter ＋ 本文 10 行）。全文を読まない。B5 の「物語になっていないか」は、`content_mix` と `instruction_lines` の比率、および冒頭の文体で判断する。

B7 は hook スクリプトを Read する。見るのは：どの条件で `exit 2` するか、`exit 1` で終わっている分岐がないか、matcher と `if` が意図する操作を捉えているか（例：`Bash` matcher で `git push` を止めたいなら、スクリプト内で `tool_input.command` を見ているか）。

### proposal の粒度

- B1：足す frontmatter の行、または直した YAML をそのまま書く
- B2：外すキー。rule の `description` のように「効かないが害もない」ものは、「無視されている」事実を伝えたうえで削除 or `paths` への置き換えを提案
- B3：**書き換え後の description をそのまま書く**。「いつ使うか」を先頭に、トリガー句を 2〜3 個
- B4：**書き換え後の冒頭 3 行をそのまま書く**
- B5：500 行超の skill は、どの節を同梱ファイルに移し、本文にどの参照文を残すか
- B7：直した hook の JSON（event / matcher / command）と、スクリプトの直す行（`exit 1` → `exit 2` 等）
- B8：一致させる側と値
- B9：直した JSON

### よくある誤判定

- rule の `description` キーは無視されるだけで、rule 自体は読み込まれる。must にしない
- agent の `name` とファイル名の不一致は、動作上は問題ない。nice to have 止まり
- skill の description が長い（1,536 文字未満）こと自体は finding ではない。「いつ使うか」が先頭にあるかで判断する
- `PostToolUse` で lint やフォーマットを**実行する**のは正しい使い方（結果を Claude に見せる）。finding になるのは `PostToolUse` で操作を**防ごう**としている場合だけ
- hook の command が `bash script.sh` のように相対パスでも、`${CLAUDE_PROJECT_DIR}` から解決されて存在すれば pass。finding は存在しない / 対象外 / 実行権限なし
- このツール自身をレビューするとき：`.claude/agents/` の 4 ファイルが B1 を満たし、references を Read する指示が冒頭にあるかを確認する
