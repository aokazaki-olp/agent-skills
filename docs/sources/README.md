# 一次情報（スキル作成スキル用）

「スキルを作るスキル」を設計・実装するための一次情報の原文コピー。**内容は取得時点のものであり、本文は編集していない**。仕様を使う前に、ここの記述が現行かを出典 URL で再確認する。

- 取得日: 2026-10-05（JST）
- 取得方法: ブログ記事以外は、各サイトの `llms.txt` から対象ページを選び、`.md` 版を `curl -sSfL` で取得（取得元と保存先の対応は `.manifest.tsv`）
- 取得時に確認したこと: 全件 HTTP 成功、HTML ではなく Markdown 本文であること、各ページの見出し（または frontmatter の `title`）

## 収録内容

| フォルダ | 出典 | 版・時点 |
|---|---|---|
| `claude-code/` | https://code.claude.com/docs/en/ （スキル、サブエージェント、フック、MCP、プラグイン全般、設定、権限、ツール、Agent SDK、セキュリティ指針、モデル設定、エラー、セッション、worktree、サンドボックス、管理設定、Desktop など 111 ページ） | changelog の最新は 2.1.289（2026-10-03）。手元の CLI は `claude --version` = 2.1.283、`npm view @anthropic-ai/claude-code version` = 2.1.289 |
| `claude-platform/` | https://platform.claude.com/docs/en/ （Agent Skills 概要・ベストプラクティス・API、Skills API、Plugins API、MCP connector、ツール利用とその設計、プロンプト設計と最新モデル別の指針、テストと評価、ガードレール。31 ページ） | 取得日時点 |
| `agentskills/` | https://agentskills.io/ （Agent Skills のオープン仕様、作成ガイド、評価、説明文の最適化） | 取得日時点 |
| `mcp/` | https://modelcontextprotocol.io/ の **2026-07-28 版**（docs、specification、クライアント／セキュリティのベストプラクティス、Inspector・デバッグ）と、版のない community / extensions のページ（design-principles、security、apps/build）。50 ページ | versioning ページで「current protocol version は 2026-07-28」と確認。旧版（2025-11-25 以前）と draft は取得していない |
| `anthropic-engineering/` | https://www.anthropic.com/engineering の記事（`defuddle` で本文を抽出したもの。HTML から変換したため原文と体裁が異なる箇所がある）。16 本 | 各記事の公開日は下表 |
| `claude-help/` | https://support.claude.com の claude.ai 向けスキル記事 3 本（`defuddle` で抽出） | 「How to create custom skills」は July 22, 2026。他の 2 本はページ上の表記が「Updated over a week ago」で、日付は未確認 |
| `anthropic-news/` | スキル発表記事 `anthropic.com/news/skills`（Oct 16, 2025、2025-12-18 追記）と、組織向け管理・ディレクトリ・オープン標準化の記事 `claude.com/blog/organization-skills-and-directory`（Dec 18, 2025）（`defuddle` で抽出） | 各記事の公開日 |
| `github/anthropics-skills/` | https://github.com/anthropics/skills の `skill-creator`、`mcp-builder`、`template`、`spec`、README | commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`（2026-09-28）。Apache-2.0（各 LICENSE.txt） |
| `github/claude-plugins-official/` | anthropics/claude-plugins-official の `plugin-dev`、`example-plugin`（手元の `~/.claude/plugins/marketplaces/` からコピー） | マーケットプレイスの lastUpdated 2026-10-05T00:14:53Z。commit は未確認（手元のコピーが git 管理外のため） |
| `github/vercel-labs-skills/` | https://github.com/vercel-labs/skills（`npx skills` の CLI）の README、AGENTS.md、LICENSE、package.json と、探索・インストール・lock 処理のソース（`src/add.ts`、`installer.ts`、`local-lock.ts`、`skills.ts`、`agents.ts`、`types.ts`） | タグ `v1.7.0`（commit `7407f3893ad4dceab546ac002c3ef806e4000c73`）。`npm view skills@1.7.0 gitHead` と一致。main（2026-10-02 時点の `18f96ea`）とは README に差分あり |
| `skills-sh/` | https://skills.sh/docs と https://skills.sh/docs/packs（`defuddle` で抽出） | 取得日時点 |
| `local-synced/skill-creator/` | 手元の `~/.claude/skills/synced/<id>/skill-creator`（claude.ai から同期されたと見られる版）のコピー | 最終更新 2026-09-19（ファイルの更新時刻）。`github/anthropics-skills/` 版と `SKILL.md`・`scripts/quick_validate.py`・`LICENSE.txt` が異なる |
| `_index/` | 取得に使った各サイトの `llms.txt` | 取得日時点 |

`npm view @anthropic-ai/claude-agent-sdk version` = 0.3.289（2026-10-05 確認）。

## ブログ記事の公開日

ブログは公開後に更新されない前提では読まない（例: Agent Skills の記事は 2025-12-18 に追記あり）。公開日は `defuddle parse --json` の `published` で確認した。

| ファイル | 公開日 |
|---|---|
| `building-effective-agents.md` | 2024-12-19 |
| `claude-think-tool.md` | 2025-03-20 |
| `multi-agent-research-system.md` | 2025-06-13 |
| `desktop-extensions.md` | 2025-06-26 |
| `writing-tools-for-agents.md` | 2025-09-11 |
| `effective-context-engineering-for-ai-agents.md` | 2025-09-29 |
| `equipping-agents-for-the-real-world-with-agent-skills.md` | 2025-10-16（2025-12-18 追記） |
| `claude-code-sandboxing.md` | 2025-10-20 |
| `code-execution-with-mcp.md` | 2025-11-04 |
| `advanced-tool-use.md` | 2025-11-24 |
| `effective-harnesses-for-long-running-agents.md` | 2025-11-26 |
| `demystifying-evals-for-ai-agents.md` | 2026-01-09 |
| `harness-design-long-running-apps.md` | 2026-03-24 |
| `claude-code-auto-mode.md` | 2026-03-25 |
| `managed-agents.md` | 2026-04-08 |
| `how-we-contain-claude.md` | 2026-05-25 |

旧記事 `engineering/claude-code-best-practices` は `code.claude.com/docs/en/best-practices` へ 308 でリダイレクトされるため、`claude-code/best-practices.md` を正とし、重複して保存していない。

## 主な参照先

- スキルの形式: `agentskills/specification.md`、`claude-code/skills.md`
- 書き方: `claude-platform/agents-and-tools/agent-skills/best-practices.md`、`agentskills/skill-creation/best-practices.md`
- 発火（description）と評価: `agentskills/skill-creation/optimizing-descriptions.md`、`agentskills/skill-creation/evaluating-skills.md`、`claude-code/plugin-evals.md`
- 既存の実装例: `github/anthropics-skills/skills/skill-creator/`、`github/claude-plugins-official/plugins/plugin-dev/skills/skill-development/`
- ガイドライン・設計指針: `claude-code/best-practices.md`、`anthropic-engineering/equipping-agents-for-the-real-world-with-agent-skills.md`、`writing-tools-for-agents.md`、`effective-context-engineering-for-ai-agents.md`、`building-effective-agents.md`
- 評価: `anthropic-engineering/demystifying-evals-for-ai-agents.md`、`claude-platform/test-and-evaluate/develop-tests.md`
- セキュリティ: `claude-code/security.md`、`claude-code/plugins/security.md`、`mcp/docs/2026-07-28/tutorials/security/security_best_practices.md`
- claude.ai でのスキル: `claude-help/12512198-creating-custom-skills.md`、`claude-help/12512180-using-skills-in-claude.md`
- モデル指定: `claude-code/model-config.md`
- プラグイン: `claude-code/plugins/`（`manifest-reference.md`、`components.md` ほか）
- `npx skills add` の挙動: `github/vercel-labs-skills/README.md`（Skill Discovery、Installation Methods、Options、Telemetry）、`src/skills.ts`（探索）、`src/installer.ts`（正本とコピー）
- フック・サブエージェント・MCP: `claude-code/hooks.md`、`claude-code/sub-agents.md`、`claude-code/mcp.md`、`mcp/specification/2026-07-28/`

## 未確認

- 収録した文書の記述が手元の CLI 2.1.283 の挙動と一致するか（実際に動かしての検証はしていない）
- `github/claude-plugins-official/` の対応 commit
- `local-synced/skill-creator/` の同期元と版。GitHub 版（2026-09-28 の commit）とどちらが新しいかも未確認
- 発表記事の追記にあるリンク `https://www.anthropic.com/blog/organization-skills-and-directory` は 404 だった。同じスラッグの `https://claude.com/blog/organization-skills-and-directory` が 200 で、タイトルと日付が一致したため、これを同じ記事とみなした（転送設定で確認したわけではない）
- Engineering ブログの一覧ページ（https://www.anthropic.com/engineering）に全記事が載っているか。一覧に出た 25 本から関連する 17 本を選んだ
