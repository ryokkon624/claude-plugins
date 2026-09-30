# ADR-0002: 出力は実行ごとのタイムスタンプディレクトリに履歴として残し、latest.html を併置する

- Status: Accepted
- Date: 2026-09-24

## Context

- 主な使い方は「ハーネスを直す → 再レビュー → 前回と比べる」の反復である。
- 上書き方式では過去時点との比較ができない。

## Decision

- 出力ルートは `${CLAUDE_PROJECT_DIR}/output/harness-review/`（このリポジトリ直下）に固定する。
- 対象ディレクトリの basename ごとに `output/harness-review/<dirname>/` を作り、実行ごとに `<YYYY-MM-DD-HHMM>/` を切る。

```
output/harness-review/<dirname>/
├── latest.html                  ← 最新 run の report.html のコピー
└── <YYYY-MM-DD-HHMM>/
    ├── run.json                 ← 対象、オプション、各 stage の所要時間・agent 数・モデル
    ├── harness.json             ← ①
    ├── flows.json               ← ②
    ├── findings.json            ← ③（検証済み）
    ├── verification.json        ← 検証ログ（REJECTED、網羅性チェック結果、unclassified）
    ├── report.html
    └── work/                    ← subagent の生出力（ADR-0009）
```

- レンダリング時に直前の run の `findings.json` を読み、finding を 解消 / 新規 / 継続 に分類して表示する。finding の id は `hash(axis + target + 正規化した claim)` で安定させる。
- 別パスに同名 basename のディレクトリがある場合の衝突は考慮しない。

## Consequences

- (+) 任意の 2 時点を比較できる。前回との差分を自動で出せる。
- (−) ディスクが溜まる。掃除は手動とする。
