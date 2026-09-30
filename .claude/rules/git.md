# Git 規約

このリポジトリで commit / branch / merge をするときは必ずこの規約に従うこと。Issues は使わない。参照には自己レビューの finding ID と ADR 番号を使う。

## ブランチ命名

```
{種別}/{参照}-{短い説明}      参照がある場合
{種別}/{短い説明}             参照がない場合
```

| 種別 | 用途 | 例 |
|---|---|---|
| `feature/` | 機能の追加・大きめの改修 | `feature/ADR-0099-judgment-notes` |
| `fix/` | 不具合・指摘への対応 | `fix/A4-write-guard-hook` |
| `refactor/` | 挙動を変えないコード改善 | `refactor/run-mjs-split` |
| `docs/` | 文書のみの変更 | `docs/git-rules` |
| `chore/` | スクリプト・設定・生成物の整備 | `chore/C7-merge-s3-validation` |

- 参照は finding ID（`A4-ba090b` → ブランチ名では `A4` だけでよい）、ADR 番号（`ADR-0013`）、Issue 番号（使うようになったら `123`）
- 短い説明は英小文字をハイフンつなぎ
- `main` から切る。作業が終わったら削除する

## コミットメッセージ

```
{prefix}: {説明} ({参照})
```

| prefix | 用途 |
|---|---|
| `feat:` | 機能の追加 |
| `fix:` | 不具合・指摘への対応 |
| `docs:` | 文書のみの変更（ADR、README、references、rules） |
| `style:` | フォーマットのみの変更 |
| `refactor:` | 機能追加でも修正でもないコード改善 |
| `test:` | テストの追加・修正 |
| `chore:` | スクリプト・設定・vendor・生成物の整備 |

- 参照は finding ID の完全形（`A4-ba090b`）、ADR 番号（`ADR-0013`）、Issue 番号（`#123`）。複数はカンマ区切り。該当がなければ省略する
- 説明は日本語でよい。何をしたかを 1 行で

```
fix: プロジェクト外への Write / Edit をブロックする hook を追加 (A4-ba090b, ADR-0013)
docs: CLAUDE.md の決定行に ADR 参照を付ける (D6-845745)
chore: merge S3 に S3 出力の妥当性検査を追加 (C7-0f054e)
refactor: render.mjs のセクション生成を関数に分割
```

## コミット前の必須作業

- 変更した `.mjs` は `node --check <file>` で構文を確認する
- `.claude/hooks/` を変更したら `node .claude/hooks/guard.test.mjs` を実行して全件 PASS を確認する
- `references/` の公式節を変更したら、その文書の取得日を更新する
- 設計判断を伴う変更は、コードより先に `docs/adr/` に ADR を追加する（CLAUDE.md）

## マージ

- `main` への取り込みは **PR 経由**。1 人でも PR を作る
- コード変更（`.mjs`、agent 定義、SKILL.md）を含む PR は、マージ前に `/code-review` を通す
- マージはマージコミット（squash しない）。finding ID 付きのコミットを履歴に残すため
- マージ後、作業ブランチは削除する

## 禁止事項

- `main` への直接 push
- `main` への force push
- `output/` の手編集とコミット
