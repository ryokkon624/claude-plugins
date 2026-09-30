# ADR-0012: スクリプトは Node（npm 依存なし）で書く

- Status: Accepted
- Date: 2026-09-24

## Context

- 決定的な処理（ファイル発見、frontmatter パース、hooks / settings のパース、手がかり grep、マージ、網羅性検証、HTML 生成）はスクリプトで行う（ADR-0005、ADR-0009）。
- 環境には Node 24 と Python 3.12 がある。
- mermaid の同梱と HTML 生成を同じ言語で済ませたい。環境構築なしで動いてほしい。

## Decision

- スクリプトは Node 24 の ESM（`.mjs`）で書き、npm 依存を持たない。`package.json` も置かない。
- `vendor/mermaid.min.js` のみ同梱する。
- Python は使わない。

## Consequences

- (+) `npm install` 不要で動く。
- (−) YAML frontmatter のパースを自前で書く。frontmatter で使われるのはスカラー、リスト、1 段のマップ程度なので、限定的なサブセット実装で足りる。
