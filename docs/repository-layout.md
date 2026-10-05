# リポジトリのレイアウト

個人用のスキル置き場として、自作スキルをほかのプロジェクトへ `npx skills add` で入れられる形にしている。この文書は、その形を選んだ理由と、採らなかった案をまとめる。手順は `README.md`、守ることは `AGENTS.md` にある。

確認に使った版: `skills` CLI 1.7.0（`docs/sources/github/vercel-labs-skills/`）、Claude Code の文書 2.1.289 時点（`docs/sources/claude-code/`）。確認日 2026-10-05。

## 配布元と、使うための置き場を分ける

| 場所 | 役割 | git |
|---|---|---|
| `skills/` | 自作スキルの正本（配布元） | 管理する |
| `.agents/skills/`、`.claude/skills/` | このリポジトリで使うために入れた自作スキルと外部スキル | 管理する |
| `skills-lock.json` | 入れたスキルの記録 | 管理する |

- 公開されているスキル集（kepano/obsidian-skills、anthropics/skills）も、ルートの `skills/` を配布元にしている
- `npx skills add` は `skills/` を `.agents/skills/` より先に探す（README の Skill Discovery、`src/skills.ts`）。同じ名前のスキルは先に見つかったものだけが残る（`src/skills.ts` の `seenNames`）
- Claude Code のプラグインも、既定では `skills/` からスキルを読む（`plugins/manifest-reference.md`）。そのため、あとからプラグインにする場合も配置を変えずに済む

`.agents/skills/` と `.claude/skills/` の両方に入れるのは、Claude Code が `.agents/` 配下を読まないため（`memory.md` の「Not read: … anything under a `.agents/` directory」）。`-a universal claude-code --copy` で入れると両方に同じ内容のコピーが入る（試して確認）。`-a claude-code` だけでは `.claude/skills/` しか作られない（同）。

## clone した直後から使え、外部スキルは配布しない

このリポジトリは、自分の規約（`AGENTS.md`）が参照するスキルを使う。clone した直後から使えるように、`.agents/skills/` と `.claude/skills/` をコミットする。

ただし `npx skills add` は `.agents/skills/` と `.claude/skills/` も配布元として探すため、そのままでは外部スキルも配布される（試して確認）。これを `skills-lock.json` で防ぐ。lock に載っているスキルは、`.agents/skills/` や `.claude/skills/` などエージェントの置き場にあっても配布対象から外れる（`src/skills.ts` の `isInstalledProjectSkill`）。自作スキルは `skills/` から配布される。git の URL で渡しても、ローカルのパスで渡しても、配布されるのは自作スキルだけだった（試して確認）。

`npx skills update` は使わない。試したところ、`--copy` で入れた `.claude/skills/` の外部スキルがシンボリックリンクに置き換わり、取得元が `.` の自作スキルは更新されなかった。更新は `npx skills add` の再実行で行う。

採らなかった方法:

- `.agents/skills/` と `.claude/skills/` を `.gitignore` に入れる: git の URL で渡すと clone して読むため、外部スキルは配布されない（試して確認）。ただし clone した直後はスキルが無く、`AGENTS.md` が参照するスキルを使えない。ローカルのパスで渡すと外部スキルも配布される
- `.claude/skills/` の自作スキルだけをコミットし、外部スキルを `.gitignore` に入れる: 自作スキルは使えるが、自作スキルが参照する外部スキル（`defuddle`、`obsidian-markdown`）は clone した直後に無い
- frontmatter に `metadata.internal: true` を書く: 既定の探索から隠せる（README）。外部スキルを直接編集することになるため採らない
- git のフックで clone した直後に入れる: フックは clone 先に渡らない（試して確認）
- Claude Code のプロジェクトプラグインとして `skills/` を直接読ませる（`plugins/loading.md` の「Plugins shared through a repository」）: Claude Code 専用で、フォルダの信頼の確認が要る。相対パスの可否と、`skills/` の変更が反映される時期は未確認

## テレメトリを止める

`npx skills add` は匿名の利用データを送る。GitHub で公開と確認できない取得元では、取得元とスキル名も送られうる（README の Telemetry）。個人用のリポジトリなので、コマンドに `DISABLE_TELEMETRY=1` を付ける。

## プラグインにしない

Claude Code のプラグインは、スキル・サブエージェント・フック・MCP サーバーなどを 1 単位でインストールし、マーケットプレイスから更新できるようにしたもの（`plugins/overview.md`）。`.claude-plugin/plugin.json` がプラグインの定義、`.claude-plugin/marketplace.json` がプラグインの一覧（マーケットプレイス）の定義になる。

現時点ではプラグインにしない。

- 配布するのはスキルだけである。このリポジトリはフックを使わない方針である
- スキルだけなら `npx skills add` で複数のエージェントへ入れられる。プラグインは Claude Code 専用である
- プラグインのスキルは `/<プラグイン名>:<スキル名>` という名前になる（`plugins/components.md`）
- 有効なプラグインは、使わないセッションにも名前と説明をコンテキストに載せる（`plugins/overview.md`）。単体のスキルも既定では説明文が常にコンテキストに載る（`skills.md` の「Description always in context」）ので、プラグインにしない理由にはならない

サブエージェントやフックもまとめて配りたくなったら見直す。`skills/` はプラグインの既定の置き場と同じなので、`.claude-plugin/` を足せばプラグインとしても配れる。
