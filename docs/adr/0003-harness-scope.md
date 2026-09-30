# ADR-0003: ハーネスの範囲はプロジェクトレベル全部（hooks / settings / MCP を含む）とし、ユーザーレベルは対象外とする

- Status: Accepted
- Date: 2026-09-24

## Context

- 「何をハーネスとみなすか」で ①②③ のすべてが変わる。
- ③の適材適所レビューで「これは rule ではなく hook で強制すべき」と言うには、hooks と permissions を見ている必要がある。
- レビュー対象がプラグインである場合もある（このリポジトリの skill を将来プラグイン化する可能性を含む）。

## Decision

対象に含めるもの:

| 種別 | 場所 |
|---|---|
| CLAUDE.md 系 | ルート、サブディレクトリのネスト、`CLAUDE.local.md`、`.claude/CLAUDE.md`、`@import` で参照される先 |
| rules | `.claude/rules/*.md` |
| skills | `.claude/skills/*/SKILL.md` と同梱ファイル |
| commands | `.claude/commands/*.md`（旧配置である事実を記録する） |
| agents | `.claude/agents/**/*.md` |
| hooks / permissions | `.claude/settings.json`、`.claude/settings.local.json` の `hooks` と `permissions`、hook が指すスクリプト実体 |
| MCP | `.mcp.json` |
| workflows | `.claude/workflows/*` |
| プラグイン配置 | `.claude-plugin/plugin.json`、`skills/`、`agents/`、`hooks/hooks.json`、`commands/`、`.mcp.json` |
| memory 候補 | 構造的検出（`memory/`、`.claude/memory/`、`MEMORY.md`、`NOTES.md`、`docs/adr/`、`decisions/` 等）と参照的検出（ハーネス内の「記録しろ / 参照しろ」指示の対象） |

対象に含めないもの:

- `~/.claude` 配下のユーザーレベル設定。将来オプションで有効化できる余地は残す。

レイアウトは project / plugin / 両方 を自動判定する。

## Consequences

- (+) hook や permissions への昇格提案ができる。
- (+) memory を「書く側 / 読む側」の事実として扱える。
- (−) レイアウト判定と、settings.json / hooks.json のパースが必要。
