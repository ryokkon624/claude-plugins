# ADR-0011: プレーンな `.claude/` プロジェクトとして構成し、プラグイン / marketplace 化しない

- Status: Accepted
- Date: 2026-09-25

## Context

- 当初は marketplace 構成（`.claude-plugin/marketplace.json` ＋ `plugins/harness-review/`）を検討した。
- 公式ドキュメント（2026-09-25 確認）では、marketplace からインストールしたプラグインは `~/.claude/plugins/cache/` にコピーされ、編集の反映に update / 再インストールが要る。また `${CLAUDE_PLUGIN_ROOT}` がキャッシュを指すため、出力先の解決が複雑になる。
- このツールをどこかにインストールして使う想定がなく、このディレクトリで動けば足りる。

## Decision

- このリポジトリで `claude` を起動し、`/harness-review <対象パス>` で使う。起動フラグやインストールは不要。
- 配置:

```
claude-plugins/
├── README.md
├── CLAUDE.md
├── docs/adr/
├── .claude/
│   ├── skills/harness-review/
│   │   ├── SKILL.md          ← オーケストレータ
│   │   ├── scripts/          ← discover / merge / coverage / render
│   │   ├── references/       ← A〜E の基準文書（ADR-0007）
│   │   └── vendor/mermaid.min.js
│   └── agents/
│       ├── harness-extractor.md
│       ├── flow-extractor.md
│       ├── harness-reviewer.md
│       └── finding-verifier.md
└── output/harness-review/<dirname>/...
```

- scripts / references / vendor は skill ディレクトリ配下にまとめ、`${CLAUDE_SKILL_DIR}` で参照する。将来プラグイン化する場合も skill ディレクトリをそのまま持ち出せる。
- 出力ルートは `${CLAUDE_PROJECT_DIR}/output/harness-review/` に固定する（ADR-0002）。

## Consequences

- (+) 起動フラグ不要、編集が即反映される。
- (−) 他プロジェクトの中から直接は呼べない。対象はパスで指定してレビューする。
