# ADR-0008: フローは「入口があるものすべて」と定義し、散文の手順（implicit）も含めて kind で分類する

- Status: Accepted
- Date: 2026-09-24

## Context

- ハーネス初心者は CLAUDE.md だけを置き、そこに手順を全部散文で書いていることが多い。spawn するものだけをフローとみなすと、そうしたハーネスは「フロー 0 本」になり評価できない。
- 単独で成果物を作って終わる skill は、レビューなしの典型であり、③の「レビュー行為の有無」の対象にしたい。

## Decision

- 入口（人が `/xxx` で呼ぶ、description で選ばれる、hook イベント、他フローからの呼び出し、散文で書かれた手順）があるものはすべてフローとする。
- kind:

| kind | 内容 |
|---|---|
| single | 1 コンテキストで完結する skill / command |
| orchestrated | Agent tool で subagent を spawn する skill |
| workflow | `.claude/workflows/*` のスクリプト |
| team | teammate / SendMessage で協調するもの |
| hook-chain | hook が起点で走る自動処理 |
| implicit | CLAUDE.md / rules に散文で書かれた手順。確度（explicit-procedure / procedure-like）を付ける |

- 各フローが持つもの: entry、orchestrator、steps（actor / action / 入出力）、spawns（何を・いつ: sequential / parallel / background / conditional / loop）、participants、artifacts（ファイル / memory 書き込み / commit・PR / 外部メッセージ / レポート / なし）、review_points（誰が誰の何を、どんな基準で、不合格時に何が起きるか）、judgment_points（AI が裁量で判断する箇所と記録指示の有無）、calls（他フローの呼び出し）。
- 出力: kind 別の件数、各フロー 1 行のサマリ、フロー間グラフ、各フローの sequence 図。

## Consequences

- (+) 初心者ハーネスも、単独 skill も評価対象になる。
- (−) implicit は LLM の読み取りに依存して揺れる。確度を付けて明示する。
