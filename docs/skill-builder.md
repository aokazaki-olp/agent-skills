# skill-builder と skill-script-builder の設計

スキルを作るためのスキルを 2 つに分けて持つ。この文書は、その構成と、決めたことの根拠をまとめる。根拠の出典は `docs/sources/` 内のパスで示す（Claude Code の文書は 2.1.289 時点、2026-10-05 取得）。

| スキル | 役割 |
|---|---|
| `skill-builder` | スキルを作る・直す手順の全体（聞き取り、名前、対象の種類、SKILL.md、検証、試用、このリポジトリでの仕上げ） |
| `skill-script-builder` | スキルに同梱するスクリプトを書く手順（Node を優先し、コーディング規約に従う） |

スクリプトを別のスキルにするのは、コーディング規約（約 740 行）をスクリプトを書くときだけ読めば足りるため。

## ガイドラインとベストプラクティスを明示的に持たせる

Anthropic の文書には、スキルを書くための特別なスキルは不要だという記述がある（`claude-platform/agents-and-tools/agent-skills/best-practices.md:791-793`「You don't need special system prompts or a "writing skills" skill」）。この前提には頼らない。スキルの効果は、発火の精度、段階的な開示、自由度の調整、検証の仕組みなどの書き方で大きく変わる。そうした書き方を、何も持たないモデルが毎回自発的に適用するとは限らない。そこで、一次情報のガイドラインとベストプラクティスから、スキルを最大限に活かす書き方を明示的に採り入れる。

- 採り入れた書き方は `skill-builder/references/` に、出典付きの指針としてまとめる。SKILL.md には、作成中に毎回確かめる要点（チェックリスト）を置く
- 主な出典: `claude-platform/agents-and-tools/agent-skills/best-practices.md`、`agentskills/skill-creation/` 配下（best-practices、optimizing-descriptions、evaluating-skills、using-scripts）、`claude-code/skills.md`、`anthropic-engineering/equipping-agents-for-the-real-world-with-agent-skills.md`、`writing-tools-for-agents.md`、`effective-context-engineering-for-ai-agents.md`、`demystifying-evals-for-ai-agents.md`
- 加えて、次のものを持たせる: 対象の種類（A / B）ごとの機能の線引き、このリポジトリの書き方の慣習と AGENTS.md の決まり、名前・frontmatter・構成の検証スクリプト、試し方と仕上げの手順

情報源どうしで食い違う点は、次のように決める。

| 論点 | 食い違い | 採る方針 |
|---|---|---|
| description の人称 | 三人称（platform の best-practices:205-211）／命令形（agentskills の optimizing-descriptions:25） | 日本語で「〜するスキル」「〜とき適用する」の形にそろえる。何をするかと、いつ使うかの両方を書き、ユーザーが実際に使う言葉を入れる |
| description の押しの強さ | やや押し強めに（optimizing-descriptions:27、skill-creator:67）／発火しすぎなら絞る（skills.md:1157） | 発火すべき場面を広めに挙げ、同時に「〜は行わない」と紛らわしい隣接の作業との境界を書く。強さは試用で調整する |
| 強い言葉 | MUST を勧める例（best-practices:819）／理由で納得させる（evaluating-skills:285、skill-creator:139・302、prompting best practices:490） | 全大文字の強制は使わない。規則には短い理由を添える |
| 理由を書くか | 「how or why を語らない」（skills.md:355）／「why を説明する」（agentskills best-practices:100、evaluating-skills:285） | 規則が守られるのに要る理由は 1 文で添える。作成の経緯や設計の議論は書かない（AGENTS.md） |
| 評価の重さ | 3 シナリオ（platform）／2〜3 件から（agentskills）／20〜50 件（evals の記事） | 2〜3 件と、発火すべきでない紛らわしい依頼から始め、失敗が見つかるたびに足す |

## 対象の種類

| 種類 | 動く場所 | 使ってよいもの |
|---|---|---|
| A. 共通 | `.agents/skills/` を読むエージェント、Claude Code、claude.ai、Skills API、Claude Desktop の Cowork タブ | Agent Skills 仕様の範囲だけ |
| B. Claude Code 専用 | Claude Code が動くところ: CLI、Claude Desktop の Code タブ（ローカル・SSH）、クラウドのセッション | Claude Code の拡張も使ってよい |

- Desktop の Code タブのローカルセッションは `~/.claude/skills/` とプロジェクトのスキルを読む。Cowork タブは claude.ai のアカウントで有効にしたスキルを使い、`~/.claude` を読まない（`claude-code/desktop.md:409,429,431`）
- claude.ai へのアップロード、Skills API、`package_skill.py` は、仕様の 6 フィールド（`name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`）以外があると失敗する（`claude-code/skills.md:408-416`）。platform 側の文書では未確認
- アップロード系は SKILL.md が 1 つだけでないと拒否する（`local-synced/skill-creator/scripts/quick_validate.py:38-42`。platform 側の文書では未確認）
- `` !`cmd` `` による動的な差し込みは claude.ai と API では動かず、Cowork ではプレースホルダーになる（`claude-code/skills.md:292,418`）

A の決まり:

- frontmatter は `name` と `description` を基本にし、必要なときだけ `license`、`compatibility`、`metadata` を足す。`allowed-tools` は使わない（仕様で Experimental、`agentskills/specification.md:188-189`。非対応のクライアントがある、`github/vercel-labs-skills/README.md:515`）
- ファイルの参照はスキルのルートからの相対パス（`agentskills/specification.md:255`、`agentskills/skill-creation/using-scripts.md:96-98`）
- SKILL.md は 1 つだけ。入れ子のスキルを作らない

B の決まり:

- `claude-code/skills.md:378-396` の拡張フィールドを使ってよい。ただしこのリポジトリはフックを使わない方針なので `hooks` は使わない
- 同梱ファイルは `${CLAUDE_SKILL_DIR}` で参照する。作業ディレクトリが変わっても解決できる（`claude-code/skills.md:454,717`）
- `allowed-tools` は「その回だけ許可を省く」機能で、ツールを制限するものではない。制限は `disallowed-tools`（`claude-code/skills.md:387-388,582`）
- 重要な指示は本文の先頭に置く。自動圧縮のときは各スキルの先頭 5,000 トークンだけが残る（`claude-code/skills.md:576`）
- 本文は一度読み込まれたら読み直されないので、1 回きりの手順ではなく、作業の間ずっと効く指示として書く（`claude-code/skills.md:572`）

## 名前

- 仕様: 1〜64 文字、`a-z`・`0-9`・`-` のみ、先頭・末尾のハイフンと `--` は不可、親ディレクトリ名と一致（`agentskills/specification.md:30,65-69`）
- 避ける名前: `synced`、`anthropic-skills`（Claude Code が読み込まない、`claude-code/skills.md:155-156`）。`anthropic`・`claude` を含む名前（アップロード系で禁止、`claude-platform/agents-and-tools/agent-skills/overview.md:210-213`。best-practices も「Cannot contain reserved words」とし、避ける例に `anthropic-helper`・`claude-tools` を挙げる）
- このリポジトリの外部スキルと同じ名前を付けない（AGENTS.md）

## 書き方

このリポジトリの自作スキルの慣習に合わせる。

- frontmatter は `name` と `description`。description は日本語で、`>-` の折り畳み形式にし、次の順に書く: 何をするスキルか（「〜するスキル」）／何を定めるか／いつ適用するか／他のスキルに委ねる範囲／末尾に「〜は行わない」
- 本文の見出しは `# <name> スキル`。目的、前提（依存するスキル）、適用条件、本文、最後に `## Gotchas（既知の注意点）`
- 他のスキルは `[[スキル名]]` で参照する
- 常体で「〜する」「〜しない」。要点は太字。規則には理由を添える
- 全大文字の MUST・ALWAYS で強制せず、理由で納得させる（`agentskills/skill-creation/evaluating-skills.md:285`、`github/anthropics-skills/skills/skill-creator/SKILL.md:139`）
- SKILL.md の本文は 500 行未満。超えるなら `references/` に分け、参照は 1 階層まで、「いつ読むか」を書く（`agentskills/specification.md:251,264`、`agentskills/skill-creation/best-practices.md:92`）
- Claude がすでに知っていることは書かない（`claude-platform/agents-and-tools/agent-skills/best-practices.md:24-30`）。選択肢を並べず既定値を 1 つ示す（同 855-870）
- 外部の仕様を扱うスキルは、仕様を記憶で書かず一次情報で確かめる（AGENTS.md、`research-workflow`）
- AGENTS.md の「ファイルに書く内容」に従う。作成の経緯、改訂の履歴、なぜこの書き方にしたかは SKILL.md に書かない

## 検証と試用

- 静的な検証は skill-builder に同梱するスクリプトで行う。検査項目: SKILL.md が 1 つだけ（`node_modules`・`__pycache__` とルート直下の `evals` は数えない）、frontmatter の構文、YAML 1.1 で文字列以外になる素の値、name の規則とディレクトリ名との一致、避ける名前、description の長さ（1〜1024 文字）と `<`・`>`・XML タグ、`compatibility`・`license`・`metadata` の形、種類 A なら仕様外のキーがないこと、本文の行数、本文から参照しているファイルの実在とバックスラッシュ。種類 B では、Claude Code が受け付けてアップロード系だけが拒むもの（`claude` を含む名前、1,024 文字を超える description、description の `<`・`>`、`license`・`compatibility`・`metadata` の値が YAML 1.1 で文字列にならないこと、入れ子の `metadata`）は warning にする。`name`・`description` の値の型は種類 B でも error にする
- 差し込み（`!` の直後にバッククォートで囲んだコマンド）と `CLAUDE_SKILL_DIR` 変数の置き換えは、SKILL.md の本文ではインラインコードやコードブロックの中でも起きる（Claude Code 2.1.283 で実際に呼び出して確認。`claude-code/skills.md:459,691`）。説明のつもりで書くと、呼び出しが止まったり、別のパスに化けたりする。SKILL.md の本文では言葉で書き、具体例は references/ に置く。検証スクリプトもコードの中を除かずに照合する
- 静的な検証と、別のエージェントによる読み合わせだけでは、この種の問題は見つからない。試用の完了条件に、Claude Code で実際に呼び出し、本文がエラーなく届くことを含める
- 試用の前に、エージェントが読み込む置き場へ入れる。正本を `skills/` に置く構成では、入れる前は発火しようがない
- 発火したかは、`claude -p --output-format stream-json --verbose` の出力で Skill ツールの呼び出しを見る（`--output-format json` には呼び出しの記録が出なかった。Claude Code 2.1.283 で確認）。サブエージェントは呼び出した側に最終報告しか返さず途中のツール呼び出しが見えないので、発火の確認には使わず、出力の確認だけに使う。`claude -p` は試したプロンプトの作業を実際に行いうるので、使い捨てのコピーか許可を絞った設定で回す
- セッション開始時に無かった置き場を新しく作ったときは、そのセッションは置き場を監視していないので、`/reload-skills` を打つまで読み込まれず、その後に変更するたびにも打ち直しが要る（`claude-code/skills.md:301`）。新しいセッションで試す
- 試用: 発火するか（description）と、出力が期待どおりかを分けて確かめる（`claude-code/skills.md:899-910`）。試すプロンプトは 2〜3 件から始め、発火すべきでない紛らわしい依頼も入れる
- 本格的な評価の仕組み（skill-creator の評価ビューア、`claude plugin eval`）は持たない。前者は Claude Code と Python のサーバーに依存し、後者はプラグインが前提で、このリポジトリはプラグインにしない（`docs/repository-layout.md`）

## スクリプト

- Node を優先するのは、Linux・WSL・Windows のどれでも入っていることが多く、入れやすいため（ユーザーの方針）。この理由から、スキルの手順にシェルの書き方（POSIX の `mktemp`・`rm -rf`・`/dev/null`、PowerShell の構文など）を残さない。型検査や発火の確認のように手順が込み入るものは Node のスクリプトにし、SKILL.md にはどの OS でも同じ `node <スキルのディレクトリ>/scripts/<名前>.mts …` の 1 行を書く
- 手順の具体性は部分ごとに決める（`claude-platform/agents-and-tools/agent-skills/best-practices.md:63-132`「Match the level of specificity to the task's fragility and variability」、`agentskills/skill-creation/best-practices.md:96-143`「Calibrate each part independently」）。規約を守らせるフラグの組み合わせのように、1 つ欠けると結果が変わる部分はスクリプトに固定する（`agentskills/skill-creation/using-scripts.md:94`、`claude-platform/agents-and-tools/agent-skills/best-practices.md:1058`）。一時ファイルの置き場所のように、どのやり方でも結果が同じ部分は「OS に合った方法で」と任せる
- Node を優先する。下限はコーディング規約の baseline（型注釈除去が stable な版）で、Node 24.12.0 で stable になった（Node 公式の `doc/api/typescript.md`、v24.21.0 のタグで確認）
- 拡張子は `.mts` にし、`node scripts/x.mts` でそのまま実行する。`.ts` はモジュールの種類を最寄りの `package.json` の `type` で決めるため、配布先が `"type": "commonjs"` だと `SyntaxError: Cannot use import statement outside a module` で落ちる（Node 24.21.0 で確認）。`.mts` は常に ESM として動く
- スクリプトは作業ディレクトリに依存させない。同梱ファイルは `import.meta.dirname` で解決し、対象のパスは引数で受け、出力するパスは絶対パスにする。エージェントがどこから呼ぶかはクライアントによって違う（agentskills の using-scripts.md:126 はスキルのルートから、Claude Code の Bash はプロジェクトのルートから）。試用で、cwd を前提にした出力パスの作り直しが起きた
- Node 以外の言語は、Node で書けない理由があるときだけ使い、その理由と前提を `compatibility` か本文に書く
- コーディング規約に従う。規約は `.claude/rules/` にあり、スキルを別のプロジェクトへ配ると届かないため、`skill-script-builder/references/coding-rules.md` に写しを同梱する。プロジェクトに自前の規約があればそちらを優先する
- スクリプトの約束事: 対話的な入力を求めない、`--help` を持つ、結果は stdout、診断は stderr、意味のある終了コード、破壊的な操作には確認か `--dry-run`、エラーには「何が悪いか・何を期待したか・次に何を試すか」を書く（`agentskills/skill-creation/using-scripts.md:239-308`）
- 依存パッケージは使わず、`node:` の組み込みモジュールで書く。claude.ai・API の実行環境ではインストールできないことがある（`claude-platform/build-with-claude/skills-guide.md:3764-3765`）
