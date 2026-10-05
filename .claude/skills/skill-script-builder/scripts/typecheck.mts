import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import process, { argv, stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';

interface Diagnostic {
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly code: string;
  readonly message: string;
}

interface CommandResult {
  readonly status: number | null;
  readonly output: string;
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
}

type Outcome =
  | { readonly kind: 'checked'; readonly ok: boolean; readonly diagnostics: readonly Diagnostic[]; readonly typesNode: string | null }
  | { readonly kind: 'failed'; readonly reason: string };

interface ErrorText {
  readonly text: string;
  readonly truncated: boolean;
  readonly length: number;
}

type Collected =
  | { readonly kind: 'ok'; readonly files: readonly string[] }
  | { readonly kind: 'usage'; readonly message: string };

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;

const TYPESCRIPT_VERSION = '7.0.2';
// 下限の Node（24）に合わせた型定義
const TYPES_NODE_RANGE = '24';
// npm install と tsc の出力をまとめて受けるため。既定の 1MB では大量の型エラーで切れる
const MAX_BUFFER = 64 * 1024 * 1024;
// レジストリに届かないと npm は再試行を続けるので、打ち切って後片付けまで進める
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
// 失敗の詳細は npm・tsc の出力を含んで長くなりうるので、JSON に入れる分を切る
const ERROR_TEXT_LIMIT = 2000;

// コーディング規約 §8.1 のコンパイラ要求に対応するフラグ
const COMPILER_FLAGS = [
  '--ignoreConfig',
  '--noEmit',
  '--pretty',
  'false',
  '--strict',
  '--erasableSyntaxOnly',
  '--verbatimModuleSyntax',
  '--noUncheckedIndexedAccess',
  '--noFallthroughCasesInSwitch',
  '--noImplicitOverride',
  '--target',
  'esnext',
  '--lib',
  'esnext',
  '--module',
  'nodenext',
  '--moduleResolution',
  'nodenext',
  '--rewriteRelativeImportExtensions',
  '--types',
  'node',
];

const DIAGNOSTIC_LINE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// ファイルに結びつかないエラー（設定やオプションの誤りなど）
const GLOBAL_DIAGNOSTIC_LINE = /^error (TS\d+): (.*)$/;
// 1 回の失敗を待ち続けて無言にならないよう、npm の通信の経過を stderr に出す
const NPM_LOG_LEVEL = '--loglevel=http';

const HELP = `Usage: node <skill-script-builder のディレクトリ>/scripts/typecheck.mts <path> [<path> ...]

スキルに同梱する .mts を、コーディング規約 §8.1 のフラグで型検査する。
一時ディレクトリ（OS の一時ディレクトリの下）に typescript@${TYPESCRIPT_VERSION} と @types/node@${TYPES_NODE_RANGE} を入れ、
検査のあと、失敗したときも含めて消す。消せなかったときは JSON の leftoverTempDir にそのパスを出す。
npm のレジストリに接続できることが要る。npm install は ${String(INSTALL_TIMEOUT_MS / 1000)} 秒で打ち切る。

<path> は .mts のファイルか、ディレクトリ。ディレクトリなら、その下の .mts をすべて検査する
（node_modules は除く）。スキルのディレクトリを渡すと scripts/ の下が対象になる。

結果は JSON で stdout に出す。ok は true（型エラーなし）、false（型エラーあり。diagnostics に一覧）、
null（npm・tsc の失敗などで型検査できなかった。error に原因）のどれか。ok が null なら型が正しいとみなさない。
npm の通信の経過（--loglevel=http）と、npm・tsc の失敗の詳細は stderr に出す。
型エラーの file・line・column は、ファイルに結びつかないエラーでは null になる。
files と leftoverTempDir は、一時ディレクトリを作る前に失敗したときだけ null になる。

Options:
  --help   この説明を出す

Exit codes:
  0  型エラーがない
  1  型エラーがある（ok: false）、または型検査できなかった（ok: null。npm install の失敗・打ち切り、tsc の失敗）
  2  使い方の誤り（パスがない、.mts がない など）

Example:
  node /path/to/skill-script-builder/scripts/typecheck.mts /path/to/skills/my-skill
`;

const describeError = (e: unknown): string => {
  return Error.isError(e) ? e.message : String(e);
};

const collectMtsFiles = (directory: string): string[] => {
  const found: string[] = [];
  const pending = [directory];
  let current = pending.pop();
  while (current !== undefined) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        pending.push(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.mts') {
        found.push(fullPath);
      }
    }
    current = pending.pop();
  }
  return found;
};

const collectTargets = (paths: readonly string[]): Collected => {
  const files = new Set<string>();
  for (const given of paths) {
    const absolute = resolve(given);
    if (!existsSync(absolute)) {
      return { kind: 'usage', message: `見つからない: ${absolute}` };
    }
    if (statSync(absolute).isDirectory()) {
      const scripts = join(absolute, 'scripts');
      const root = existsSync(scripts) && statSync(scripts).isDirectory() ? scripts : absolute;
      for (const file of collectMtsFiles(root)) {
        files.add(file);
      }
    } else if (extname(absolute) === '.mts') {
      files.add(absolute);
    } else {
      return { kind: 'usage', message: `.mts のファイルかディレクトリを渡す: ${absolute}` };
    }
  }
  if (files.size === 0) {
    return { kind: 'usage', message: `検査する .mts が見つからない: ${paths.map((path) => resolve(path)).join(', ')}` };
  }
  return { kind: 'ok', files: [...files].toSorted() };
};

const run = (command: string, args: readonly string[], cwd: string, options: { readonly timeout?: number; readonly streamStderr?: boolean } = {}): CommandResult => {
  const stderrMode = options.streamStderr === true ? 'inherit' : 'pipe';
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', stderrMode], maxBuffer: MAX_BUFFER, timeout: options.timeout });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error === undefined ? null : describeError(result.error),
    errorCode: result.error !== undefined && 'code' in result.error && typeof result.error.code === 'string' ? result.error.code : null,
    signal: result.signal,
    timedOut: result.error !== undefined && 'code' in result.error && result.error.code === 'ETIMEDOUT',
  };
};

// npm.cmd は Windows ではシェルなしで起動できないので、node で npm-cli.js を直接動かす
const findNpmCli = (): string | null => {
  const nodeDirectory = dirname(process.execPath);
  const candidates = [
    process.env['npm_execpath'],
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => candidate !== undefined && candidate.endsWith('npm-cli.js') && existsSync(candidate)) ?? null;
};

const installCompiler = (workDirectory: string): CommandResult => {
  writeFileSync(join(workDirectory, 'package.json'), '{ "private": true }\n');
  const installArgs = ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', NPM_LOG_LEVEL, `typescript@${TYPESCRIPT_VERSION}`, `@types/node@${TYPES_NODE_RANGE}`];
  const options = { timeout: INSTALL_TIMEOUT_MS, streamStderr: true };
  const npmCli = findNpmCli();
  if (npmCli !== null) {
    return run(process.execPath, [npmCli, ...installArgs], workDirectory, options);
  }
  if (process.platform === 'win32') {
    // 引数はすべて固定の文字列なので、cmd.exe に渡しても解釈は変わらない
    return run('cmd.exe', ['/d', '/c', 'npm', ...installArgs], workDirectory, options);
  }
  return run('npm', installArgs, workDirectory, options);
};

const parseDiagnostics = (output: string, baseDirectory: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  let last: { file: string | null; line: number | null; column: number | null; code: string; message: string } | null = null;
  for (const line of output.split(/\r?\n/)) {
    const located = DIAGNOSTIC_LINE.exec(line);
    const global = located === null ? GLOBAL_DIAGNOSTIC_LINE.exec(line) : null;
    if (located !== null) {
      last = {
        file: resolve(baseDirectory, located[1] ?? ''),
        line: Number(located[2]),
        column: Number(located[3]),
        code: located[4] ?? '',
        message: located[5] ?? '',
      };
      diagnostics.push(last);
    } else if (global !== null) {
      last = { file: null, line: null, column: null, code: global[1] ?? '', message: global[2] ?? '' };
      diagnostics.push(last);
    } else if (last !== null && /^\s+\S/.test(line)) {
      // --pretty false でも、長いメッセージの続きは字下げした行で出る
      last.message = `${last.message}\n${line.trim()}`;
    }
  }
  return diagnostics;
};

const typesNodeVersion = (packageJsonPath: string): string | null => {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') {
    return parsed.version;
  }
  return null;
};

const toErrorText = (text: string): ErrorText => {
  const characters = [...text];
  return { text: characters.slice(0, ERROR_TEXT_LIMIT).join(''), truncated: characters.length > ERROR_TEXT_LIMIT, length: characters.length };
};

const writeUnchecked = (reason: string, files: readonly string[] | null, leftoverTempDir: string | null): number => {
  const error = toErrorText(reason);
  stdout.write(`${JSON.stringify({ ok: null, typescript: TYPESCRIPT_VERSION, typesNode: null, files, diagnostics: [], error, leftoverTempDir }, null, 2)}\n`);
  stderr.write(`Error: 型検査できなかった。${reason}\n`);
  return EXIT_PROBLEM;
};

const writeOutput = (output: string): void => {
  if (output !== '') {
    stderr.write(output.endsWith('\n') ? output : `${output}\n`);
  }
};

const checkIn = (workDirectory: string, files: readonly string[]): Outcome => {
  stderr.write(`typescript@${TYPESCRIPT_VERSION} と @types/node@${TYPES_NODE_RANGE} を一時ディレクトリに入れる: ${workDirectory}\n`);
  const install = installCompiler(workDirectory);
  if (install.timedOut) {
    writeOutput(install.output);
    return { kind: 'failed', reason: `npm install を ${String(INSTALL_TIMEOUT_MS / 1000)} 秒で打ち切った。npm のレジストリに接続できるか（プロキシの設定を含む）を確かめる` };
  }
  if (install.status !== 0) {
    writeOutput(install.output);
    return { kind: 'failed', reason: `npm install に失敗した（${install.error ?? `終了コード ${String(install.status)}`}）。npm のレジストリに接続できるか、npm が入っているかを確かめる` };
  }
  const tscScript = join(workDirectory, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const typeRoots = join(workDirectory, 'node_modules', '@types');
  const typesNode = join(typeRoots, 'node', 'package.json');
  const compile = run(process.execPath, [tscScript, ...COMPILER_FLAGS, '--typeRoots', typeRoots, ...files], workDirectory);
  if (compile.error !== null || compile.status === null) {
    if (compile.errorCode === 'ENOBUFS') {
      // 上限を超えた出力をそのまま stderr に流すと、読む側の文脈を埋めてしまう
      return { kind: 'failed', reason: `tsc の出力が ${String(MAX_BUFFER / 1024 / 1024)}MB を超えたので打ち切った。検査するファイルを分けて試す` };
    }
    writeOutput(compile.output);
    if (compile.error === null && compile.signal !== null) {
      return { kind: 'failed', reason: `tsc がシグナル ${compile.signal} で終わった。外から止められた可能性がある。もう一度試す` };
    }
    return { kind: 'failed', reason: `tsc を起動できなかった: ${compile.error ?? '終了コードなし'}` };
  }
  const diagnostics = parseDiagnostics(compile.output, workDirectory);
  if (compile.status !== 0 && diagnostics.length === 0) {
    writeOutput(compile.output);
    return { kind: 'failed', reason: `tsc が終了コード ${String(compile.status)} で終わったが、型エラーの行を読み取れなかった。stderr の tsc の出力を確かめる` };
  }
  return { kind: 'checked', ok: compile.status === 0, diagnostics, typesNode: existsSync(typesNode) ? typesNodeVersion(typesNode) : null };
};

const typecheck = (files: readonly string[]): number => {
  const workDirectory = mkdtempSync(join(tmpdir(), 'skill-typecheck-'));
  let leftoverTempDir: string | null = null;
  let outcome: Outcome;
  {
    // 後片付けの失敗はここで捕まえて報告し、例外にしない。検査の結果は正しいので、終了コードは変えない
    using _cleanup = {
      [Symbol.dispose]: (): void => {
        try {
          // Windows ではウイルス対策ソフトなどがファイルを一時的に掴み、削除が EBUSY などで失敗することがある
          rmSync(workDirectory, { recursive: true, force: true, maxRetries: 3 });
        } catch (e) {
          leftoverTempDir = workDirectory;
          stderr.write(`Warning: 一時ディレクトリ ${workDirectory} が残った（${describeError(e)}）。手で消す\n`);
        }
      },
    };
    try {
      outcome = checkIn(workDirectory, files);
    } catch (e) {
      outcome = { kind: 'failed', reason: `型検査の途中で失敗した: ${describeError(e)}` };
    }
  }
  if (outcome.kind === 'failed') {
    return writeUnchecked(outcome.reason, files, leftoverTempDir);
  }
  const { ok, diagnostics, typesNode } = outcome;
  stdout.write(`${JSON.stringify({ ok, typescript: TYPESCRIPT_VERSION, typesNode, files, diagnostics, error: null, leftoverTempDir }, null, 2)}\n`);
  stderr.write(ok ? `OK: ${String(files.length)} ファイルに型エラーはない\n` : `NG: 型エラー ${String(diagnostics.length)} 件\n`);
  return ok ? EXIT_OK : EXIT_PROBLEM;
};

const parseCommandLine = (args: readonly string[]) => {
  return parseArgs({ args: [...args], options: { help: { type: 'boolean' } }, allowPositionals: true });
};

const main = (): number => {
  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(argv.slice(2));
  } catch (e) {
    stderr.write(`Error: ${describeError(e)}\n使い方は --help を見る\n`);
    return EXIT_USAGE;
  }
  if (parsed.values.help === true) {
    stdout.write(HELP);
    return EXIT_OK;
  }
  if (parsed.positionals.length === 0) {
    stderr.write('Error: 検査する .mts のファイルかディレクトリを 1 つ以上渡す\n例: node <skill-script-builder のディレクトリ>/scripts/typecheck.mts /path/to/skills/my-skill\n');
    return EXIT_USAGE;
  }
  const collected = collectTargets(parsed.positionals);
  if (collected.kind === 'usage') {
    stderr.write(`Error: ${collected.message}\n`);
    return EXIT_USAGE;
  }
  return typecheck(collected.files);
};

try {
  process.exitCode = main();
} catch (e) {
  process.exitCode = writeUnchecked(`型検査の途中で失敗した: ${describeError(e)}`, null, null);
}
