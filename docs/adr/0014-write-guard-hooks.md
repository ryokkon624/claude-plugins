# ADR-0014: プロジェクト外への書き込みと main への直接 push を PreToolUse hook で機械的に止める

- Status: Accepted
- Date: 2026-09-30

## Context

- 自己レビュー（run 2026-09-26-0915）の指摘 A4-ba090b / E4-9369a8：「レビュー対象ディレクトリを変更しない」「出力ファイル以外に Write しない」という約束が CLAUDE.md・SKILL.md・4 つの agent 定義の計 6 か所に散文で書かれているだけで、hooks も permissions も無い。パイプラインの subagent 4 つはすべて Write を持ち、他人のリポジトリに向けて起動される。メインセッションは Bash も持つ。
- 公式ドキュメント（references/A-placement.md 公式節）：「Claude の判断に関わらず操作をブロックしたいなら PreToolUse hook を使え」「例外なく毎回起きるべき操作には hooks を使え」。exit 2 だけがブロックし、exit 1 は素通りする。スクリプトが起動できない場合は非ブロッキングエラーになり、守られるはずの操作はそのまま進む（references/B-format.md、fail-open）。
- 公式 hooks リファレンス（https://code.claude.com/docs/en/hooks 、取得日 2026-09-25）：hook 入力の共通フィールドに `cwd` と `scratchpad_dir`（v2.1.257+）がある。PreToolUse はあらゆる permission mode で、subagent のツール呼び出しにも発火する。hook プロセスの環境変数は Claude Code 起動時の環境を継承する。
- `.claude/rules/git.md` の禁止事項「`main` への直接 push」も散文のみ。migration-agent-base の自己レビューで同じ構造を must（A4-9e6526）と指摘した。
- `permissions.deny` は具体的なパスパターンしか書けず、「プロジェクトの外」という相対的な条件を表現できない。`Bash(git push*)` を deny すると作業ブランチへの push も止まる。

## Decision

- `.claude/settings.json` に PreToolUse hook を 2 つ、SessionStart hook を 1 つ置く。スクリプトは `.claude/hooks/` に Node（依存なし、ADR-0012）で書き、共通処理は `guard-common.mjs` に置く。
  1. **guard-writes.mjs**（matcher `Write|Edit|MultiEdit|NotebookEdit`）：`tool_input.file_path` / `notebook_path` を解決し、次のいずれかの配下でなければ **exit 2** でブロックする。
     - `CLAUDE_PROJECT_DIR`（このリポジトリ。`output/` もここに含まれる）
     - `~/.claude/projects/`（auto memory の置き場。`~/.claude/settings.json` やユーザー CLAUDE.md は含めない）
     - hook 入力の `scratchpad_dir`、OS の一時ディレクトリ（`os.tmpdir()`、`TEMP`、`TMP`、`/tmp`）
     - `cwd` は許可対象に**含めない**（レビュー対象に `cd` していても書けないようにする）
  2. **guard-bash.mjs**（matcher `Bash`）：
     - `git push` を含む区間で、明示された ref が `main` / `master`（`HEAD:main`、`refs/heads/main`、`:main` を含む）、`HEAD` を現在ブランチに解決した結果が `main` / `master`、ref の指定がなく `cwd` の現在ブランチが `main` / `master`、または `--delete` の対象が `main` / `master` なら **exit 2**。作業ブランチへの push と削除は通す。
     - 書き込み系のトークン（`>`、`>>`、`sed -i`、`cp`、`mv`、`rm`、`tee`、`touch`、`mkdir`、`git -C`、`git commit / checkout / reset …`、`node -e`、`python -c`、PowerShell の `Copy-Item` / `Set-Content` / `Add-Content` / `Out-File` / `New-Item` / `Remove-Item` / `Move-Item` / `-OutFile` 等）を含むコマンドで、`cwd` が許可ルートの外にある、または区間内に許可ルート外のパス（絶対・`~/`・相対）があれば **exit 2**。読むだけのコマンド（`cat`、`grep`、`ls`、`Get-Content`）はパスが外でも通す。`/dev/null` と URL はパスとみなさない。クォートされた文字列は、パスらしく始まるもの（ドライブ・`/`・`~/`・`./`）は空白を含んでいても 1 つのパスとして扱い、それ以外で空白を含むもの（コミットメッセージ等）は判定前に除去する。
  3. **guard の自己防衛**：`.claude/settings.json`、`.claude/settings.local.json`、`.claude/hooks/` 配下への Write / Edit / Bash 書き込みはブロックする（`cd .claude/hooks && sed -i … guard-bash.mjs` のように `cd` した先からの書き込みも、区間ごとに `cd` を追跡して止める）。guard 自身を変更するときは、環境変数 `CLAUDE_PLUGINS_GUARD_EDIT=1` を付けて Claude を起動したセッションで行うか、人間が直接編集する。`GUARD_EDIT` は自己防衛だけを外し、プロジェクト外への書き込みと main への push は止めたままにする。`CLAUDE_PLUGINS_GUARD_OFF=1` は両 guard を丸ごと止める緊急用で、通常は使わない。hook はツール呼び出し時の環境ではなく Claude Code 起動時の環境を見るので、コマンドに環境変数を付けても効かない（意図どおり）。
  4. **SessionStart**（matcher `startup`）で `guard.test.mjs --quiet` を実行する。全件 PASS なら何も出さず、失敗があれば警告 1 行を stdout に出して **exit 0** で終わる（SessionStart の stdout は exit 0 のときだけコンテキストに入る）。検知できるのは「node は動くが guard の論理が壊れている」場合だけで、node 不在や settings.json の破損は検知できない。`resume` / `clear` では走らない。
- どちらの PreToolUse もブロック時は理由と許可される場所を stderr に出す（exit 2 の stderr は Claude に返る）。ブロックしないときは exit 0。exit 1 は使わない。スクリプト内部の例外、hook 入力が JSON として読めない場合、Write / Edit の入力にパスが無い場合はいずれも **fail-closed**（exit 2）にする。残る fail-open は node 不在・スクリプト不在・settings.json 破損だけ（hook が起動しないケース）。
- `.claude/rules/git.md` の「`output/` の手編集禁止」はこの hook の対象外とする。`output/` はパイプラインの subagent が Write で正当に書く場所で、hook からは「手編集」と「パイプラインの書き込み」を区別できない。`permissions.deny` で `output/` を止めるとパイプラインが動かなくなる。
- コマンドの解析はクォート内の空白を含む文字列（コミットメッセージ等）を無視し、改行もコマンド区切りとして扱う。`>` はスペースの有無にかかわらず書き込みとみなす（`2>&1` を除く）。
- テストは `.claude/hooks/guard.test.mjs`（stdin JSON を流して exit code を検証）に置き、hook を変更したら実行する（`.claude/rules/git.md`）。
- `permissions.deny` による二重化はしない。理由は Context のとおり「プロジェクト外」を表現できず、push の deny は作業ブランチも止めるため。既知のテスト対象（migration-agent-base）に限った deny は将来足せるが、Windows での絶対パス指定の書式を確認できていないので今回は見送る。
- この ADR が満たすのは **A4**（散文だけの禁止事項を機械的に強制する）と、E4 のうち「プロジェクト外への変更」の部分である。E4 の本来の対象である**依頼範囲外のプロジェクト内変更**（依頼されていないファイルの変更）は、この hook では検知も阻止もされず、未充足のまま残る。

## Consequences

- (+) レビュー対象への書き込み（Write / Edit / Bash）と main への直接 push が、subagent を含めて機械的に止まる。散文の約束が「破れない」約束になる。
- (+) このリポジトリ自身が、A4 の基準を満たす見本になる。
- (−) このリポジトリで Claude を起動して他のリポジトリを編集する作業はできなくなる（意図どおり）。必要なら別ディレクトリで起動するか、`CLAUDE_PLUGINS_GUARD_OFF=1` を付けて起動する。
- (−) guard 自身の変更に、環境変数付きの再起動か人手が要る。開発中に不便だが、それが自己防衛の目的でもある。
- (−) Bash の解析は best-effort で、`bash -c "..."` 内や変数展開されたパス、`git -C` 以外の方法で他リポジトリを操作するコマンドはすり抜けうる。書き込み系トークンの誤検出で、外部パスを引数に取る読み取り専用コマンドがブロックされることもある（`rm` や `cp` を含むコマンドで外部パスを渡す場合など）。セキュリティ境界ではなく、うっかりを止める gate と位置づける。
- (−) fail-open は hook の仕組み上なくせない（node 不在・スクリプト不在・settings.json 破損）。SessionStart の自己テストは「気づける」ようにするだけで、起動後に壊れた場合は次の起動まで分からない。自己テストは起動ごとに 60 前後のプロセスを起動するので、起動が 1〜2 秒遅くなる。
- (−) 自己防衛も best-effort。`bash -c "…"` の内側や変数展開されたパス、パスらしく始まらないクォート文字列に埋め込まれたパス（`"see C:/x/y.md"` 等）は追えない。書き込み系トークンは POSIX と主要な PowerShell cmdlet を対象にしており、それ以外のシェル（cmd.exe の `copy` / `type >` 等）は見ていない。guard を直すには `GUARD_EDIT` 付きの再起動か人手が要り、開発中は不便（実装中に自分の Write が止まり、scratchpad に書いて人間に `!` でコピーしてもらう運用になった）。
- (−) 対話セッションでは workspace trust を受け入れるまで project の hooks は動かない。`-p` 実行では動く。
- (−) E4（依頼範囲外のプロジェクト内変更の検知）は未充足のまま残る。別の ADR で扱う。

## 検証

### 1 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [結果] 「E4 は事前ブロックで満たす」は過大。E4 の基準は依頼範囲外の変更の検知で、プロジェクト外だけではない。プロジェクト内の範囲外変更は検知も阻止もされない。
2. [結果] Bash 経路が丸ごと素通り。guard-writes の matcher に Bash がなく、guard-git は `git push` しか見ない。`sed -i`、`>`、`cp`、`git -C <対象> commit` は全部通る。
3. [結果] fail-open が Consequences にない。node 不在や構文エラーで警告なく全許可に戻る。settings.json と hooks/*.mjs 自体が許可ルート配下で、guard を Write で書き換えて無効化できる。
4. [導出] `git push origin HEAD` を main 上で実行すると通る。positional ref が 1 つある時点で現在ブランチ判定に入らない。
5. [導出] `permissions.deny` を検討した記録がない。
6. [結果] 許可ルートが `~/.claude/` 全体で広すぎる。目的は auto memory なのに `~/.claude/settings.json` やユーザー CLAUDE.md まで無審査で書ける。
7. [事実] 「hook 入力の `scratchpad_dir`」の根拠がリポジトリ内で確認できない。

#### 対応

1. Decision 末尾に「満たすのは A4 と、E4 のうちプロジェクト外の部分。依頼範囲外のプロジェクト内変更は未充足」と明記し、Consequences にも残した。
2. guard-git.mjs を **guard-bash.mjs** に置き換え、書き込み系トークン × 許可ルート外パス、および cwd が許可ルート外での書き込みをブロックするようにした。テスト 20 ケース追加。
3. Consequences に fail-open を明記。SessionStart の自己テスト hook を追加。`.claude/settings.json` と `.claude/hooks/` への書き込みを guard 自身がブロックする（自己防衛）ようにし、変更は環境変数付き起動か人手に限定した。実装中にこの自己防衛が自分自身の Write を止め、Bash 側 hook が壊れている間だけ書き込めるという fail-open をその場で観測したので、Consequences に書いた。
4. `HEAD` を現在ブランチに解決してから判定するようにした。テスト追加。
5. Context と Decision に `permissions.deny` を使わない理由を書いた。
6. 許可ルートを `~/.claude/projects/` に絞った。テストで `~/.claude/settings.json` がブロックされることを確認。
7. Context に公式 hooks リファレンスの URL と取得日、`scratchpad_dir` が共通入力フィールド（v2.1.257+）であることを書いた。

1〜6 で Decision を変えたので 2 回目の検証にかけた。

### 2 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [事実] 自己テストは失敗時に警告を stdout に出して exit 1 で終わる。SessionStart の stdout がコンテキストに入るのは exit 0 のときだけなので、警告は届かない。「exit 1 は使わない」とも矛盾。
2. [導出] 自己テストは node 不在を検知できず、matcher が `startup` のみなので resume / clear では走らない。カバー範囲を正確に書くべき。
3. [結果] `CLAUDE_PLUGINS_GUARD_OFF=1` は両 guard を丸ごと無効化する。guard を直すセッションでは対象への書き込みと main への push も素通りする。自己防衛だけ外す狭い逃げ道が導ける。
4. [結果] `cd .claude/hooks && sed -i … guard-bash.mjs` が通る。hook は `cd` 後の cwd を追っていない。自己防衛も best-effort と明記が要る。
5. [結果] `.claude/settings.local.json` が保護対象外。local 側の `disableAllHooks` で全 hook が止まる。
6. [結果] SessionStart ごとに 41 プロセスを起動するレイテンシが Consequences にない。

同時に `/code-review` が実装に対して 8 件を指摘した：改行が区切りとして扱われず複数行コマンドの push が素通り／クォート非対応でコミットメッセージ中の「git push origin main」や対象パスがブロックされる／`>` がスペースなしだと見逃す／例外が exit 1 で素通り／main モジュール判定が `#` `%` 短縮パスで壊れて全許可／ブロック時のメッセージが「output/ に書け」と案内し CLAUDE.md と矛盾／git.md の例 `ADR-0014` が実在の ADR と衝突／（自己テストの exit 1 は上記 1 と同じ）。

#### 対応

1. `--quiet` は警告を stdout に出して exit 0 で終わるようにした。Decision 4 を書き直した。
2. Decision 4 に「検知できるのは node が動く前提で論理の破損だけ。resume / clear では走らない」を明記した。
3. `CLAUDE_PLUGINS_GUARD_EDIT=1`（自己防衛だけ外す）を追加し、`GUARD_OFF` は緊急用とした。テストで GUARD_EDIT 下でも対象への書き込みと main への push が止まることを確認。
4. 区間ごとに `cd` を追跡して実効 cwd で判定するようにし、`.claude` / `.claude/hooks` の中からの書き込みも止める。Consequences に自己防衛の best-effort を明記。
5. `settings.local.json` を保護対象に追加。
6. Consequences に起動レイテンシを追記。

コードレビュー分：改行を区切りに追加／クォート内の空白を含む文字列を判定前に除去／`>` の検出をスペース非依存に／内部例外を fail-closed（exit 2）に／main モジュール判定を撤去して常に本体を実行／メッセージを「scratchpad か一時ディレクトリに」に修正／git.md の例を `ADR-0099` に変更。テストは 63 ケース。

2 往復で決着しなかったため、規則どおりユーザーに判断を仰いだ。ユーザーの決定：**3 回目を回す**（この ADR は他の約束を守らせる層で、2 回とも実害のある指摘が出たため）。

### 3 回目

- Date: 2026-09-30
- Verifier: adr-verifier
- Verdict: PLAUSIBLE

#### 指摘

1. [事実] 「残る fail-open は node 不在・スクリプト不在・settings.json 破損だけ」が誤り。stdin が JSON として読めないとき、`file_path` が無いときは allow で通している（仕様として固定）。
2. [導出] `git push --delete origin main` が通る。禁止事項の目的は main の保護なので、削除を許すのは同じ Context から導けない。
3. [結果] 空白を含むクォート済みパス（`"C:/work/java migration/x.md"`、`cd "C:/other dir"`）が系統的に素通りする。
4. [結果] PowerShell の書き込み cmdlet（`Copy-Item` / `Set-Content` / `Out-File` …）が対象外。テストも sh 構文のみ。
5. [結果] `output/` の手編集禁止は未強制で、ADR は output/ を許可ルートに含めている。対象外なら明記が要る。

既存 ADR との矛盾は無し。

#### 対応

1. 入力が JSON として読めない場合とパスが無い場合を fail-closed（exit 2）に変えた。Decision の列挙を「hook が起動しないケースだけが fail-open」に直した。
2. `--delete` でも対象が `main` / `master` なら止めるようにした（`:main` の空 refspec も）。
3. パスらしく始まるクォート文字列は空白を含んでいても 1 トークンとして扱うようにした。それ以外の空白入りクォート（メッセージ）は従来どおり除去。Consequences に「パスらしく始まらないクォート内のパスは追えない」を追記。
4. PowerShell の主要 cmdlet と `-OutFile`、`Set-Location` / `pushd` を追加し、テストを足した。
5. Decision に「`output/` の手編集禁止は対象外。パイプラインの subagent が正当に書く場所で、hook からは区別できない」を明記した。

テストは 72 ケース。1・2・5 で Decision を変えたが、往復上限（ユーザー判断で 3 回）に達したため、この時点で確定するかをユーザーに問うた。ユーザーの決定：**反映して確定**（指摘が回を追って周辺の穴埋めになり、既存 ADR との矛盾も無いため）。

### 確定後の /code-review low（実装のみ、Decision は不変）

3 件：(1) Git Bash 形式のパス（`/c/work/...`）を Windows ルート（`C:\c\work\...`）として解決していた。(2) README の逃げ道の説明が `GUARD_OFF` になっていた（正しくは `GUARD_EDIT`）。(3) 書き込みを伴わない `cd <外>` の区間でもパス検査していた。

(1) の調査で分かったこと：Bash 用 hook のプロセスには `CLAUDE_PROJECT_DIR` が Git Bash 形式（`/c/work/claude/claude-plugins`）で渡り、Write 用 hook のプロセスには Windows 形式で渡る。両者が同じ誤った解決結果（`C:\c\work\...`）に揃っていたため、`cd /c/work/claude/claude-plugins && git add …` は「一致」して通り、`cd /c/work && touch …` は止まる、という状態だった。テストは Windows 形式の環境変数しか流していなかったので検知できなかった。対応：`fromPosixDrive()` で環境変数・`cwd`・トークンのいずれも Windows 形式に正規化し、Git Bash 形式の `CLAUDE_PROJECT_DIR` / `cwd` を流すテストを 8 件追加（計 83 ケース）。(2) README を修正。(3) 書き込みを伴わない区間はパス検査しない（実効 cwd の更新だけ）。
