# harness-review

Claude Code ハーネスをレビューする skill `/harness-review` の開発リポジトリ。概要と使い方は README.md。

## 設計判断

- 設計判断は docs/adr/ に ADR として記録している。設計に関わる変更をする前に該当 ADR を読むこと。
- 決定を変えるときは既存 ADR を書き換えず、新 ADR を追加して旧 ADR を Superseded にする。
- 判断基準の正は .claude/skills/harness-review/references/ 。公式節を更新したら取得日も更新する。

## 実装の制約

- スクリプトは Node 24 の ESM（.mjs）、npm 依存なし。package.json は置かない。
- subagent は結果を work/ に書き、オーケストレータにデータを返さない（ADR-0009）。
- output/ は生成物。手で編集しない。

## テスト対象

- C:\work\java-migration\migration-agent-base を読み取り専用のテスト対象として使う。変更しない。
- このリポジトリ自身も対象にできる（自己レビュー）。

## 作業の報告

- 依頼されていない判断で対応したことがあれば、報告に「自己判断」として明記する。
