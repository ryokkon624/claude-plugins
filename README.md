# harness-review

指定したディレクトリの Claude Code ハーネス（CLAUDE.md、rules、skills、agents、hooks、settings、MCP、memory）を読み取り、**① ハーネス抽出 → ② フロー抽出 → ③ レビュー** を行って、単一の HTML レポートを出力するスキル。

> 状態: 設計完了、実装前。設計判断は [docs/adr/](docs/adr/README.md) を参照。

## 使い方

```
cd C:\work\claude\claude-plugins
claude
> /harness-review C:\path\to\target-project
```

- 対象はパスで指定する。このリポジトリ自身を対象にすることもできる。
- 出力は `output/harness-review/<対象dirname>/<YYYY-MM-DD-HHMM>/report.html`。最新は `output/harness-review/<対象dirname>/latest.html`。
- オプション（予定）: `--from <stage>`（途中のステージから再実行）、`--skip-verify`（③の敵対的検証を省く安価な実行）。

前提: Node 24 以上。npm 依存はない。

## 何を出すか

### ① ハーネス抽出（事実）

- 種別ごとの件数と、各ファイルの frontmatter・見出し構造・行数・要約
- 各ファイルの **ロードタイミング**（always / path-scoped / on-demand / invoked / spawned / triggered / external）と常駐分の概算トークン
- 独自 memory の有無。あるなら「何を・いつ・どこに書き、誰が・いつ読むか」

### ② フロー抽出（事実）

- フロー数と kind 別の内訳（single / orchestrated / workflow / team / hook-chain / implicit）
- 各フローの入口、オーケストレータ、step、spawn のタイミング、subagent / teammate、成果物
- レビューに相当する step と、AI が裁量で判断する箇所（あるかないかの事実）
- フロー間グラフと、各フローの sequence 図

### ③ レビュー（判断）

5 つの軸で finding を出す。各 finding は **根拠 → 指摘 → 改善案** の 3 点セット。

| 軸 | 見るもの |
|---|---|
| A 適材適所 | 常駐すべきでない内容が CLAUDE.md にある、散文でしか書かれていない禁止事項（hook にすべき）、重複、矛盾、旧配置 |
| B フォーマット | frontmatter の必須項目、description がトリガー句になっているか、冒頭で役割・ゴール・出力形式が分かるか |
| C レビュー行為 | goal が明確な作業には検査が、正解のない作業には別コンテキストの敵対的検証があるか。不合格時の経路があるか |
| D ADR | 決定記録の有無、フローへの組み込み、形式 |
| E 自己判断の記録 | AI が良かれと思って勝手に対応したことを記録し、人間が検知できる仕組みがあるか |

- severity: must / should / nice to have
- basis: official（公式ドキュメントに根拠あり）/ custom（このリポジトリ独自の基準）
- すべての finding は別コンテキストの検証エージェントが反証を試み、CONFIRMED / PLAUSIBLE のみを表示する。REJECTED は検証ログに残す
- finding とは別に、対象 × 軸のチェックマトリクス（finding / pass / n.a.）を出す

## レポートの構成

1. ヘッダ: 対象、実行日時、件数サマリ、前回との差分（解消 / 新規 / 継続）
2. Findings と改善案（③）: severity 順、軸でフィルタ
3. ハーネス（①）
4. フロー（②）
5. チェックマトリクス
6. 検証ログ

## 仕組み

```
S0 discover   script          → work/discover.json
S1 extract ①  LLM × N         → harness.json（＋網羅性検証）
S2 extract ②  LLM × N         → flows.json（＋網羅性検証）
S3 review ③   LLM × 5（軸ごと）→ work/review/{A..E}.json
S4 verify ③   LLM × N         → findings.json / verification.json
S5 render     script          → report.html / latest.html
```

- 決定的にできる処理（発見、パース、grep、マージ、網羅性検証、HTML 生成）はスクリプト、意味の理解が要る処理（要約、フロー抽出、レビュー、反証）は LLM が担当する
- subagent は結果を `work/` に書き、オーケストレータにはデータを返さない
- HTML は人間用。機械は JSON を使う

## 書き込み gate（hooks）

`.claude/settings.json` の PreToolUse hook が、レビュー対象（このリポジトリの外）への Write / Edit / Bash 書き込みと、`main` への直接 push を機械的にブロックする（ADR-0014）。許可されるのは このリポジトリ、`~/.claude/projects/`（auto memory）、scratchpad と一時ディレクトリだけ。guard 自身（`.claude/settings.json`、`.claude/hooks/`）も保護されているので、変更するときは `CLAUDE_PLUGINS_GUARD_OFF=1` を付けて Claude を起動する。テストは `node .claude/hooks/guard.test.mjs`。

## 基準のカスタマイズ

判断基準は `.claude/skills/harness-review/references/<axis>.md` にある。各文書は「公式（出典 URL・取得日つき）」と「独自」の 2 節から成る。基準を変えたいときはこの文書を編集する。

## 設計判断

[docs/adr/](docs/adr/README.md) に 1 決定 1 ファイルで記録している。
