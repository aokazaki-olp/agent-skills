import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process, { argv, stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';

type Kind = 'A' | 'B';
type Severity = 'error' | 'warning' | 'unverifiable';

interface Finding {
  readonly severity: Severity;
  readonly check: string;
  readonly message: string;
}

interface SkillReport {
  readonly path: string;
  readonly realPath: string | null;
  readonly kind: Kind;
  readonly ok: boolean;
  readonly bodyLines: number | null;
  readonly findings: readonly Finding[];
}

interface Scalar {
  readonly value: string;
  readonly plain: boolean;
}

type YamlValue =
  | { readonly kind: 'scalar'; readonly value: string; readonly plain: boolean }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'map'; readonly entries: ReadonlyMap<string, Scalar> }
  | { readonly kind: 'unreadable'; readonly reason: string };

interface YamlField {
  readonly value: YamlValue;
  readonly line: number;
}

type Frontmatter =
  | { readonly kind: 'missing'; readonly reason: string }
  | {
      readonly kind: 'present';
      readonly fields: ReadonlyMap<string, YamlField>;
      readonly findings: readonly Finding[];
      readonly body: string;
      readonly bodyLines: number;
    };

interface SkillFiles {
  readonly skillFiles: readonly string[];
  readonly symlinks: readonly string[];
}

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;

const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;
const COMPATIBILITY_MAX_LENGTH = 500;
const LISTING_MAX_LENGTH = 1536;
const BODY_LINE_LIMIT = 500;

const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
// claude.ai へのアップロードと Skills API でだけ問題になり、Claude Code は使わないか捨てるキー
const UPLOAD_ONLY_FIELDS = new Set(['license', 'compatibility', 'metadata']);

// Claude Code の skills 文書の frontmatter 表（v2.1.289 時点）にあるキー。これ以外は Claude Code が黙って無視する
const CLAUDE_CODE_FIELDS = new Set([
  ...SPEC_FIELDS,
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'hooks',
  'paths',
  'shell',
]);

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_NAMES = new Set(['synced', 'anthropic-skills']);
const FORBIDDEN_NAME_PARTS = ['anthropic', 'claude'];
// PyYAML（YAML 1.1。アップロード側の検査器が使う）の暗黙の型解決で、引用符なしだと文字列以外になる値
const NON_STRING_PLAIN = new RegExp(
  [
    '^(?:',
    '~|null|Null|NULL',
    '|yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF',
    '|[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+',
    '|[-+]?(?:[0-9][0-9_]*)\\.[0-9_]*(?:[eE][-+][0-9]+)?|\\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?',
    '|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN)',
    '|[0-9]{4}-[0-9]{2}-[0-9]{2}',
    '|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \\t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]*)?(?:[ \\t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?',
    ')$',
  ].join(''),
);
// package_skill.py が同梱しないディレクトリ。どの深さでも除くものと、ルート直下だけ除くもの
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '__pycache__']);
const ROOT_EXCLUDED_DIRECTORIES = new Set(['evals']);

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['\\', '\\'],
  ['"', '"'],
  ['/', '/'],
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
  [' ', ' '],
]);

const KEY_LINE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;
const BLOCK_HEADER = /^([|>])(?:([1-9])([-+])?|([-+])([1-9])?)?(?:[ \t]+#.*)?$/;
const LIST_ITEM = /^( +)- (.*)$/;
const MAP_ENTRY = /^( +)([A-Za-z0-9_.-]+):[ \t]+(.*)$/;
// PyYAML ではこれらで始まる引用符なしの値が ParserError・ScannerError になるか、この検査器が扱わない形になる
const UNSUPPORTED_PLAIN_START = /^[&*!%@`?{|>,\]}]/;

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const OPENING_FENCE = /^([ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*)(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^([ \t>]*)(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LIST_MARKER = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+/;
const INDENTED_CODE = /^(?: {4}|\t| {1,3}\t)/;
const CODE_SPAN = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
// Claude Code は SKILL.md の本文を、コードの中も含めて走査し、行頭か空白の直後の ! + バッククォートを差し込みとして実行する
const INLINE_INJECTION = /(?:^|\s)!`[^`\n]*`/;
const BLOCK_INJECTION = /^[ \t]*`{3,}![ \t]*$/m;
const SKILL_DIR_VARIABLE = '${CLAUDE_SKILL_DIR}';
const SKILL_DIR_PREFIX = `${SKILL_DIR_VARIABLE}/`;
const BUNDLED_PATH = /^(?:scripts|references|assets)[/\\][^<>*{}$…]*\.[A-Za-z0-9]+$/;

const HELP = `Usage: node <skill-builder のディレクトリ>/scripts/validate-skill.mts --kind <A|B> <skill-dir> [<skill-dir> ...]

スキルのディレクトリを静的に検査し、結果を JSON で stdout に出す（path は絶対パス）。診断は stderr。
作業ディレクトリには依存しない。<skill-dir> は絶対パスで渡すと取り違えない。
<skill-dir> がシンボリックリンクなら実体を検査し、realPath に実体のパスを出す。

Options:
  --kind A|B   対象の種類。A = 共通（Agent Skills 仕様の範囲）、B = Claude Code 専用
  --help       この説明を出す

検査: SKILL.md が 1 つだけ（node_modules・__pycache__・ルート直下の evals は除く）/ frontmatter /
      name の規則とディレクトリ名 / 避ける名前 / description の長さと < > / 使ってよいキー /
      YAML 1.1 で文字列にならない値 / license・compatibility・metadata の形 / 本文の行数 /
      本文のリンクと \`scripts/…\`・\`references/…\`・\`assets/…\` の参照先とバックスラッシュ /
      本文（コードの中を含む）の変数 CLAUDE_SKILL_DIR と ! + バッククォートの差し込み / シンボリックリンクのサブディレクトリ
      種類 B では、claude.ai・API へのアップロードでだけ問題になるものを warning に下げる。
      name と description は、Claude Code では省略できるが、発火に要るので種類 B でも必須として扱う

severity:
  error         直す必要がある
  warning       直すか、理由を確かめて残す
  unverifiable  この検査器が読めない形か、読み取りに失敗した。その項目は手で確かめる

Exit codes:
  0  error と unverifiable がない（warning はあってよい）
  1  error か unverifiable がある
  2  使い方の誤り（--kind がない、ディレクトリがない など）

Examples:
  node /path/to/skill-builder/scripts/validate-skill.mts --kind A /path/to/project/skills/my-skill
  node /path/to/skill-builder/scripts/validate-skill.mts --kind B /path/to/project/.claude/skills/a
`;

const describeError = (e: unknown): string => {
  return Error.isError(e) ? e.message : String(e);
};

const charLength = (text: string): number => {
  return [...text].length;
};

const finding = (severity: Severity, check: string, message: string): Finding => {
  return { severity, check, message };
};

const findSkillFiles = (root: string): SkillFiles => {
  const skillFiles: string[] = [];
  const symlinks: string[] = [];
  const pending: string[] = [root];
  let directory = pending.pop();
  while (directory !== undefined) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks.push(relative(root, fullPath));
      } else if (entry.isDirectory()) {
        const excluded = EXCLUDED_DIRECTORIES.has(entry.name) || (directory === root && ROOT_EXCLUDED_DIRECTORIES.has(entry.name));
        if (!excluded) {
          pending.push(fullPath);
        }
      } else if (entry.name.toLowerCase() === 'skill.md') {
        skillFiles.push(relative(root, fullPath));
      }
    }
    directory = pending.pop();
  }
  return { skillFiles: skillFiles.toSorted(), symlinks: symlinks.toSorted() };
};

const stripComment = (text: string): string => {
  const match = /(?:^|[ \t])#/.exec(text);
  return (match === null ? text : text.slice(0, match.index)).trim();
};

const parseDoubleQuoted = (text: string): { value: string; rest: string } | null => {
  let value = '';
  for (let i = 1; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      return { value, rest: text.slice(i + 1) };
    }
    if (character !== '\\') {
      value += character;
      continue;
    }
    const next = text[i + 1] ?? '';
    const replacement = SIMPLE_ESCAPES.get(next);
    if (replacement !== undefined) {
      value += replacement;
      i++;
      continue;
    }
    const width = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0;
    const hex = text.slice(i + 2, i + 2 + width);
    if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${String(width)}}$`).test(hex)) {
      return null;
    }
    value += String.fromCodePoint(Number.parseInt(hex, 16));
    i += 1 + width;
  }
  return null;
};

const parseSingleQuoted = (text: string): { value: string; rest: string } | null => {
  let value = '';
  for (let i = 1; i < text.length; i++) {
    const character = text[i];
    if (character !== "'") {
      value += character;
      continue;
    }
    if (text[i + 1] === "'") {
      value += "'";
      i++;
      continue;
    }
    return { value, rest: text.slice(i + 1) };
  }
  return null;
};

const parseInlineScalar = (raw: string): YamlValue => {
  const text = raw.trim();
  if (text.startsWith('"') || text.startsWith("'")) {
    const parsed = text.startsWith('"') ? parseDoubleQuoted(text) : parseSingleQuoted(text);
    if (parsed === null) {
      return { kind: 'unreadable', reason: '引用符が同じ行で閉じていないか、扱えないエスケープがある' };
    }
    if (stripComment(parsed.rest) !== '') {
      return { kind: 'unreadable', reason: '閉じ引用符の後ろに値が続いている' };
    }
    return { kind: 'scalar', value: parsed.value, plain: false };
  }
  if (UNSUPPORTED_PLAIN_START.test(text) || /^-(?:\s|$)/.test(text)) {
    return { kind: 'unreadable', reason: `この検査器が扱わない書き方か、YAML として読めない値（先頭が ${text.charAt(0)}。引用符で囲む）` };
  }
  if (text.startsWith('[')) {
    const inner = /^\[([^[\]{}"']*)\](.*)$/.exec(text);
    if (inner === null || stripComment(inner[2] ?? '') !== '') {
      return { kind: 'unreadable', reason: '入れ子や引用符を含むフロー形式のリスト' };
    }
    const items = (inner[1] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    return { kind: 'list', items };
  }
  const value = stripComment(text);
  if (/:(?:\s|$)/.test(value)) {
    return { kind: 'unreadable', reason: '引用符なしの値に ": " を含む（YAML では不正。引用符か >- で書く）' };
  }
  return { kind: 'scalar', value, plain: true };
};

const parseBlockScalar = (header: string, children: readonly string[]): YamlValue => {
  const headerMatch = BLOCK_HEADER.exec(header);
  if (headerMatch === null) {
    return { kind: 'unreadable', reason: `ブロックスカラーの指示子が読めない: ${header}` };
  }
  const style = headerMatch[1];
  const explicitIndent = headerMatch[2] ?? headerMatch[5];
  const chomping = headerMatch[3] ?? headerMatch[4] ?? '';
  const firstContent = children.find((line) => line.trim() !== '');
  const indent =
    explicitIndent !== undefined
      ? Number(explicitIndent)
      : firstContent === undefined
        ? 0
        : firstContent.length - firstContent.trimStart().length;
  if (children.some((line) => /^ *\t/.test(line))) {
    return { kind: 'unreadable', reason: '字下げにタブを使っている' };
  }
  const lines: string[] = [];
  for (const line of children) {
    if (line.trim() === '') {
      lines.push('');
      continue;
    }
    if (line.length - line.trimStart().length < indent) {
      return { kind: 'unreadable', reason: 'ブロックスカラーの字下げがそろっていない' };
    }
    lines.push(line.slice(indent));
  }
  let trailing = 0;
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
    trailing++;
  }
  let body: string;
  if (style === '|') {
    body = lines.join('\n');
  } else {
    if (lines.some((line) => /^[ \t]/.test(line))) {
      return { kind: 'unreadable', reason: '折り畳み（>）の中に、さらに字下げした行がある' };
    }
    body = '';
    let pendingBreaks = 0;
    let started = false;
    for (const line of lines) {
      if (line === '') {
        pendingBreaks++;
        continue;
      }
      if (started && pendingBreaks === 0) {
        body += ' ';
      } else {
        body += '\n'.repeat(pendingBreaks);
      }
      body += line;
      started = true;
      pendingBreaks = 0;
    }
  }
  if (body === '' || chomping === '-') {
    return { kind: 'scalar', value: body, plain: false };
  }
  const tail = chomping === '+' ? '\n'.repeat(trailing + 1) : '\n';
  return { kind: 'scalar', value: body + tail, plain: false };
};

const parseNested = (children: readonly string[]): YamlValue => {
  const contentLines = children.filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  const listMatches = contentLines.map((line) => LIST_ITEM.exec(line));
  const listIndents = new Set(listMatches.map((listMatch) => listMatch?.[1]));
  if (listMatches.every((listMatch) => listMatch !== null) && listIndents.size === 1) {
    const items: string[] = [];
    for (const listMatch of listMatches) {
      const item = parseInlineScalar(listMatch?.[2] ?? '');
      if (item.kind !== 'scalar') {
        return { kind: 'unreadable', reason: 'リストの要素が単純な値ではない' };
      }
      items.push(item.value);
    }
    return { kind: 'list', items };
  }
  const entryMatches = contentLines.map((line) => MAP_ENTRY.exec(line));
  const entryIndents = new Set(entryMatches.map((entryMatch) => entryMatch?.[1]));
  if (entryMatches.every((entryMatch) => entryMatch !== null) && entryIndents.size === 1) {
    const entries = new Map<string, Scalar>();
    for (const entryMatch of entryMatches) {
      const key = entryMatch?.[2] ?? '';
      const value = parseInlineScalar(entryMatch?.[3] ?? '');
      if (value.kind !== 'scalar' || entries.has(key)) {
        return { kind: 'unreadable', reason: '対応の値が単純な文字列でないか、キーが重複している' };
      }
      entries.set(key, { value: value.value, plain: value.plain });
    }
    return { kind: 'map', entries };
  }
  return { kind: 'unreadable', reason: '入れ子の構造が、1 段の単純なリストか対応ではない' };
};

const parseFrontmatter = (text: string): Frontmatter => {
  if (text.startsWith('\uFEFF')) {
    return { kind: 'missing', reason: '先頭に BOM がある。1 行目を --- にする' };
  }
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') {
    return { kind: 'missing', reason: '1 行目が --- ではない。frontmatter は 1 行目の --- から始める' };
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (closing === -1) {
    return { kind: 'missing', reason: 'frontmatter を閉じる --- がない' };
  }
  const yamlLines = lines.slice(1, closing);
  const bodyLines = lines.slice(closing + 1);
  if (bodyLines.at(-1) === '') {
    bodyLines.pop();
  }

  const fields = new Map<string, YamlField>();
  const findings: Finding[] = [];
  let i = 0;
  while (i < yamlLines.length) {
    const line = yamlLines[i] ?? '';
    const lineNumber = i + 2;
    i++;
    if (line.trim() === '' || /^\s*#/.test(line)) {
      continue;
    }
    if (/^\s/.test(line)) {
      findings.push(finding('unverifiable', 'yaml', `${String(lineNumber)} 行目: どのキーにも属さない字下げ行（複数行の引用符なしの値など）`));
      continue;
    }
    const keyLine = KEY_LINE.exec(line);
    if (keyLine === null) {
      findings.push(finding('unverifiable', 'yaml', `${String(lineNumber)} 行目: "key: value" の形として読めない`));
      continue;
    }
    const key = keyLine[1] ?? '';
    const rest = keyLine[2] ?? '';
    const children: string[] = [];
    while (i < yamlLines.length && /^(?:\s|$)/.test(yamlLines[i] ?? '')) {
      children.push(yamlLines[i] ?? '');
      i++;
    }
    const hasChildren = children.some((child) => child.trim() !== '');
    let value: YamlValue;
    if (/^[|>]/.test(rest)) {
      value = parseBlockScalar(rest, children);
    } else if (stripComment(rest) === '') {
      value = hasChildren ? parseNested(children) : { kind: 'scalar', value: '', plain: true };
    } else if (hasChildren) {
      value = { kind: 'unreadable', reason: '値が複数行にわたっている（引用符なし・引用符つきの複数行は扱わない）' };
    } else {
      value = parseInlineScalar(rest);
    }
    if (fields.has(key)) {
      findings.push(finding('error', 'yaml', `${String(lineNumber)} 行目: キー ${key} が重複している`));
      continue;
    }
    fields.set(key, { value, line: lineNumber });
  }
  return { kind: 'present', fields, findings, body: bodyLines.join('\n'), bodyLines: bodyLines.length };
};

const reportUnreadable = (kind: Kind, fields: ReadonlyMap<string, YamlField>, findings: Finding[]): void => {
  for (const [key, field] of fields) {
    if (field.value.kind !== 'unreadable') {
      continue;
    }
    const message = `${String(field.line)} 行目 ${key}: ${field.value.reason}`;
    if (kind === 'B' && UPLOAD_ONLY_FIELDS.has(key)) {
      findings.push(finding('warning', 'yaml', `${message}（Claude Code はこの値を使わない。claude.ai・API へアップロードするなら直す）`));
    } else {
      findings.push(finding('unverifiable', 'yaml', message));
    }
  }
};

const isNonStringPlain = (scalar: Scalar): boolean => {
  return scalar.plain && scalar.value !== '' && NON_STRING_PLAIN.test(scalar.value);
};

const stringField = (
  fields: ReadonlyMap<string, YamlField>,
  key: string,
  findings: Finding[],
  options: { readonly required: boolean; readonly nonStringSeverity: Severity },
): string | null => {
  const value = fields.get(key)?.value;
  if (value === undefined) {
    if (options.required) {
      findings.push(finding('error', key, `${key} がない`));
    }
    return null;
  }
  if (value.kind === 'unreadable') {
    if (options.required) {
      findings.push(finding('unverifiable', key, `${key} の値を読めないので、この項目は検査していない`));
    }
    return null;
  }
  if (value.kind !== 'scalar') {
    findings.push(finding(options.nonStringSeverity, key, `${key} が文字列ではない（${value.kind}）`));
    return null;
  }
  if (isNonStringPlain(value)) {
    findings.push(finding(options.nonStringSeverity, key, `${key} の値 ${value.value} は YAML 1.1 では文字列以外（真偽値・数値・日付など）として読まれる。引用符で囲む`));
    return null;
  }
  return value.value;
};

const checkName = (kind: Kind, name: string, directoryName: string, findings: Finding[]): void => {
  const length = charLength(name);
  if (length < 1 || length > NAME_MAX_LENGTH) {
    findings.push(finding('error', 'name', `name は 1〜${String(NAME_MAX_LENGTH)} 文字にする（${String(length)} 文字）`));
  }
  if (!NAME_PATTERN.test(name)) {
    findings.push(finding('error', 'name', `name "${name}" は a-z・0-9・- だけで書き、先頭・末尾のハイフンと -- を避ける`));
  }
  if (name !== directoryName) {
    findings.push(finding('error', 'name', `name "${name}" がディレクトリ名 "${directoryName}" と一致しない`));
  }
  const lowered = name.toLowerCase();
  if (RESERVED_NAMES.has(lowered)) {
    findings.push(finding('error', 'reserved-name', `name "${name}" は Claude Code が読み込まない予約名`));
  }
  for (const part of FORBIDDEN_NAME_PARTS) {
    if (lowered.includes(part)) {
      findings.push(finding(kind === 'A' ? 'error' : 'warning', 'reserved-name', `name に "${part}" を含めない（claude.ai へのアップロードと Skills API では error になる）`));
    }
  }
};

const checkFields = (kind: Kind, fields: ReadonlyMap<string, YamlField>, findings: Finding[]): void => {
  const uploadSeverity = kind === 'A' ? 'error' : 'warning';
  for (const key of fields.keys()) {
    if (kind === 'A') {
      if (!SPEC_FIELDS.has(key)) {
        findings.push(finding('error', 'fields', `種類 A では仕様の 6 フィールド以外を使わない: ${key}`));
      } else if (key === 'allowed-tools') {
        const listNote = fields.get(key)?.value.kind === 'list' ? '。仕様の形は空白区切りの文字列で、YAML のリストではない' : '';
        findings.push(finding('warning', 'fields', `種類 A では allowed-tools を使わない（仕様で Experimental、非対応のクライアントがある）${listNote}`));
      }
      continue;
    }
    if (!CLAUDE_CODE_FIELDS.has(key)) {
      findings.push(finding('warning', 'fields', `Claude Code が認識しないキー（黙って無視される）: ${key}`));
    } else if (key === 'hooks') {
      findings.push(finding('warning', 'fields', 'hooks を使っている。プロジェクトがフックを使わない方針なら外す'));
    }
  }
  if (kind === 'A') {
    stringField(fields, 'license', findings, { required: false, nonStringSeverity: 'error' });
  }
  const compatibility = stringField(fields, 'compatibility', findings, { required: false, nonStringSeverity: uploadSeverity });
  if (compatibility !== null) {
    const length = charLength(compatibility);
    if (compatibility.trim() === '' || length > COMPATIBILITY_MAX_LENGTH) {
      findings.push(finding(uploadSeverity, 'compatibility', `compatibility は空でない 1〜${String(COMPATIBILITY_MAX_LENGTH)} 文字にする（${String(length)} 文字）`));
    }
  }
  const metadata = fields.get('metadata')?.value;
  if (metadata?.kind === 'map') {
    for (const [key, value] of metadata.entries) {
      if (isNonStringPlain(value)) {
        findings.push(finding(uploadSeverity, 'metadata', `metadata.${key} の値 ${value.value} は YAML 1.1 では文字列以外として読まれる。引用符で囲む`));
      }
    }
  } else if (metadata !== undefined && metadata.kind !== 'unreadable') {
    findings.push(finding(uploadSeverity, 'metadata', 'metadata は「文字列のキー → 文字列の値」の対応にする'));
  }
};

const indentWidth = (prefix: string): number => {
  let width = 0;
  for (const character of prefix) {
    if (character === '\t') {
      width += 4 - (width % 4);
    } else if (character === ' ') {
      width++;
    }
  }
  return width;
};

const stripCodeBlocks = (body: string): string => {
  const kept: string[] = [];
  let fence: { readonly char: string; readonly length: number; readonly inList: boolean } | null = null;
  let inIndentedCode = false;
  let previousBlank = true;
  let inList = false;
  for (const line of body.split('\n')) {
    if (fence !== null) {
      const closing = CLOSING_FENCE.exec(line);
      const closingMarker = closing?.[2] ?? '';
      const closingIndentOk = fence.inList || indentWidth(closing?.[1] ?? '') <= 3;
      if (closingIndentOk && closingMarker.charAt(0) === fence.char && closingMarker.length >= fence.length) {
        fence = null;
        previousBlank = true;
      }
      continue;
    }
    const blank = line.trim() === '';
    const indented = INDENTED_CODE.test(line);
    if (inIndentedCode) {
      if (blank || indented) {
        continue;
      }
      inIndentedCode = false;
    }
    // CommonMark の字下げコードブロックは段落を割り込めず、リストの中の字下げはリストの続きになる
    if (indented && !blank && previousBlank && !inList) {
      inIndentedCode = true;
      continue;
    }
    const opening = OPENING_FENCE.exec(line);
    const marker = opening?.[2] ?? '';
    const info = opening?.[3] ?? '';
    const openingIndentOk = inList || indentWidth(opening?.[1] ?? '') <= 3;
    // バッククォートのフェンスの情報文字列にはバッククォートを含められない（CommonMark）
    if (opening !== null && openingIndentOk && !(marker.startsWith('`') && info.includes('`'))) {
      fence = { char: marker.charAt(0), length: marker.length, inList };
      continue;
    }
    if (!blank) {
      if (LIST_MARKER.test(line)) {
        inList = true;
      } else if (previousBlank && !/^[ \t]/.test(line)) {
        inList = false;
      }
    }
    kept.push(line);
    previousBlank = blank || HEADING.test(line);
  }
  return kept.join('\n');
};

const paragraphs = (text: string): string[] => {
  return text.split(/\n[ \t]*\n/);
};

const toSkillRelative = (kind: Kind, path: string): string | null => {
  if (kind === 'B' && path.startsWith(SKILL_DIR_PREFIX)) {
    return path.slice(SKILL_DIR_PREFIX.length);
  }
  return path.includes('$') ? null : path;
};

const checkSubstitutions = (kind: Kind, body: string, findings: Finding[]): void => {
  if (kind === 'A' && body.includes(SKILL_DIR_VARIABLE)) {
    findings.push(finding('error', 'substitution', `本文に ${SKILL_DIR_VARIABLE} がある。Claude Code はコードの中も含めて置き換え、ほかのエージェントでは置き換わらない。同梱ファイルはスキルのルートからの相対パスで書き、変数の説明は言葉か references/ に書く`));
  }
  if (INLINE_INJECTION.test(body) || BLOCK_INJECTION.test(body)) {
    const message = '本文に ! + バッククォートの差し込み（行頭か空白の直後）か ```! のブロックがある。Claude Code はコードブロックやインラインコードの中でも、スキルを読み込むときに実行する';
    if (kind === 'A') {
      findings.push(finding('error', 'substitution', `${message}。種類 A では claude.ai と API で動かず、Cowork ではプレースホルダーになる`));
    } else {
      findings.push(finding('warning', 'substitution', `${message}。意図した差し込みでなければ、言葉で説明するか references/ に移す`));
    }
  }
};

const checkReferences = (kind: Kind, root: string, text: string, findings: Finding[]): void => {
  const targets = new Set<string>();
  for (const paragraph of paragraphs(text)) {
    for (const link of paragraph.replace(CODE_SPAN, '').matchAll(MARKDOWN_LINK)) {
      const target = toSkillRelative(kind, link[1] ?? '');
      if (target !== null) {
        targets.add(target);
      }
    }
    for (const span of paragraph.matchAll(CODE_SPAN)) {
      for (const token of (span[2] ?? '').split(/\s+/)) {
        const candidate = toSkillRelative(kind, token.replace(/^["']+|["']+$/g, ''));
        if (candidate !== null && BUNDLED_PATH.test(candidate)) {
          targets.add(candidate);
        }
      }
    }
  }
  for (const target of targets) {
    if (target === '' || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    if (target.includes('\\')) {
      findings.push(finding('error', 'references', `パスにバックスラッシュがある: ${target}（スラッシュで書く）`));
      continue;
    }
    let path: string;
    try {
      path = decodeURI(target.split('#')[0] ?? '');
    } catch (_e) {
      findings.push(finding('error', 'references', `リンクの % エンコードが不正: ${target}`));
      continue;
    }
    if (isAbsolute(path)) {
      findings.push(finding('warning', 'references', `絶対パスで参照している: ${target}（スキルのルートからの相対パスにする）`));
      continue;
    }
    const resolved = resolve(root, path);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      findings.push(finding('warning', 'references', `スキルの外を参照している: ${target}（配布先では見つからない）`));
      continue;
    }
    if (!existsSync(resolved)) {
      findings.push(finding('error', 'references', `参照先がない: ${target}`));
    }
  }
};

const validateSkillUnsafe = (skillPath: string, root: string, kind: Kind, findings: Finding[]): number | null => {
  const directoryName = basename(resolve(skillPath));
  const { skillFiles, symlinks } = findSkillFiles(root);
  if (!skillFiles.includes('SKILL.md')) {
    findings.push(finding('error', 'skill-md', 'ルートに SKILL.md がない（ファイル名は大文字で SKILL.md）'));
  }
  const extra = skillFiles.filter((file) => file !== 'SKILL.md');
  if (extra.length > 0) {
    findings.push(finding('error', 'skill-md', `SKILL.md はルートの 1 つだけにする。ほかに見つかった: ${extra.join(', ')}`));
  }
  for (const link of symlinks) {
    findings.push(finding('warning', 'symlink', `シンボリックリンク ${link} の先は検査していない。配布や入れ直しで壊れやすいので、実体のファイルにする`));
  }
  if (!skillFiles.includes('SKILL.md')) {
    return null;
  }

  const frontmatter = parseFrontmatter(readFileSync(join(root, 'SKILL.md'), 'utf8'));
  if (frontmatter.kind === 'missing') {
    findings.push(finding('error', 'frontmatter', frontmatter.reason));
    return null;
  }
  findings.push(...frontmatter.findings);
  const { fields } = frontmatter;
  reportUnreadable(kind, fields, findings);
  const name = stringField(fields, 'name', findings, { required: true, nonStringSeverity: 'error' });
  if (name !== null) {
    checkName(kind, name, directoryName, findings);
  }
  const description = stringField(fields, 'description', findings, { required: true, nonStringSeverity: 'error' });
  if (description !== null) {
    const length = charLength(description);
    if (description.trim() === '') {
      findings.push(finding('error', 'description', 'description を空にしない'));
    } else if (length > DESCRIPTION_MAX_LENGTH) {
      findings.push(finding(kind === 'A' ? 'error' : 'warning', 'description', `description は ${String(DESCRIPTION_MAX_LENGTH)} 文字以内にする（${String(length)} 文字。claude.ai へのアップロードと Skills API では error になる）`));
    }
    if (/[<>]/.test(description)) {
      findings.push(finding(kind === 'A' ? 'error' : 'warning', 'description', 'description に < と > を含めない（claude.ai へのアップロードと Skills API の検査で拒否される）'));
    }
    const whenToUse = fields.get('when_to_use')?.value;
    const extraLength = whenToUse?.kind === 'scalar' ? charLength(whenToUse.value) : 0;
    if (kind === 'B' && length + extraLength > LISTING_MAX_LENGTH) {
      findings.push(finding('warning', 'description', `description と when_to_use の合計が ${String(LISTING_MAX_LENGTH)} 文字を超え、一覧では切り詰められる`));
    }
  }
  checkFields(kind, fields, findings);
  checkSubstitutions(kind, frontmatter.body, findings);
  checkReferences(kind, root, stripCodeBlocks(frontmatter.body), findings);
  if (frontmatter.bodyLines >= BODY_LINE_LIMIT) {
    findings.push(finding('warning', 'body-length', `本文が ${String(frontmatter.bodyLines)} 行ある。${String(BODY_LINE_LIMIT)} 行未満にし、詳細は references/ に分ける`));
  }
  return frontmatter.bodyLines;
};

const validateSkill = (skillPath: string, kind: Kind): SkillReport => {
  const path = resolve(skillPath);
  const findings: Finding[] = [];
  let realPath: string | null = null;
  let bodyLines: number | null = null;
  try {
    const resolvedRoot = realpathSync(path);
    realPath = resolvedRoot === path ? null : resolvedRoot;
    bodyLines = validateSkillUnsafe(skillPath, resolvedRoot, kind, findings);
  } catch (e) {
    findings.push(finding('unverifiable', 'internal', `検査の途中で失敗したので、このスキルは検査できていない: ${describeError(e)}`));
  }
  const ok = findings.every((item) => item.severity === 'warning');
  return { path, realPath, kind, ok, bodyLines, findings };
};

const parseCommandLine = (args: readonly string[]) => {
  return parseArgs({
    args: [...args],
    options: { kind: { type: 'string' }, help: { type: 'boolean' } },
    allowPositionals: true,
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
  if (parsed.values.help === true) {
    stdout.write(HELP);
    return EXIT_OK;
  }
  const kindOption = parsed.values.kind?.toUpperCase();
  if (kindOption !== 'A' && kindOption !== 'B') {
    stderr.write(`Error: --kind には A か B を指定する（受け取った値: ${parsed.values.kind ?? 'なし'}）\n例: node <skill-builder のディレクトリ>/scripts/validate-skill.mts --kind A /path/to/skills/my-skill\n`);
    return EXIT_USAGE;
  }
  if (parsed.positionals.length === 0) {
    stderr.write('Error: 検査するスキルのディレクトリを 1 つ以上指定する\n例: node <skill-builder のディレクトリ>/scripts/validate-skill.mts --kind A /path/to/skills/my-skill\n');
    return EXIT_USAGE;
  }
  const notDirectories = parsed.positionals.filter((path) => {
    try {
      return !statSync(path).isDirectory();
    } catch (_e) {
      return true;
    }
  });
  if (notDirectories.length > 0) {
    stderr.write(
      `Error: ディレクトリとして見つからない: ${notDirectories.map((path) => resolve(path)).join(', ')}\nスキルのディレクトリ（SKILL.md を含むもの）を絶対パスで指定する。リンク切れのシンボリックリンクでないかも確かめる\n`,
    );
    return EXIT_USAGE;
  }

  const reports = parsed.positionals.map((path) => validateSkill(path, kindOption));
  for (const report of reports) {
    const count = (severity: Severity): number => report.findings.filter((item) => item.severity === severity).length;
    const linkNote = report.realPath === null ? '' : `（シンボリックリンク。実体 ${report.realPath} を検査した）`;
    stderr.write(`${report.ok ? 'OK' : 'NG'} ${report.path}${linkNote}: error ${String(count('error'))}, unverifiable ${String(count('unverifiable'))}, warning ${String(count('warning'))}\n`);
  }
  const ok = reports.every((report) => report.ok);
  stdout.write(`${JSON.stringify({ ok, results: reports }, null, 2)}\n`);
  return ok ? EXIT_OK : EXIT_PROBLEM;
};

try {
  process.exitCode = main();
} catch (e) {
  stderr.write(`Error: 検査の途中で失敗した: ${describeError(e)}\n`);
  process.exitCode = EXIT_PROBLEM;
}
