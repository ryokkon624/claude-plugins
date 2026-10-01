# references — ③レビューの判断基準

harness-reviewer は軸ごとにこのディレクトリの文書 1 つを読み、そこに定義された check に照らして finding / pass / n.a. を出す。基準を変えたいときはこの文書を編集する（ADR-0007）。

| 軸 | 文書 | 何を見るか |
|---|---|---|
| A | [A-placement.md](A-placement.md) | 適材適所：内容がロードタイミングに合った場所にあるか |
| B | [B-format.md](B-format.md) | フォーマット：frontmatter と冒頭が役割を果たしているか |
| C | [C-review.md](C-review.md) | レビュー行為：各作業に見合った検査・検証があるか |
| D | [D-adr.md](D-adr.md) | ADR：決定が経緯とともに記録され、読まれているか |
| E | [E-judgment-log.md](E-judgment-log.md) | 自己判断の記録：AI の勝手な判断が記録され検知できるか |

## 文書の構造

各文書は次の節で構成する。

1. **この軸で見ること** — 1 段落
2. **check 一覧** — `ID | チェック | severity 目安 | basis | 対象`。reviewer はこの ID で finding / pass / n.a. を出す。`対象` は check が当てはまる対象種別（`file`、`file:<kind>`、`hook`、`memory`、`mcp`、`flow`、`harness`。複数は ` / ` 区切り）で、マトリクスの母集団と穴埋めパスの対象になる（ADR-0016）
3. **公式** — 出典 URL・取得日・要点の言い換え。`[HARD]`（仕組みとして強制される・上限がある）と `[BP]`（推奨）を区別する
4. **独自** — この リポジトリの経験則。**理由を必ず書く**
5. **判定の手引き** — reviewer が evidence を探す場所、proposal に書くべき粒度、よくある誤判定

## basis の付け方

- check の basis が `official` なら、公式節のどの記述に基づくかを finding の evidence か claim で示せること
- `custom` は独自節に理由があること。公式と矛盾する独自基準は置かない（公式が沈黙している領域だけを埋める）

## severity の目安

| severity | 意味 |
|---|---|
| must | 誤動作・損失を招く。直さないと危ない |
| should | 品質・信頼性が落ちる。直すべき |
| nice to have | 衛生・読みやすさ。余裕があれば |

check 一覧の severity は「目安」。個別の finding で上下させてよいが、その理由を claim に書く。

## 公式節の更新

公式ドキュメントは変わる。更新するときは該当ページを読み直し、取得日を更新し、変わった点を ADR かコミットメッセージに残す。
