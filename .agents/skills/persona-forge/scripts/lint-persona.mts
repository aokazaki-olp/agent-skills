import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process, { argv, stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';

type Kind = 'maker' | 'user';
type Severity = 'error' | 'warning';

interface Finding {
  readonly severity: Severity;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
}

interface TableRow {
  readonly cells: ReadonlyMap<string, string>;
  readonly line: number;
}

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
}

interface Section {
  readonly title: string;
  readonly line: number;
  readonly body: readonly string[];
  /** 直前の `##` 見出しの文字列。なければ null */
  readonly parent: string | null;
}

type KindDetection = { readonly kind: 'detected'; readonly value: Kind } | { readonly kind: 'ambiguous'; readonly reason: string };

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;

const REQUIRED_FILES = {
  maker: [
    'PERSONA.md',
    'bio.md',
    'translation.md',
    'memories.md',
    'tensions.md',
    'signatures.md',
    'dislikes.md',
    'voice.md',
    'research.md',
    'log.md',
    'moodboard/README.md',
  ],
  user: [
    'PERSONA.md',
    'profile.md',
    'context.md',
    'translation.md',
    'journeys.md',
    'moments.md',
    'memories.md',
    'voice.md',
    'research.md',
    'log.md',
  ],
} as const satisfies Record<Kind, readonly string[]>;

const SOURCE_FILES = {
  maker: ['bio.md'],
  user: ['profile.md', 'context.md'],
} as const satisfies Record<Kind, readonly string[]>;

const MONOLOGUE_HEADING = {
  maker: '独り言サンプル',
  user: '思考発話サンプル',
} as const satisfies Record<Kind, string>;

const PERSONA_HEADINGS = ['演じるときに読むファイル', '作業前の儀式', '出力の約束', '提出前の自己批評'];

// 判断の欄に出てきたら、守れたかを判定できない語
const VAGUE_WORDS = [
  'モダン',
  'クリーン',
  '洗練',
  'おしゃれ',
  'オシャレ',
  'センスの良い',
  'センスがいい',
  'いい感じ',
  '良い感じ',
  'スタイリッシュ',
  '高級感',
  'シンプルに',
  'ミニマル',
  'かっこいい',
  'カッコいい',
  'エレガント',
  'こなれた',
  '統一感',
  '直感的',
  '使いやすい',
  '使いやすく',
  '分かりやすい',
  '分かりやすく',
  'わかりやすい',
  'わかりやすく',
  'シームレス',
  'スムーズ',
  'ユーザーフレンドリー',
  '快適',
];

const LOG_ID_PREFIXES = {
  maker: 'TMSD',
  user: 'TMJGF',
} as const satisfies Record<Kind, string>;

const RESEARCH_KINDS = new Set(['公式', '当事者', '統計', '統計（宣伝目的）', '報道', '一次データ']);

// 日本語の短いルール（「強調は1画面に1つまで」は 11 文字）を誤検出しない長さ
const DECISION_MIN_LENGTH = 8;
const SIGNATURES_MIN = 2;
const SIGNATURES_MAX = 3;
const MEMORIES_MIN = 3;
const MEMORIES_MAX = 5;
const MONOLOGUE_MIN = 3;
const UNTAGGED_RATIO_MAX = 0.5;

const EVIDENCE = /〔(?:(?:出典|推測)[:：]\s*R\d+(?:\s*[,、]\s*R\d+)*|仮|設計|指定)〕/;
const EVIDENCE_IDS = /〔(?:出典|推測)[:：]\s*(R\d+(?:\s*[,、]\s*R\d+)*)〕/g;
const PROVISIONAL = /〔仮〕/g;
const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const TAG = /\[(T\d+)\]/g;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const ITEM_OR_HEADING = /^\s*(?:[-*+]\s|\d+[.)]\s|###\s)/;
const RETIRED = /^\s*-\s*廃止[:：]\s*(.+)$/gm;
const RULE_ID_IN_TEXT = /(?<![A-Za-z0-9])([TMSDJGF]\d+)(?![A-Za-z0-9])/g;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const HELP = `Usage: node <persona-forge のディレクトリ>/scripts/lint-persona.mts [--rules] <persona-dir>

ペルソナのディレクトリ（personas/<slug>/）を検査し、結果を JSON で stdout に出す（path は絶対パス）。要約は stderr。
作業ディレクトリには依存しない。<persona-dir> は絶対パスで渡すと取り違えない。
種類は、bio.md があれば作り手、profile.md があれば使い手と判定する。

検査:
  error    必須のファイル / 未記入の {{...}} / 根拠の区別（〔出典: R#〕〔推測: R#〕〔指定〕〔設計〕〔仮〕）のない項目 /
           research.md にない R# / research.md の行の形 / [T#] と translation.md の行の対応 / 空の感性・判断 /
           記憶の M# と「今の判断」と translation.md の行 / サイン・嫌悪・道のり・瞬間の判断や理由 /
           独り言・思考発話のサンプルの数 / PERSONA.md の必須の見出し / ID の重複
  warning  判断の曖昧な語・短すぎる判断 / 〔仮〕の残り / 個数の目安 / bio.md のタグなしの項目の割合 /
           log.md の未定義の ID / bio・profile・context にタグのない translation.md の T 行

Options:
  --rules  検査せず、判定役に渡すルール表（ID・ファイル・ルール）を Markdown で stdout に出す。
           人物像（由来・感性・記憶・心の声）は含めない。終了コードは 0（種類を判定できなければ 2）
  --help   この説明を出す

Exit codes:
  0  error がない（warning はあってよい）
  1  error がある。検査の途中で失敗したときも 1 で、stdout の JSON の ok が null になる
  2  使い方の誤り（ディレクトリがない、種類を判定できない など）

Examples:
  node /path/to/persona-forge/scripts/lint-persona.mts /path/to/project/personas/minato
  node /path/to/persona-forge/scripts/lint-persona.mts --rules /path/to/project/personas/minato
`;

const describeError = (e: unknown): string => {
  return Error.isError(e) ? e.message : String(e);
};

/** HTML コメントを、行番号が変わらないよう改行だけ残して消す */
const stripComments = (text: string): string => {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ''));
};

const splitLines = (text: string): string[] => {
  return text.split(/\r?\n/);
};

/** セルに分ける。`\|` は区切りではなく、セルの中の `|` として扱う */
const parseCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
};

const isSeparatorRow = (cells: readonly string[]): boolean => {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
};

const parseTables = (text: string): Table[] => {
  const tables: Table[] = [];
  const lines = splitLines(text);
  let index = 0;
  while (index < lines.length) {
    if (!(lines[index] ?? '').trim().startsWith('|')) {
      index += 1;
      continue;
    }
    const header = parseCells(lines[index] ?? '');
    const rows: TableRow[] = [];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
      const cells = parseCells(lines[index] ?? '');
      if (!isSeparatorRow(cells)) {
        rows.push({ cells: new Map(header.map((name, column) => [name, cells[column] ?? ''])), line: index + 1 });
      }
      index += 1;
    }
    tables.push({ header, rows });
  }
  return tables;
};

/** 列がそろった表をすべて探し、行をつなげて返す */
const findRows = (text: string, columns: readonly string[]): TableRow[] => {
  return parseTables(text)
    .filter((table) => columns.every((column) => table.header.includes(column)))
    .flatMap((table) => table.rows);
};

/** `###` の見出しごとに分ける。`#` か `##` の見出しでも区切る */
const parseSections = (text: string): Section[] => {
  const sections: Section[] = [];
  let current: { title: string; line: number; body: string[]; parent: string | null } | null = null;
  let parent: string | null = null;
  for (const [index, line] of splitLines(text).entries()) {
    const level3 = /^###\s+(.*)$/.exec(line);
    if (level3 !== null) {
      if (current !== null) {
        sections.push(current);
      }
      current = { title: (level3[1] ?? '').trim(), line: index + 1, body: [], parent };
      continue;
    }
    const upper = /^#{1,2}\s+(.*)$/.exec(line);
    if (upper !== null) {
      if (current !== null) {
        sections.push(current);
      }
      current = null;
      parent = line.startsWith('## ') ? (upper[1] ?? '').trim() : null;
      continue;
    }
    if (current !== null) {
      current.body.push(line);
    }
  }
  if (current !== null) {
    sections.push(current);
  }
  return sections;
};

/** `## 見出し` の下の行（次の `#`・`##` の見出しまで）を返す。見出しがなければ null */
const findPart = (text: string, heading: string): string[] | null => {
  const lines = splitLines(text);
  const start = lines.findIndex((line) => /^##\s/.test(line) && line.includes(heading));
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
};

const fieldValue = (body: readonly string[], label: string): string | null => {
  const pattern = new RegExp(`^\\s*-\\s*${label}[:：]\\s*(.*)$`);
  for (const line of body) {
    const match = pattern.exec(line);
    if (match !== null) {
      return (match[1] ?? '').trim();
    }
  }
  return null;
};

const sectionId = (title: string, prefix: string): string | null => {
  const match = new RegExp(`^(${prefix}\\d+)(?![0-9])`).exec(title);
  return match === null ? null : (match[1] ?? null);
};

const detectKind = (directory: string): KindDetection => {
  const hasBio = existsSync(join(directory, 'bio.md'));
  const hasProfile = existsSync(join(directory, 'profile.md'));
  if (hasBio && !hasProfile) {
    return { kind: 'detected', value: 'maker' };
  }
  if (hasProfile && !hasBio) {
    return { kind: 'detected', value: 'user' };
  }
  return {
    kind: 'ambiguous',
    reason: hasBio ? 'bio.md と profile.md の両方がある。作り手なら profile.md を、使い手なら bio.md を消すか移す' : 'bio.md も profile.md もない。作り手なら bio.md、使い手なら profile.md を置く',
  };
};

const lint = (directory: string, kind: Kind): Finding[] => {
  const findings: Finding[] = [];
  const add = (severity: Severity, file: string, line: number | null, message: string): void => {
    findings.push({ severity, file, line, message });
  };

  const files = new Map<string, string>();
  for (const name of REQUIRED_FILES[kind]) {
    const path = join(directory, name);
    if (!existsSync(path)) {
      add('error', name, null, 'ファイルがない。雛形から作る');
      continue;
    }
    files.set(name, stripComments(readFileSync(path, 'utf8')));
  }

  // 未記入と仮
  for (const [name, text] of files) {
    const placeholders = text.match(PLACEHOLDER) ?? [];
    if (placeholders.length > 0) {
      add('error', name, null, `雛形の未記入箇所 {{...}} が ${String(placeholders.length)} 個残っている`);
    }
    // 説明文の〔仮〕は数えず、項目と見出しの〔仮〕だけを数える
    const provisional = splitLines(text)
      .filter((line) => ITEM_OR_HEADING.test(line))
      .flatMap((line) => line.match(PROVISIONAL) ?? []);
    if (provisional.length > 0) {
      add('warning', name, null, `〔仮〕が ${String(provisional.length)} 個残っている。ユーザーに確かめるか、調査で根拠を付ける`);
    }
  }

  // 調査の出典
  const researchIds = new Set<string>();
  const research = files.get('research.md');
  if (research !== undefined) {
    const rows = findRows(research, ['ID', '主張', '出典', '取得日', '種別']);
    if (rows.length === 0) {
      add('error', 'research.md', null, '出典の表（ID・主張・出典・取得日・種別）に行がない。調査をしてから書く');
    } else {
      for (const row of rows) {
        const id = row.cells.get('ID') ?? '';
        if (!/^R\d+$/.test(id)) {
          add('error', 'research.md', row.line, `ID が R# の形でない（${id}）`);
          continue;
        }
        if (researchIds.has(id)) {
          add('error', 'research.md', row.line, `${id} が重複している`);
        }
        researchIds.add(id);
        if ((row.cells.get('主張') ?? '') === '' || (row.cells.get('出典') ?? '') === '') {
          add('error', 'research.md', row.line, `${id} の主張か出典が空`);
        }
        if (!DATE.test(row.cells.get('取得日') ?? '')) {
          add('error', 'research.md', row.line, `${id} の取得日が YYYY-MM-DD でない（${row.cells.get('取得日') ?? ''}）`);
        }
        if (!RESEARCH_KINDS.has(row.cells.get('種別') ?? '')) {
          add('error', 'research.md', row.line, `${id} の種別が ${[...RESEARCH_KINDS].join('・')} のどれでもない（${row.cells.get('種別') ?? ''}）`);
        }
      }
    }
  }

  const checkEvidence = (file: string, line: number, text: string): void => {
    if (!EVIDENCE.test(text)) {
      add('error', file, line, '根拠の区別（〔出典: R#〕〔推測: R#〕〔指定〕〔設計〕〔仮〕）がない');
    }
    for (const match of text.matchAll(EVIDENCE_IDS)) {
      for (const id of (match[1] ?? '').split(/\s*[,、]\s*/)) {
        if (!researchIds.has(id)) {
          add('error', file, line, `${id} が research.md にない`);
        }
      }
    }
  };

  // 根拠の区別と、設定のタグ
  const tags = new Set<string>();
  let listItems = 0;
  let untaggedItems = 0;
  for (const name of SOURCE_FILES[kind]) {
    const text = files.get(name);
    if (text === undefined) {
      continue;
    }
    for (const [index, line] of splitLines(text).entries()) {
      if (!LIST_ITEM.test(line)) {
        continue;
      }
      listItems += 1;
      checkEvidence(name, index + 1, line);
      const lineTags = [...line.matchAll(TAG)].map((match) => match[1] ?? '');
      if (lineTags.length === 0) {
        untaggedItems += 1;
      }
      for (const tag of lineTags) {
        if (tags.has(tag)) {
          add('error', name, index + 1, `[${tag}] が重複している`);
        }
        tags.add(tag);
      }
    }
  }
  if (kind === 'maker' && listItems > 0 && untaggedItems / listItems > UNTAGGED_RATIO_MAX) {
    add('warning', 'bio.md', null, `タグのない項目が半分を超えている（${String(untaggedItems)}/${String(listItems)}）。判断に接続できないか見直す`);
  }
  if (tags.size === 0 && listItems > 0) {
    add('error', SOURCE_FILES[kind].join('・'), null, '[T#] のタグが 1 つもない。判断に効かせる設定にタグを付ける');
  }

  const checkDecision = (file: string, line: number | null, id: string, decision: string): void => {
    if (decision === '') {
      add('error', file, line, `${id} の判断が空`);
      return;
    }
    if (decision.length < DECISION_MIN_LENGTH) {
      add('warning', file, line, `${id} の判断が短い（${decision}）。第三者が守れたかを判定できるルールになっているか確かめる`);
    }
    const vague = VAGUE_WORDS.filter((word) => decision.includes(word));
    if (vague.length > 0) {
      add('warning', file, line, `${id} の判断に曖昧な語がある（${vague.join('、')}）。数値・個数・位置・禁止で書き直す`);
    }
  };

  const definedIds = new Set<string>(researchIds);
  const defineId = (file: string, line: number, id: string): void => {
    if (definedIds.has(id)) {
      add('error', file, line, `${id} が重複している`);
    }
    definedIds.add(id);
  };

  // 判断のルール表
  const translationIds = new Set<string>();
  const translation = files.get('translation.md');
  if (translation !== undefined) {
    const rows = findRows(translation, ['ID', '由来', '感性', '判断']);
    if (rows.length === 0) {
      add('error', 'translation.md', null, 'ルールの表（ID・由来・感性・判断）に行がない');
    } else {
      for (const row of rows) {
        const id = row.cells.get('ID') ?? '';
        if (!/^[TM]\d+$/.test(id)) {
          add('error', 'translation.md', row.line, `ID が T# か M# の形でない（${id}）`);
          continue;
        }
        defineId('translation.md', row.line, id);
        translationIds.add(id);
        if ((row.cells.get('感性') ?? '') === '') {
          add('error', 'translation.md', row.line, `${id} の感性が空。設定と判断の間に橋を架ける`);
        }
        checkDecision('translation.md', row.line, id, row.cells.get('判断') ?? '');
        if (id.startsWith('T') && !tags.has(id)) {
          add('warning', 'translation.md', row.line, `${id} に対応する [${id}] が ${SOURCE_FILES[kind].join('・')} にない`);
        }
      }
    }
    for (const tag of tags) {
      if (!translationIds.has(tag)) {
        add('error', 'translation.md', null, `[${tag}] に対応する行がない`);
      }
    }
  }

  // 記憶
  const memories = files.get('memories.md');
  if (memories !== undefined) {
    const memoryIds = new Set<string>();
    const sections = parseSections(memories);
    if (sections.length < MEMORIES_MIN || sections.length > MEMORIES_MAX) {
      add('warning', 'memories.md', null, `記憶は ${String(MEMORIES_MIN)}〜${String(MEMORIES_MAX)} 個が目安（いま ${String(sections.length)} 個）`);
    }
    for (const section of sections) {
      const id = sectionId(section.title, 'M');
      if (id === null) {
        add('error', 'memories.md', section.line, `見出しが M# で始まっていない（${section.title}）`);
        continue;
      }
      if (memoryIds.has(id)) {
        add('error', 'memories.md', section.line, `${id} が重複している`);
      }
      memoryIds.add(id);
      const decision = fieldValue(section.body, '今の判断');
      if (decision === null || decision === '') {
        add('error', 'memories.md', section.line, `${id} に「今の判断」がない`);
      } else {
        checkDecision('memories.md', section.line, id, decision);
      }
      if (translation !== undefined && !translationIds.has(id)) {
        add('error', 'translation.md', null, `記憶 ${id} の行がない。演じるときは memories.md を読まないので、ここにないと効かない`);
      }
    }
    for (const id of translationIds) {
      if (id.startsWith('M') && !memoryIds.has(id)) {
        add('error', 'translation.md', null, `${id} の行に対応する記憶が memories.md にない`);
      }
    }
  }

  if (kind === 'maker') {
    const signatures = files.get('signatures.md');
    if (signatures !== undefined) {
      const sections = parseSections(signatures);
      if (sections.length < SIGNATURES_MIN || sections.length > SIGNATURES_MAX) {
        add('warning', 'signatures.md', null, `サインは ${String(SIGNATURES_MIN)}〜${String(SIGNATURES_MAX)} 個が目安（いま ${String(sections.length)} 個）`);
      }
      for (const section of sections) {
        const id = sectionId(section.title, 'S');
        if (id === null) {
          add('error', 'signatures.md', section.line, `見出しが S# で始まっていない（${section.title}）`);
          continue;
        }
        defineId('signatures.md', section.line, id);
        checkDecision('signatures.md', section.line, id, section.body.join(' ').trim());
      }
    }
    const dislikes = files.get('dislikes.md');
    if (dislikes !== undefined) {
      const rows = findRows(dislikes, ['ID', '嫌いなもの', '理由']);
      if (rows.length === 0) {
        add('error', 'dislikes.md', null, '表（ID・嫌いなもの・理由）に行がない');
      } else {
        for (const row of rows) {
          const id = row.cells.get('ID') ?? '';
          if (!/^D\d+$/.test(id)) {
            add('error', 'dislikes.md', row.line, `ID が D# の形でない（${id}）`);
            continue;
          }
          defineId('dislikes.md', row.line, id);
          if ((row.cells.get('嫌いなもの') ?? '') === '' || (row.cells.get('理由') ?? '') === '') {
            add('error', 'dislikes.md', row.line, `${id} の嫌いなものか理由が空。理由のない嫌悪は場面によって無視される`);
          }
        }
      }
    }
  }

  if (kind === 'user') {
    const journeys = files.get('journeys.md');
    if (journeys !== undefined) {
      const sections = parseSections(journeys);
      if (sections.length === 0) {
        add('error', 'journeys.md', null, '道のり（### J# の見出し）が 1 つもない');
      }
      for (const section of sections) {
        const id = sectionId(section.title, 'J');
        if (id === null) {
          add('error', 'journeys.md', section.line, `見出しが J# で始まっていない（${section.title}）`);
          continue;
        }
        defineId('journeys.md', section.line, id);
        checkDecision('journeys.md', section.line, id, fieldValue(section.body, '判断') ?? '');
        const missing = ['入口', '期待する手数', '中断されやすい所', '戻り方'].filter((label) => (fieldValue(section.body, label) ?? '') === '');
        if (missing.length > 0) {
          add('warning', 'journeys.md', section.line, `${id} に ${missing.join('・')} がない`);
        }
      }
    }
    const moments = files.get('moments.md');
    if (moments !== undefined) {
      const counts = { G: 0, F: 0 };
      for (const section of parseSections(moments)) {
        const id = sectionId(section.title, 'G') ?? sectionId(section.title, 'F');
        if (id === null) {
          add('error', 'moments.md', section.line, `見出しが G# か F# で始まっていない（${section.title}）`);
          continue;
        }
        const expectedParent = id.startsWith('G') ? '気持ちいい瞬間' : '引っかかる瞬間';
        if (!(section.parent ?? '').includes(expectedParent)) {
          add('error', 'moments.md', section.line, `${id} が「## ${expectedParent}」の下にない`);
        }
        if (id.startsWith('G')) {
          counts.G += 1;
        } else {
          counts.F += 1;
        }
        checkEvidence('moments.md', section.line, section.title);
        defineId('moments.md', section.line, id);
        checkDecision('moments.md', section.line, id, fieldValue(section.body, '判断') ?? '');
        if ((fieldValue(section.body, '心の声') ?? '') === '') {
          add('warning', 'moments.md', section.line, `${id} に心の声がない`);
        }
      }
      if (counts.F === 0) {
        add('error', 'moments.md', null, '引っかかる瞬間（### F#）が 1 つもない。仕込みテストができない');
      }
      if (counts.G === 0) {
        add('warning', 'moments.md', null, '気持ちいい瞬間（### G#）が 1 つもない');
      }
    }
  }

  // 声
  const voice = files.get('voice.md');
  if (voice !== undefined) {
    const heading = MONOLOGUE_HEADING[kind];
    const part = findPart(voice, heading);
    const count = part === null ? 0 : part.filter((line) => /^\s*-\s+「.+」/.test(line)).length;
    if (count < MONOLOGUE_MIN) {
      add('error', 'voice.md', null, `「${heading}」の見出しの下に、- 「…」の形のサンプルが ${String(MONOLOGUE_MIN)} つ以上要る（いま ${String(count)} つ）`);
    }
  }

  // 入口
  const persona = files.get('PERSONA.md');
  if (persona !== undefined) {
    const headings = splitLines(persona).filter((line) => /^##\s/.test(line));
    for (const required of PERSONA_HEADINGS) {
      if (!headings.some((line) => line.includes(required))) {
        add('error', 'PERSONA.md', null, `「${required}」の見出しがない。雛形の見出しを残す`);
      }
    }
  }

  // 記録が参照する ID
  const log = files.get('log.md');
  if (log !== undefined) {
    const known = new Set<string>(definedIds);
    for (const match of log.matchAll(RETIRED)) {
      for (const id of (match[1] ?? '').split(/\s*[,、]\s*/)) {
        known.add(id.trim());
      }
    }
    const unknown = new Set<string>();
    for (const match of log.matchAll(RULE_ID_IN_TEXT)) {
      const id = match[1] ?? '';
      if (LOG_ID_PREFIXES[kind].includes(id.charAt(0)) && !known.has(id)) {
        unknown.add(id);
      }
    }
    if (unknown.size > 0) {
      add('warning', 'log.md', null, `定義されていない ID を参照している（${[...unknown].join('、')}）。消したルールなら「- 廃止: ${[...unknown].join(', ')}」の行を記録に書く`);
    }
  }

  return findings;
};

interface Rule {
  readonly id: string;
  readonly file: string;
  readonly rule: string;
}

/** 判定役に渡すルール表を作る。人物像（由来・感性・記憶・心の声）は含めない */
const extractRules = (directory: string, kind: Kind): Rule[] => {
  const read = (name: string): string | null => {
    const path = join(directory, name);
    return existsSync(path) ? stripComments(readFileSync(path, 'utf8')) : null;
  };
  const rules: Rule[] = [];
  const translation = read('translation.md');
  if (translation !== null) {
    for (const row of findRows(translation, ['ID', '判断'])) {
      rules.push({ id: row.cells.get('ID') ?? '', file: 'translation.md', rule: row.cells.get('判断') ?? '' });
    }
  }
  const sectionRules = (name: string, prefixes: readonly string[], label: string | null): void => {
    const text = read(name);
    if (text === null) {
      return;
    }
    for (const section of parseSections(text)) {
      const id = prefixes.map((prefix) => sectionId(section.title, prefix)).find((value) => value !== null) ?? null;
      if (id === null) {
        continue;
      }
      const rule = label === null ? section.body.join(' ').trim() : (fieldValue(section.body, label) ?? '');
      rules.push({ id, file: name, rule });
    }
  };
  if (kind === 'maker') {
    sectionRules('signatures.md', ['S'], null);
    const dislikes = read('dislikes.md');
    if (dislikes !== null) {
      for (const row of findRows(dislikes, ['ID', '嫌いなもの'])) {
        rules.push({ id: row.cells.get('ID') ?? '', file: 'dislikes.md', rule: `使わない: ${row.cells.get('嫌いなもの') ?? ''}` });
      }
    }
  } else {
    sectionRules('journeys.md', ['J'], '判断');
    sectionRules('moments.md', ['G', 'F'], '判断');
  }
  return rules;
};

const escapeCell = (text: string): string => {
  return text.replace(/\|/g, '\\|');
};

const parseCommandLine = (args: readonly string[]) => {
  return parseArgs({ args: [...args], options: { help: { type: 'boolean' }, rules: { type: 'boolean' } }, allowPositionals: true });
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
  if (parsed.positionals.length !== 1) {
    stderr.write(`Error: ペルソナのディレクトリを 1 つだけ指定する（受け取った数: ${String(parsed.positionals.length)}）\n例: node <persona-forge のディレクトリ>/scripts/lint-persona.mts /path/to/project/personas/minato\n`);
    return EXIT_USAGE;
  }
  const directory = resolve(parsed.positionals[0] ?? '');
  let isDirectory = false;
  try {
    isDirectory = statSync(directory).isDirectory();
  } catch (_e) {
    isDirectory = false;
  }
  if (!isDirectory) {
    stderr.write(`Error: ディレクトリとして見つからない: ${directory}\npersonas/<slug>/ を絶対パスで指定する\n`);
    return EXIT_USAGE;
  }
  const detection = detectKind(directory);
  if (detection.kind === 'ambiguous') {
    stderr.write(`Error: 作り手か使い手かを判定できない: ${detection.reason}\n`);
    return EXIT_USAGE;
  }

  if (parsed.values.rules === true) {
    const rules = extractRules(directory, detection.value);
    stdout.write(`| ID | ファイル | ルール |\n|---|---|---|\n${rules.map((item) => `| ${item.id} | ${item.file} | ${escapeCell(item.rule)} |`).join('\n')}\n`);
    stderr.write(`${String(rules.length)} 件のルールを出した: ${directory}\n`);
    return EXIT_OK;
  }

  const findings = lint(directory, detection.value);
  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.length - errors;
  const ok = errors === 0;
  stderr.write(`${ok ? 'OK' : 'NG'} ${directory}（${detection.value === 'maker' ? '作り手' : '使い手'}）: error ${String(errors)}, warning ${String(warnings)}\n`);
  stdout.write(`${JSON.stringify({ ok, path: directory, kind: detection.value, errors, warnings, findings }, null, 2)}\n`);
  return ok ? EXIT_OK : EXIT_PROBLEM;
};

try {
  process.exitCode = main();
} catch (e) {
  stderr.write(`Error: 検査の途中で失敗した: ${describeError(e)}\n`);
  stdout.write(`${JSON.stringify({ ok: null, error: describeError(e) }, null, 2)}\n`);
  process.exitCode = EXIT_PROBLEM;
}
