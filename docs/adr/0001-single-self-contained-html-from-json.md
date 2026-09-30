# ADR-0001: レビュー結果は単一の自己完結 HTML で出力し、中間 JSON からスクリプトで生成する

- Status: Accepted
- Date: 2026-09-24

## Context

- レビュー結果を読むのは人間であり、ローカルでそのまま開けるファイルが望ましい。
- LLM に HTML を直接書かせると、実行ごとに構造や見た目がブレる。
- 検証エージェントや前回との差分計算が HTML を解析するのは不向きで、構造化データが必要。
- フロー図（sequence 図）を描く必要がある。

## Decision

- 最終成果物は `report.html` の 1 ファイルとする。外部 CDN に依存せず、CSS / JS はインライン、mermaid は `vendor/mermaid.min.js` を同梱する（約 3MB）。
- `report.html` は `harness.json`（①）、`flows.json`（②）、`findings.json`（③）、`verification.json`（検証ログ）からレンダリングスクリプトが機械的に生成する。LLM は HTML を書かない。
- HTML は人間専用。機械（検証エージェント、差分計算、再レンダリング）は JSON を使う。
- フロー図は mermaid のソースを `flows.json` に持ち、HTML 側で描画する。

## Consequences

- (+) 見た目と構造が毎回安定する。JSON が残るので再レンダリングや差分計算ができる。
- (+) 検証エージェントは HTML を読まずに済む。
- (−) レンダリングスクリプトの保守が必要。
- (−) mermaid 同梱により HTML が 3MB 弱になる。履歴（ADR-0002）に溜まるが許容する。
