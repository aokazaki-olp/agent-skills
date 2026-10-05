import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import process, { argv, stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';

type Verdict = 'triggered' | 'triggered (error)' | 'not triggered';

interface SkillCall {
  readonly id: string;
  readonly error: CallError | null;
}

interface CallError {
  readonly text: string;
  readonly truncated: boolean;
  readonly length: number;
}

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;

// stream-json の出力は会話全体を含み、既定の 1MB を超えうる
const MAX_BUFFER = 256 * 1024 * 1024;
// 試用の 1 回が長引いても止まるように。--timeout で変えられる
const DEFAULT_TIMEOUT_SECONDS = 600;
// エラー本文はツールの説明まで含んで長くなることがあり、JSON を読むエージェントの文脈を圧迫しないよう切る
const ERROR_TEXT_LIMIT = 2000;

const HELP = `Usage: node <skill-builder のディレクトリ>/scripts/check-trigger.mts --skill <name> --prompt <text> [--cwd <dir>] [--claude <path>] [--timeout <seconds>]

新しい Claude Code のセッション（claude -p）でプロンプトを試し、スキルが発火したかを判定する。
claude には --permission-mode dontAsk --no-session-persistence --output-format stream-json --verbose を付け、
プロンプトは -- の後ろに置き（- で始まってもオプションと取られない）、stdin は空にする。
dontAsk は確認が要る操作を断る。作業ディレクトリ内の読み取り、読み取り専用のコマンド、設定の許可ルール
（permissions.allow）に当たる操作、PreToolUse hook が許可した呼び出しは実行される。

結果は JSON で stdout に出す。verdict は次のどれか:
  triggered          Skill ツールでそのスキルが呼ばれ、エラーなく本文が返った
  triggered (error)  呼ばれたが、呼び出しがエラーになり本文が届かなかった
  not triggered      呼ばれなかった
判定できなかったとき（終了コード 1）も JSON を出し、verdict を null、error に原因（text・truncated・length）を入れる。
claudeExitCode と claudeSignal は claude の終了コードと、シグナルで終わったときのシグナル名（それ以外は null）。

Options:
  --skill <name>       判定するスキルの名前（必須）
  --prompt <text>      試すプロンプト（必須）。- で始まるプロンプトは --prompt=<text> の形で渡す
  --cwd <dir>          claude を起動するディレクトリ。スキルを置いたプロジェクトのルート（既定: 今のディレクトリ）
  --claude <path>      claude の実行ファイル（既定: PATH の claude。Windows では claude.exe のパスを渡すことがある）
  --timeout <seconds>  claude の実行を打ち切るまでの秒数。1〜9999999 の整数で、先頭に 0 を付けない（既定: ${String(DEFAULT_TIMEOUT_SECONDS)}）
  --help               この説明を出す

Exit codes:
  0  判定できた（verdict は JSON を見る）
  1  判定できなかった（claude が 0 以外で終わった、結果が is_error だった、結果がない、出力を読めない、
     --timeout で打ち切った、出力が大きすぎた、シグナルで落ちた）。stdout の JSON の error に原因が入る。
     description や本文の問題とは限らないので、そのまま直しに進まない
  2  使い方の誤り、または claude を起動できない（見つからない、実行できない、Windows で .cmd を渡した）

Examples:
  node /path/to/skill-builder/scripts/check-trigger.mts --skill csv-report --prompt "売上のCSVを月別にまとめて" --cwd /path/to/project
  node C:\\path\\to\\skill-builder\\scripts\\check-trigger.mts --skill csv-report --prompt "..." --cwd C:\\path\\to\\project --claude C:\\Users\\me\\.local\\bin\\claude.exe
`;

const describeError = (e: unknown): string => {
  return Error.isError(e) ? e.message : String(e);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const contentItems = (event: Record<string, unknown>): unknown[] => {
  const message = event['message'];
  if (!isRecord(message)) {
    return [];
  }
  const content = message['content'];
  return Array.isArray(content) ? content : [];
};

interface ClaudeExit {
  readonly status: number | null;
  readonly signal: string | null;
}

const NO_EXIT: ClaudeExit = { status: null, signal: null };

const writeClaudeStderr = (text: string): void => {
  if (text !== '') {
    stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  }
};

const describeExit = (exit: ClaudeExit): string => {
  if (exit.status !== null) {
    return `終了コード ${String(exit.status)}`;
  }
  return exit.signal === null ? '終了コードなし' : `シグナル ${exit.signal}`;
};

const writeUndetermined = (context: { readonly skill: string | null; readonly cwd: string | null }, reason: string, exit: ClaudeExit, hint: string): number => {
  const error = toCallError(reason);
  stdout.write(`${JSON.stringify({ skill: context.skill, cwd: context.cwd, verdict: null, error, claudeExitCode: exit.status, claudeSignal: exit.signal }, null, 2)}\n`);
  stderr.write(`Error: 判定できなかった。${error.text}${error.truncated ? `（${String(error.length)} 文字から切り詰めた）` : ''}\n${hint}\n`);
  return EXIT_PROBLEM;
};

const toCallError = (content: unknown): CallError => {
  const text = typeof content === 'string' ? content : (JSON.stringify(content) ?? '');
  const characters = [...text];
  return { text: characters.slice(0, ERROR_TEXT_LIMIT).join(''), truncated: characters.length > ERROR_TEXT_LIMIT, length: characters.length };
};

const findSkillCalls = (events: readonly Record<string, unknown>[], skill: string): SkillCall[] => {
  const calls = new Map<string, CallError | null>();
  for (const event of events) {
    if (event['type'] !== 'assistant') {
      continue;
    }
    for (const item of contentItems(event)) {
      const input = isRecord(item) ? item['input'] : undefined;
      if (isRecord(item) && item['type'] === 'tool_use' && item['name'] === 'Skill' && isRecord(input) && input['skill'] === skill && typeof item['id'] === 'string') {
        calls.set(item['id'], null);
      }
    }
  }
  for (const event of events) {
    if (event['type'] !== 'user') {
      continue;
    }
    for (const item of contentItems(event)) {
      if (isRecord(item) && item['type'] === 'tool_result' && typeof item['tool_use_id'] === 'string' && calls.has(item['tool_use_id']) && item['is_error'] === true) {
        calls.set(item['tool_use_id'], toCallError(item['content']));
      }
    }
  }
  return [...calls].map(([id, error]) => ({ id, error }));
};

const parseEvents = (output: string): Record<string, unknown>[] | null => {
  const events: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) {
        events.push(parsed);
      }
    } catch (_e) {
      return null;
    }
  }
  return events;
};

const parseCommandLine = (args: readonly string[]) => {
  return parseArgs({
    args: [...args],
    options: {
      skill: { type: 'string' },
      prompt: { type: 'string' },
      cwd: { type: 'string' },
      claude: { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
};

const main = (): number => {
  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(argv.slice(2));
  } catch (e) {
    stderr.write(`Error: ${describeError(e)}\n使い方は --help を見る\n`);
    return EXIT_USAGE;
  }
  const { values } = parsed;
  if (values.help === true) {
    stdout.write(HELP);
    return EXIT_OK;
  }
  const skill = values.skill ?? '';
  const prompt = values.prompt ?? '';
  if (skill === '' || prompt === '') {
    stderr.write('Error: --skill と --prompt を指定する\n例: node <skill-builder のディレクトリ>/scripts/check-trigger.mts --skill my-skill --prompt "このCSVを集計して" --cwd /path/to/project\n');
    return EXIT_USAGE;
  }
  const cwd = resolve(values.cwd ?? process.cwd());
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    stderr.write(`Error: --cwd のディレクトリが見つからない: ${cwd}\n`);
    return EXIT_USAGE;
  }
  const timeoutText = values.timeout ?? String(DEFAULT_TIMEOUT_SECONDS);
  if (!/^[1-9][0-9]{0,6}$/.test(timeoutText)) {
    stderr.write(`Error: --timeout には 1〜9999999 の整数の秒数を、先頭に 0 を付けずに指定する（受け取った値: ${timeoutText}）\n`);
    return EXIT_USAGE;
  }
  const timeoutSeconds = Number(timeoutText);
  const claude = values.claude ?? 'claude';
  // オプションを先に並べ、プロンプトは -- の後ろに置く。- で始まるプロンプトをオプションと取らせないため
  const args = ['--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '-p', '--', prompt];
  stderr.write(`claude を起動する（cwd: ${cwd}）\n`);
  const result = spawnSync(claude, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
    timeout: timeoutSeconds * 1000,
  });
  if (result.error !== undefined) {
    const code = 'code' in result.error ? result.error.code : undefined;
    if (code === 'ENOENT' || code === 'EINVAL' || code === 'EACCES') {
      const reasons: Record<string, string> = {
        ENOENT: 'claude が見つからない',
        EINVAL: 'claude を起動できない（Windows の .cmd・.bat はシェルなしで起動できない）',
        EACCES: 'claude を実行できない（実行の権限がないか、ディレクトリを渡した）',
      };
      const reason = reasons[code] ?? 'claude を起動できない';
      const nextStep =
        code === 'EACCES'
          ? '--claude には、ディレクトリではなく、実行の権限がある claude の実行ファイルのパスを渡す'
          : 'Claude Code の CLI を入れて PATH に通すか、--claude に実行ファイルのパスを渡す。Windows では claude.exe のパスを渡す（ネイティブのインストーラーなら %USERPROFILE%\\.local\\bin\\claude.exe）。このスクリプトはプロンプトをシェルに渡さないので、claude.cmd は使わない';
      stderr.write(`Error: ${reason}: ${claude}\n${nextStep}\n`);
      return EXIT_USAGE;
    }
    const exit = { status: result.status, signal: result.signal };
    if (code !== 'ENOBUFS') {
      // 上限を超えたときは、出力をそのまま流すと読む側の文脈を埋めてしまうので出さない
      writeClaudeStderr(result.stderr);
    }
    if (code === 'ETIMEDOUT') {
      return writeUndetermined({ skill, cwd }, `${String(timeoutSeconds)} 秒で打ち切った`, exit, '--timeout を延ばして試し直す');
    }
    if (code === 'ENOBUFS') {
      return writeUndetermined({ skill, cwd }, `claude の出力が ${String(MAX_BUFFER / 1024 / 1024)}MB を超えたので打ち切った`, exit, '長い作業をさせないプロンプト（発火だけを確かめる短い依頼）で試し直す');
    }
    return writeUndetermined({ skill, cwd }, `claude の実行に失敗した: ${describeError(result.error)}`, exit, '--claude と --cwd を確かめる');
  }
  const exit: ClaudeExit = { status: result.status, signal: result.signal };
  const failureHint =
    exit.status === null && exit.signal !== null
      ? 'claude が外から止められた可能性がある。もう一度試す'
      : 'ログイン状態や API キー、--cwd を確かめる。description や本文を直す前に、この失敗を解消する';
  const events = parseEvents(result.stdout);
  if (events === null || events.length === 0) {
    writeClaudeStderr(result.stderr);
    return writeUndetermined({ skill, cwd }, `claude の出力を stream-json として読めなかった（${describeExit(exit)}）`, exit, failureHint);
  }
  const resultEvent = events.findLast((event) => event['type'] === 'result');
  const resultText = typeof resultEvent?.['result'] === 'string' ? resultEvent['result'] : '（本文なし）';
  if (resultEvent === undefined) {
    writeClaudeStderr(result.stderr);
    return writeUndetermined({ skill, cwd }, `結果（type: result）が出力にない（${describeExit(exit)}）`, exit, failureHint);
  }
  if (resultEvent['is_error'] === true) {
    writeClaudeStderr(result.stderr);
    return writeUndetermined({ skill, cwd }, `claude の結果がエラー: ${resultText}`, exit, failureHint);
  }
  if (result.status !== 0) {
    writeClaudeStderr(result.stderr);
    return writeUndetermined({ skill, cwd }, `claude が${describeExit(exit)} で終わった`, exit, failureHint);
  }
  const calls = findSkillCalls(events, skill);
  const failed = calls.filter((call) => call.error !== null);
  const verdict: Verdict = calls.length === 0 ? 'not triggered' : failed.length > 0 ? 'triggered (error)' : 'triggered';
  stdout.write(`${JSON.stringify({ skill, cwd, verdict, calls: calls.length, errors: failed.map((call) => call.error), claudeExitCode: result.status, claudeSignal: result.signal }, null, 2)}\n`);
  stderr.write(`${verdict}\n`);
  return EXIT_OK;
};

try {
  process.exitCode = main();
} catch (e) {
  process.exitCode = writeUndetermined({ skill: null, cwd: null }, `判定の途中で失敗した: ${describeError(e)}`, NO_EXIT, 'stderr の内容を確かめる');
}
