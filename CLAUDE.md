# harness-review

Claude Code ハーネスをレビューする skill `/harness-review` の開発リポジトリ。概要と使い方は README.md。

## 設計判断

- 設計判断は docs/adr/ に ADR として記録している。設計に関わる変更をする前に該当 ADR を読むこと。
- 新しい設計判断をしたら、実装より先に ADR を追加する。既存 ADR に載っていない論点で決めたことは、決めた時点で ADR にする。
- 新しい ADR は Status: Proposed で書き、`adr-verifier` agent に反証させて末尾に「検証」節を付けてから Accepted にする。Decision を変える対応をしたら再検証する（ADR-0013）。
- 決定を変えるときは既存 ADR を書き換えず、新 ADR を追加して旧 ADR を Superseded にする。
- 判断基準の正は .claude/skills/harness-review/references/ 。公式節を更新したら取得日も更新する（ADR-0007）。

## 実装の制約

- スクリプトは Node 24 の ESM（.mjs）、npm 依存なし。package.json は置かない（ADR-0012）。
- パイプライン（S1〜S4）の subagent は結果を work/ に書き、オーケストレータにデータを返さない（ADR-0009）。
- output/ は生成物。手で編集しない（ADR-0002）。

## テスト対象

- C:\work\java-migration\migration-agent-base を読み取り専用のテスト対象として使う。変更しない。
- このリポジトリ自身も対象にできる（自己レビュー）。

## 作業の報告

- 依頼されていない判断で対応したことがあれば、報告に「自己判断」として明記する。無ければ「自己判断: なし」と書く。
