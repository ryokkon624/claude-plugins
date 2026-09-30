# ADR-0007: 判断基準は references/ に「公式」と「独自」の 2 層で持ち、finding に basis を付ける

- Status: Accepted
- Date: 2026-09-24

## Context

- 「適材適所とは何か」「良い冒頭とは何か」をモデルの記憶に任せると実行ごとにブレる。
- 公式ドキュメント（code.claude.com/docs）に根拠がある基準と、ユーザーの経験則による基準がある。両者は説得力が違うので、読み手が区別できる必要がある。
- 公式ドキュメントは変わる。

調査（2026-09-24）の結果:

| 軸 | 公式の根拠 |
|---|---|
| A 適材適所 | あり。CLAUDE.md に入れるもの / 入れないもの、「その行を消したら Claude が間違えるか」、「ブロックしたいなら PreToolUse hook。CLAUDE.md は助言、hooks は決定的」、rules の `paths` スコープ、commands は legacy |
| B フォーマット | あり。skill の description 1,536 文字上限・トリガー句・本文 500 行以下、agent の name 制約・description 合計 15,000 トークン・system prompt の構成、hooks の exit code、plugin.json |
| C レビュー行為 | 一部あり。「fresh context の subagent に diff をレビューさせろ」「Claude が回せるチェックを与えろ」まで。「正解なし作業は敵対的検証」は独自 |
| D ADR | なし。全面的に独自 |
| E 自己判断の記録 | なし。全面的に独自 |
| memory | 公式は auto-memory のみ。プロジェクト独自 memory の検出は独自の観点 |

## Decision

- `.claude/skills/harness-review/references/<axis>.md` を各軸ごとに置き、次の 2 節で構成する。
  - **公式**: 出典 URL、取得日、要点の言い換え。ハード要件と best practice を区別する。
  - **独自**: ユーザーの経験則に基づく基準と、その理由。
- finding に `basis: official | custom` を持たせ、HTML で区別して表示する。
- 公式節の更新は手動で行い、取得日を必ず更新する。
- ユーザーは references を編集することで基準を調整できる。

## Consequences

- (+) 「公式に反している」と「うちの流儀に反している」を読み手が区別できる。
- (+) 基準の調整が文書編集で済む。
- (−) 公式節が陳腐化するリスクがある。取得日で可視化する。
