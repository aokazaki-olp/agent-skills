# skills

個人用のエージェントスキル置き場。自作スキルと、スキルを作るためのスキルを置く。

自作スキルの正本は `skills/` にある。`.agents/skills/` と `.claude/skills/` は、このリポジトリで使うために `npx skills add` で入れたもの（自作スキルと外部スキル）で、clone した直後から使えるようにコミットしてある。`skills-lock.json` に載っているスキルは、このリポジトリを `npx skills add` したときに配布されない。

## 自作スキル

| スキル | 内容 |
|---|---|
| `activity-log` | 作業の節目ごとに、したことと決めたことを日次ログへ追記する |
| `git-workflow` | git / GitHub 操作の前に適用する運用規約 |
| `obsidian-config` | Obsidian vault へ読み書きする前に、vault パス・保存先・ファイル名・タイムゾーンを解決する |
| `obsidian-log` | Obsidian vault に追記型の日次ログを書く／読む |
| `research-workflow` | 外部の仕様を調べるときの作法（一次情報での裏取り） |

## 別のプロジェクトへ入れる

入れたいプロジェクトのルートで実行する。

```sh
DISABLE_TELEMETRY=1 npx skills add <このリポジトリの git URL> -a universal claude-code --copy
DISABLE_TELEMETRY=1 npx skills add https://github.com/kepano/obsidian-skills -a universal claude-code --copy -s defuddle obsidian-markdown
rm -f skills-lock.json
```

- `-a universal claude-code --copy` で、`.agents/skills/` と `.claude/skills/` の両方に同じ内容のコピーが入る
- 2 行目は自作スキルが参照する外部スキル（`research-workflow` → `defuddle`、`activity-log`・`obsidian-log` → `obsidian-markdown`）。ほかの Obsidian 系スキルも要るなら `-s` に足す
- `DISABLE_TELEMETRY=1` は、GitHub で公開と確認できないリポジトリの取得元とスキル名が送られうるため
- 更新は同じコマンドを再実行する（上書きされる）
- 更新に `npx skills update` を使わない。`--copy` で入れたものがシンボリックリンクに置き換わる

## このリポジトリで使う

clone した直後から使える。`skills/` を直したら、このリポジトリのルートで次を実行してからコミットする。

```sh
DISABLE_TELEMETRY=1 npx skills add . -a universal claude-code --copy -y -s activity-log git-workflow obsidian-config obsidian-log research-workflow
```

外部スキルを更新するときは次を実行する。`skills-lock.json` は消さない。

```sh
DISABLE_TELEMETRY=1 npx skills add https://github.com/kepano/obsidian-skills -a universal claude-code --copy -y
```
