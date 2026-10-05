---
paths:
  - "**/*.{ts,mts,tsx,js,mjs}"
  - "**/package.json"
  - "**/tsconfig*.json"
---

<!-- コピー元: https://github.com/aokazaki-olp/coding-rules/blob/2b2689d537c0799b899ce0c0348ea0c2a2c2cec7/nodejs/CODING_RULES.md（develop、2026-09-02）。更新するときはコピー元から取り直す -->

# コーディング規約 (CODING_RULES.md) — ECMAScript / TypeScript / Node.js

> 迷ったら「**可読性**」と「**実行時の堅牢性**」を優先する。
>
> **前提**: Node は型注釈除去（type stripping）が stable な版以降。バージョンの選び方は §8.1。
>
> **Node は `.ts` を型注釈の除去だけで実行する**（`tsconfig` を読まず、型検査もしない）。**実行が成功したことは型が正しいことの証明にならない。** §8 の**コンパイラのフラグ**が効くのは型チェックを回したときだけ。
>
> **非保証**: 本規約は設定ファイルを配布しない（§1.2）。§8 の要求事項が実際に効いているかは**各リポジトリで導入時に確かめる**（§8.3）。確認していないものを「機械が守っている」と扱わない。

---

## 1. 基本思想

二本柱で書く。

1. **Java ライクな堅牢性**: 明示的なブロック、厳密なエラーハンドリング、役割の分離（モジュール・境界・型による契約）。型システムは Java のインターフェース・ジェネリクス的な発想で使い、**コンパイラをペアプログラマーとして扱う**。
2. **Modern ES / TS の活用**: 型推論・Utility Types・async/await・ESM など、現代のイディオムを積極採用し、冗長な記述を避ける。

**型はコンパイル時のみ有効。** 外部入力（API レスポンス・設定値・`JSON.parse`）は型が付いていてもランタイムガードを省略しない。置く場所は**境界**（§1.1・§6.1）。

二本柱は次の節に展開される。

- 明示的なブロック → §5.1
- 厳密なエラーハンドリング → §6
- 決定的な後始末 → §5.5
- 役割の分離（モジュール構造）→ §2.1〜§2.4
- 役割の分離（公開面・依存方向）→ §2.5・§2.6
- 型による契約 → §2.7・§2.8・§4

### 1.1 「明示」は境界に寄せる

明示は無条件の善ではない。**境界は明示、内部は推論**。OpenJDK の公式スタイルガイドも同じ立場（[LVTI Style Guide](https://openjdk.org/projects/amber/guides/lvti-style-guide) の P4「Explicit types are a tradeoff」）。§4.1（公開関数の戻り値型）と §6.1（ランタイムガードは境界に置く）に展開される。

### 1.2 規約が上位、設定は従属

規約文で「禁止」と書いても運用では無言に破られるので、**機械に守らせる**。ただし向きを間違えないこと。

- **規約は完全な形で本文に持つ。** 設定に落とせたからといって本文からルールを削らない
- **設定は「本規約に完全準拠させる」ことを目的に、各リポジトリで作る**（§8）
- **規約を設定に合わせて調整しない。** 設定が規約を満たせないなら、それは設定の不足である

> 逆向き（「機械が検出できるものは規約文から削る」）にしてはいけない。未検証の主張が「削除」という不可逆な操作を許可する構造になり、**規則の実体がどこにも無くなる**。

### 1.3 適用範囲 — 実行モデルで切る

**ファイルの拡張子ではなく、そのコードを何が実行するかで決める。**

| 実行モデル | 対象 | 適用範囲 |
|---|---|---|
| **Node が直接実行する** | `.ts` / `.mts` | **全節** |
| 同上（ESM の `.js` / `.mjs`） | 設定ファイル・スクリプト等 | **その構文で書ける規則だけ**（下記） |
| **バンドラを通す** | ブラウザ・renderer 向け。`.tsx` を含む | **§2.2 を除く全節。§8 の要求は実行モデルに合わせて読み替える** |
| **既存の CommonJS** | `.cts`、および既存パッケージのうち Node が CommonJS として実行する `.js` / `.ts` | **対象外** |

**`.js` / `.mjs` には、その構文で書ける規則だけが掛かる。** 型注釈・型パラメータ・`interface`・`override` など TypeScript の型構文を要求する規則は、**構文として書けないので対象外**。どの規則が該当するかは節を読めば決まるので、ここでは列挙しない（列挙は必ず実際の集合から遅れる）。

**§8 は「除外」ではなく「読み替え」である。** 実行モデル依存の要求（§8.1 に印がある）は、バンドラ経由では**逆の値が正しくなるものがある**（renderer では DOM の型定義が必要、モジュール解決はバンドラ方式、対象ファイルに `.tsx` を含む）。これらを「除外」と解釈して落とすと、その設定に従った側が壊れる。設定を実行モデルごとに分ける要求は §8 が持つ。

**`.cts` を新規に書かない。** CommonJS として解決されるため §2.1（ESM）も §2.2（実ファイルの拡張子）も成立せず、`export` を書いた時点でコンパイラと実行環境の両方が落ちる。CJS 相互運用が要る場合も、境界を `.mts` 側に置いて `.cts` を作らない。

既存の CommonJS が混在するリポジトリでは、**「lint / typecheck の対象から外す」か「移行対象として計画を立てる」かを最初に決める**。決めないまま本規約をロードすると、AI が既存 CJS を規約違反と判定して壊しにかかる。

### 1.4 読む順序

§1〜§7 が規則、§8 が機械強制の要求事項、付録 A が実行環境の下限。**実装を始める前に §8 の設定を先に用意すること。** 先にコードを書いて後から設定を入れると、`"type": "module"`・テストの検査範囲・optional の扱いで広範囲に手戻りする。

---

## 2. モジュール構造と境界

### 2.1 ES Modules

`export` を使う。IIFE パターンは使わない。関数の集合を公開するときは**モジュールオブジェクト**にまとめる（`export const HttpCore = { createTransport, withRetry };` — 短縮記法で書く）。

**Node が直接実行するなら `package.json` に `"type": "module"` が必須。** 無いと CommonJS と判定され、§8.1 が要求する import / export 構文の保持を有効にした時点で、**`export` 一つにつき型エラーが出て何も書けない**。Node の実行だけは警告付きで通ってしまうため、型チェックを回すまで気づけない。

- `.mts` は常に ESM、`.cts` は常に CommonJS（`.cts` は書かない。§1.3）

### 2.2 相対 import には実ファイルの拡張子を書く

> **適用**: **Node が解決する相対 import。** Node は型注釈を除去して**実ファイル**を解決するため、実在しない拡張子では解決できない。バンドラ経由のコードには適用しない（§1.3）。

```typescript
import { HttpCore } from './HttpCore.ts';        // ✅
import { HttpCore } from './HttpCore';           // ❌ 解決できない
import { HttpCore } from './HttpCore.js';        // ❌ 実ファイルが無い
```

Node 公式ドキュメント: 「file extensions are mandatory in `import` statements and `import()` expressions: `import './file.ts'`, not `import './file'`」

**拡張子なしを書くとコンパイラが指摘してくるが、その提案（`.js` を付けよ）には従わない。**

ビルドして `dist/` を配布する場合は、出力時に拡張子を書き換える設定を使う（§8.1）。**相対パスなら静的・動的を問わず書き換わる**ので、どちらも実ファイルの拡張子を書けばよい（`.ts` → `.js`、`.mts` → `.mjs`）。

**エイリアスを使わない**（`paths` も `#subpath imports` も）。相対パスで書く。

### 2.3 型のみの import / export は `import type` / `export type`

```typescript
import type { Logger } from './LoggerFacade.ts';   // 型のみ
import { fn, type FnParams } from './fn.ts';       // 値と型が混在するとき
export type { Logger } from './LoggerFacade.ts';   // 型の再 export
```

### 2.4 ファイルヘッダー

**他のモジュールから import される共有物**（ライブラリ・ユーティリティ）は冒頭に概要を1行。アプリケーション固有のコードは不要（エントリの TSDoc に注力）。`'use strict'` は ESM では不要。

**ファイル名の行とタグ（`@` で始まる行）の間は1行あける。**

```typescript
/**
 * HttpCore.ts
 *
 * @description HTTP通信の共通基盤（Transport・デコレータ関数・ユーティリティ）
 */
```

### 2.5 公開面を明示的に制御する

`index.ts` を唯一のエントリーポイントとし、公開する型・値を列挙する。**`index.ts` に内部実装を並べない**（内部モジュール自身の `export` は、`index.ts` からの再 export とテストのために必要）。

### 2.6 依存の方向を一方向に保つ

上位が下位に降りて接続する向きを崩さない。横断的な依存が生じたら設計を見直す。

```
consumers/  →  core/（型のみ）
core/       は consumers/ を import しない
```

### 2.7 型パラメータは検証とセットで使う

`unknown` を公開 API に漏らさないために型パラメータを引き上げる。**ただし検証を伴わない型パラメータは `as` と等価**で、型検査を全面通過して実行時に落ちるコードになる。

```typescript
// ❌ 検証なしの型パラメータ = unknown を無検査で T に洗浄している
const client = SalesforceApiClient.create<SoqlResult>(url, token);
const result = await client.get('/query');   // 型は SoqlResult、実体は {"error":"INVALID_SESSION"}
// → result.records.length で TypeError。コンパイラは何も言わない

// ✅ 境界で decode / parse する
const client = SalesforceApiClient.create<SoqlResult>(url, token, isSoqlResult);
```

検証を省く場合は §4.7 の許容枠の対象になる。**スキーマが本当に存在しない場合（任意 JSON のパース等）は `unknown` のままが正しい。** ジェネリクスで確定できるのは、契約に基づいて安全に絞れる場合に限る。

### 2.8 差し替え可能な依存はインターフェースで契約する

ロガー・トランスポート・時計のように利用者が差し替える依存は、**`unknown` で受けない**。インターフェースを公開し、何を実装すればよいかを型で示す。Java のインターフェースと同じ役割。

```typescript
// ✅ インターフェースで契約する
export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ❌ 利用者が何を渡せばよいか分からない
export const create = (options: { logger?: unknown }) => { ... };
```

構造的部分型なので、利用者は既存のオブジェクトをそのまま渡せる（`{ logger: console }`）。アダプタ実装（`LoggerFacade` 等）は内部に留め、公開するのはインターフェースだけにする。

---

## 3. 命名規則

| スコープ / 役割 | 規則 | 例 |
|---|---|---|
| **真の定数** | `UPPER_SNAKE_CASE` | `const MAX_RETRY_COUNT = 5;` |
| **設定値オブジェクト** | `UPPER_SNAKE_CASE` + `as const` | `const HTTP_STATUS = { OK: 200 } as const;` |
| **名前空間・モジュールオブジェクト** | `PascalCase` | `HttpCore`, `SalesforcePlugins` |
| **再代入不可な変数** | `camelCase` | `const currentUser = auth.getUser();` |
| **再代入する変数** | `camelCase` | `let attempt = 0;` |
| **型・interface・クラス** | `PascalCase` | `interface Transport`, `type HttpMethod` |
| **型パラメータ** | `T` / `TXxx` | 単純なら `T`、意味が要れば `TResult` |
| 短いスコープ（1〜3行）・ループカウンタ | 1文字変数（推奨） | `k`, `v`, `e`, `n`, `i` |
| 通常スコープ | **省略禁止** | `options`（not `opts`）、`response`（not `res`） |
| 未使用の変数・引数・`catch` 変数 | `_` 接頭辞 | `(_event, _context) => {}`、`catch (_e)` |

`Object.freeze` はランタイム凍結が本当に要る場合のみ。`as const` はコンパイル時の型情報が得られる。

---

## 4. 型システム

### 4.1 必須事項

| 対象 | ルール | 詳細 |
|---|---|---|
| **strict モード** | **必須** | これなしの TypeScript は型チェックが緩く意味が薄い |
| **`any`** | **値の型としては禁止** | 外部データは `unknown` で受け型ガードで絞る（§4.6）。ジェネリック制約位置は例外（§4.7） |
| **`as`（型キャスト）** | **原則禁止** | まず `satisfies` を検討する（§4.2）。使う場合の書き方は §4.7 |
| **`!`（非nullアサーション）** | **原則禁止** | 理由は §4.3。使う場合は理由コメント必須（§4.7） |
| **公開関数の戻り値型** | **明示必須** | `export` する関数・メソッドは戻り値型を書く。内部実装は推論に任せてよい（§1.1） |
| **`enum`** | **禁止** | `as const`（§3）+ Union 型（§4.5）で代替 |

「公開関数」の範囲は、**`export` されるオブジェクト経由で到達可能な関数を含む**。§2.1 のモジュールオブジェクト `export const HttpCore = { createTransport, ... }` を使う場合、メンバ関数それぞれに戻り値型が必要になる（到達不能な純粋な内部関数だけが対象外）。

### 4.2 `as` の前に `satisfies` を検討する

`satisfies` は型を広げずに検査だけする。`as` は型検査を黙らせるので、代替がある場面では使わない。

```typescript
// ❌ as: 型検査を黙らせる。プロパティ欠落も通る
const CONFIG = { retries: 3 } as Config;

// ✅ satisfies: Config を満たすか検査する（欠落は検出される）
const CONFIG = { retries: 3, delay: 500 } satisfies Config;
```

**`satisfies` 単独はリテラル型を保たない。** 上の `CONFIG.retries` の型は `3` ではなく `number` になる。§3 が設定値オブジェクトに要求するコンパイル時の型情報が要る場合は、**`as const` と併用する**。

```typescript
// ✅ 検査しつつリテラル型も保つ
const CONFIG = { retries: 3, delay: 500 } as const satisfies Config;
```

### 4.3 null 安全 — 「デフォルト非null」を型で持っている

strict の null チェックを有効にすると、型は既定で非 null になり、null 許容は `T | null` / `T | undefined` として明示される。Java は同じことをアノテーションで後付けしている（Spring Framework は [JSpecify](https://docs.spring.io/spring-framework/reference/core/null-safety.html) を採用し、`@NullMarked` で「デフォルト非null」を宣言してビルド時に強制する）。

**`!` を書く行為は、この保証を手で捨てることに等しい。** だから原則禁止にする。

> **インデックスアクセスを厳しくするフラグについて（誤解しやすい）**: このフラグは `!` を不要にするのではなく、**インデックスアクセスを `T | undefined` にしてチェックを強制する**。結果として `!` を書きたくなる箇所が増える方向に働く（正規表現キャプチャ・`split(' ')[0]`・分割代入・カウンタループ）。そのため**このフラグ由来の箇所では `!` を理由コメント付きで許容する**（§4.7）。

**ループ後の確定値**は型システムが追えない頻出パターン。`?.` や事前チェックでは解けないので、値が必ずある形に組み替える。

```typescript
// ✅ 最終試行をループの外に出し、失敗を明示的に伝える
for (let i = 0; i < maxRetries; i++) {
  const response = await transport.fetch(url, options);
  if (response.ok) {
    return response;
  }
  await sleep(backoff(i));
}
const last = await transport.fetch(url, options);
if (!last.ok) {
  // リトライを使い切った事実を呼び出し側に伝える（§5.4）
  throw new HttpError('リトライ上限に達しました', last.status, await last.text());
}
return last;
```

### 4.4 `interface` vs `type`

| 用途 | 使うもの | 理由 |
|---|---|---|
| **公開APIの契約** | `interface` | Java のインターフェース的な発想。拡張・実装を想定（§2.8） |
| **Union 型** | `type` | `type HttpMethod = 'GET' \| 'POST' \| ...` |
| **Utility Types の組み合わせ** | `type` | `type Options = Partial<Config> & { logger?: Logger }` |
| **関数型** | `type` | `type Filter = (v: unknown) => unknown` |

### 4.5 閉じた階層は discriminated union で表す

Union 型は「型の並び」ではなく、**閉じた階層（sealed hierarchy）の宣言**として扱う。判別可能にするため、必ず共通のリテラルフィールド（判別子）を持たせる。

```typescript
// ✅ 閉じた階層
type Result<T> =
  | { readonly kind: 'ok';    readonly value: T }
  | { readonly kind: 'error'; readonly error: Error };
```

Java の対応物は `sealed interface` + `record`。

### 4.6 外部データは `unknown` で受ける

```typescript
const body: unknown = JSON.parse(text);
if (typeof body === 'object' && body !== null && 'access_token' in body) {
  // ここでは body.access_token にアクセスできる
}
```

### 4.7 例外の明文化

「原則禁止」だけでは運用で無言に破られる。**許容枠を明示する。**

**事前承認する場面**（下表）と、**そうでない場面**を分ける。表に無いものは事前承認ではない。

| 事前承認する場面 | 対象 | 書き方 |
|---|---|---|
| 外部 API の型定義が実際より広いユニオンで、呼び出し文脈で一意に定まる | `as` | 何も書かない（lint は発火しない） |
| テストのモック生成 | `as unknown as` | 何も書かない（lint は発火しない） |
| ジェネリック制約位置の `(...args: any[]) => any` | `any` | 抑制コメント（反変位置で `unknown` は代替不能） |
| インデックスアクセスを厳しくするフラグ由来の確定インデックス | `!` | 抑制コメント + 理由 |
| 型システムで表現できない合成（スプレッド等） | `as unknown as` | 通常のコメントで理由 |
| 契約上安全に絞れる型パラメータ（§2.7） | 型パラメータ | 通常のコメントで、**なぜ契約上そう言えるか**を書く |

**表に無い `as` / `!` / `any` は事前承認されない。** 書く場合は理由コメント（発火するなら抑制コメント + 理由、しないなら通常のコメント）を付けたうえで、**レビューで是非を問う対象**になる。**理由コメントは免罪符ではない** — 「型が通らなかったから」に還元できる理由は、§4.1 の原則禁止をなぞって却下する。

抑制コメントには**必ず理由を書く**（書式は使う lint に従う。下の例は一例）。**ルールが発火しない箇所に抑制コメントを書くと、§8.1 が要求する「不要になった抑制コメントの検出」に当たってビルドが壊れる。** 書く前に、そのコードで実際に何が発火するかを確かめる。

```typescript
// ✅ 発火しないので通常のコメント（型システムで証明不能: additionalMethods ∪ HttpMethods）
client = { ...additionalMethods, ...httpMethods, call, extend, use } as unknown as BaseClient<...>;

// ✅ 発火するので抑制コメント + 理由
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 直前の length 検査で確定
const first = xs[0]!;
```

### 4.8 Node が実行できない TypeScript 構文

> **適用**: **バンドラ経由にも掛かる。** Node ではそのまま `SyntaxError` になるが、バンドラ経由では変換されて動いてしまうものがある。

型注釈除去は「型を消すだけ」なので、JavaScript コード生成を伴う構文は動かない。**これらは使わない。**

| 構文 | 備考 |
|---|---|
| `enum` | §4.1 で禁止済み |
| パラメータプロパティ `constructor(public readonly x: T)` | §6.4 で禁止済み |
| runtime code を含む `namespace` | runtime code を含まないものは動く |
| `import A = B.C` / `export = X` | — |
| **TypeScript のデコレータ構文 `@foo`** | **消去可能構文だけを許すフラグを素通りする**。lint で塞ぐ（§8.1） |
| **`accessor` フィールド** | 同上 |

**変換を伴う experimental フラグに頼らない。** 表の上4つはそうしたフラグで動く場合があるが、**実験的フラグは予告なく削除される**（実際に削除された版がある）。フラグ前提で書くと、実行環境を上げた瞬間に動かなくなる。

**デコレータ構文と `accessor` フィールドはフラグを付けても動かない。** この2つは表の他とは別物で、コンパイラを通過して **Node で SyntaxError** になる。しかも TypeScript 固有のエラーとしてではなく、パーサが構文として認識しない形で落ちる。**バンドラ経由も安全ではない** — 既定では変換せず素通りさせるため、型チェックも lint もビルドも通ったうえで実行時に落ちる。だから lint でしか塞げない（§8.1）。

### 4.9 厳しい検査を増やすときの原則

**厳しいフラグや lint ルールを追加するときは、§4.7 の許容枠を対で用意する。用意できないなら採用しない。**

- インデックスアクセスを厳しくするフラグは、許容枠（フラグ由来の `!`）とセットで採用する
- **optional プロパティを厳密にするフラグ（`exactOptionalPropertyTypes`）は採用しない。** **`T | undefined` な値を optional プロパティへ詰める書き方がすべて落ちる**（`{ retries: maybe }`、およびプロパティの短縮記法 `({ signal })`）。回避策3つ（全 optional に `| undefined` を足す／条件付きスプレッド／`as`）はいずれもこの規約と衝突する。**コンパイラの初期化テンプレートはこのフラグを既定で入れてくるので、生成物をそのまま使わない**
- **宣言ファイルを単独生成可能にするフラグ（`isolatedDeclarations`）は採用しない。** §2.1 のモジュールオブジェクトは短縮記法で書くため推論できず、公開するオブジェクトごとに型注釈を書き足す負担が生じる。§4.1 の目的は lint 側のルールで足りる（§8.1）。宣言ファイルを並列生成したいライブラリ層でのみ局所的に有効化してよい

---

## 5. 構文・スタイル

### 5.1 必須事項

| 対象 | ルール |
|---|---|
| **ブロック省略** | `if (x) return;` 禁止 |
| **一行化** | `if (x) { return; }` を1行に畳まない。本文は改行・インデント |
| **`forEach`** | **禁止** → `for...of`（既定）または Iterator Helpers（変換のみ） |
| **`var`** | **禁止**（`const` / `let`） |
| **`switch` のフォールスルー** | **禁止**。各 `case` に `break` または `return` |
| **Yoda 条件** | ✅ `if (value === null)` / ❌ `if (null === value)` |

> **`switch` もブロックスタイルの対象。** `case x: break;` の一行にせず、`case` / `default` の本文を改行・インデントする。

### 5.2 `switch` の網羅性 — `default` を安易に書かない

型で網羅が証明できる場合、素の `default` は網羅検査を無効化するため有害。Java の同じ議論（[JEP 441](https://openjdk.org/jeps/441)）は「match-all clause は pernicious。網羅的な switch は match-all を持たない方がよい」と結論している。

**入力の性質で書き方を変える。**

| 入力 | 書き方 |
|---|---|
| 型で閉じられる（Union・判別子つき） | `default: return assertNever(x);` |
| 型で閉じられ、ランタイム保証が不要 | **`default` を完全に省略**（**戻り値型を明示している場合に限り**ケース追加時にコンパイルエラーになる。推論に任せると検出が消えるので、内部関数では `assertNever` を既定にする） |
| 外部由来で型で閉じられない | 素の `default`（`throw` またはフォールバック） |

`assertNever` は `never` を受けて必ず throw する共有ユーティリティとして1つ持つ（`src/shared/assertNever.ts`）。**外部入力に使ってはならない** — 型が閉じていないので網羅を証明できず、単に `throw` するだけの遠回りになる。既定を `assertNever` にする理由は**ランタイム保証も要るため**で、型を跨いだ実データ（`as` を通った値・realm 越え・古いビルドの永続データ）が来たときに throw させる。

> `assertNever` は最も広く import される層に置くので、**ランタイム依存（`node:util` 等）を入れない**。入れるとその層全体が Node 専用になる。

### 5.3 async / await

| 対象 | ルール |
|---|---|
| **非同期関数** | `async` / `await` に統一。`.then()` チェーンは使わない |
| **`Promise` の直接 `return`** | `await` 不要なら省略してよい。**ただし `using` / `await using` のスコープ内では必ず `await` を書く**（§5.5） |
| **並列実行** | 独立した処理は `Promise.all`（部分失敗を許すなら `allSettled`、最初の成功だけ要るなら `Promise.any` + `AggregateError`） |
| **エラーハンドリング** | `try` / `catch` で明示的に。Promise を握りつぶさない |
| **キャンセル・タイムアウト** | 外部 I/O は `AbortSignal` を受け取れる形にする |

```typescript
// ✅ 並列実行
const [users, channels] = await Promise.all([fetchUsers(client), fetchChannels(client)]);

// ✅ タイムアウトと外部キャンセルの合成（どちらも ES 標準）
const call = async (url: string, signal?: AbortSignal): Promise<Response> => {
  const timeout = AbortSignal.timeout(10_000);
  return fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
};

// ❌ .then() チェーン
transport.fetch(url, options).then(response => { ... });
```

### 5.4 沈黙の失敗を作らない

黙って空を返す・握りつぶす設計にしない。呼び出し側が気づけないものは、例外か、明示的な「空である理由」を返す。

打ち切り・上限・サンプリングを行う場合は、**打ち切った事実を戻り値の型に現れる形で返す**（フラグでも §4.5 の判別子つき union でもよい）。黙って削らない。

### 5.5 リソース解放は `using` で行う

解放が要るもの（ファイルハンドル・接続・ロック・一時ディレクトリ）は **`using` / `await using` を第一選択**にする。`try` / `finally` は、獲得と解放が離れ、複数リソースでネストが深くなる。

```typescript
// ✅ 宣言と解放が同じ行に紐づく
const readAll = async (path: string): Promise<string> => {
  await using handle = await open(path);
  return await handle.readFile({ encoding: 'utf8' });
};

// ❌ 解放が離れる。early return を足した人が finally を見落とす
const handle = await open(path);
try {
  return await handle.readFile({ encoding: 'utf8' });
} finally {
  await handle.close();
}
```

> **`using` スコープでは `return` に `await` を必ず書く**（§5.3 の「`await` 不要なら省略してよい」より優先する）。省略すると**破棄が Promise の解決より先に走り、使用中のリソースが閉じられる**。

- **破棄はスコープ末尾で、宣言と逆順**に走る
- **ループ内では反復ごとに破棄される**。`try` / `finally` を毎周ネストする必要がない
- 解放されるオブジェクトは `[Symbol.dispose]()`（同期）または `[Symbol.asyncDispose]()`（非同期）を実装する。自作リソースには実装を足す
- 個数が動的に決まる場合は `DisposableStack` / `AsyncDisposableStack` にまとめる（`use` / `defer` / `adopt`）

**破棄中に例外が出たときの扱いは §6.3。** これを知らずに使うと本来の失敗原因を取り落とす。

### 5.6 推奨事項

| 対象 | アクション |
|---|---|
| **`== null`** | null / undefined の一括チェックに積極活用 |
| **`??`** | 推奨（`0` / `false` / `''` が有効値なら `\|\|` ではなく `??`） |
| **`?.`** | 推奨 |
| 分割代入 / デフォルト引数 / スプレッド / アロー関数 / 一時変数の排除 | 推奨 |
| 非破壊の配列操作（`toSorted` / `with`）／分類（`Object.groupBy`・`Map.groupBy`）／Iterator Helpers（`forEach` を除く）／集合演算／`RegExp.escape`／`Promise.withResolvers`／`Promise.try`／`Array.fromAsync`／Import Attributes | ES 標準のものは使ってよい |
| `import.meta.dirname` / `import.meta.filename` | `__dirname` / `__filename` の ESM 置き換え |

> **`lib` と実行環境はずれる。** 型が通っても実行環境に無い API があり、逆に実行環境にあっても `lib` に無いものがある（`lib` は TypeScript のバージョンに追随する）。**新しい API を使うときは、実行環境と `lib` の両方にあることを確認し、満たさないものは使わない。** 確認結果は**下限マーカー**として付録 A に足す。

> **分類系の注意**: `Object.groupBy` は戻り値のキーの存在が型で保証されないので `?? []` で受ける。**`Map.groupBy` に替えても解決しない**（`Map.get` も `T[] | undefined` を返す）。キー集合を閉じても同じなので、どちらでも `?? []` が要る。ここで `!` や `as` に流れると §4.1 と衝突する。

---

## 6. エラー戦略と TSDoc

### 6.1 エラーの投げ分け

| クラス | 用途 |
|---|---|
| **`TypeError`** | **境界の関数**での fail-fast 型バリデーション |
| **`Error`** | ドメインエラー（API 通信の失敗・期待するリソースが無い等） |
| **カスタムエラークラス** | 追加情報を持たせたい場合（§6.4） |

```typescript
if (!instanceUrl) {
  throw new TypeError('instanceUrl には空でない string を指定してください');
}
```

**ランタイムガードは境界に置く**（§1.1）。対象は**信頼できない値が入ってくる場所** — §2.5 の意味での公開 API（`index.ts` から出るもの）・外部入力の受け口・プロセス境界。**それ以外の `export` には置かない**（型で担保されているものを二重に検査するとノイズになる）。

> §4.1 が戻り値型を要求する「公開関数」は、これより広い（`export` 経由で到達可能なすべて）。**目的が違うので範囲も違う** — 戻り値型は契約の明示、ランタイムガードは信頼境界の防御である。

メッセージの期待型は自然言語で列挙してよい。`null` や複数型を許容する場合は「`... には Date または null を ...`」のように明示する。

### 6.2 例外連鎖 — `cause` で情報を落とさない

`catch (e)` の `e` は `unknown`。**`as Error` を散在させず、共有ユーティリティ `toError()` で `Error` に正規化する**（`src/shared/toError.ts`）。契約は次の2つ。

- 判定は `instanceof Error` ではなく **`Error.isError`**（`instanceof` は realm を跨ぐと誤判定する — `node:vm`・worker・別 realm 由来の Error）
- `Error` でない値を包むときは、**元の値を `cause` に入れる**（捨てない）

境界をまたぐときに情報を畳む場合も、`cause` で元を残す。

```typescript
// ✅ 元の例外を捨てない
throw new Error(`gBizINFO の取得に失敗しました: ${String(response.status)}`, { cause: original });

// ❌ message に畳んで元を捨てる
throw new Error(`HTTP ${String(response.status)}: ${original.message}`);
```

> **`cause` が消える経路**: `cause` は非 enumerable なので **JSON 直列化で確実に消える**（`JSON.stringify(err)` → `{}`）。`structuredClone` なら保持される。HTTP / IPC など JSON を経由する境界では、`cause` チェーンを明示的に平坦化してフィールドに詰め直す。

### 6.3 破棄中の例外 — `SuppressedError` の向きに注意する

`using`（§5.5）で本体と破棄の両方が失敗すると、投げられるのは `SuppressedError` になる。**フィールドの向きが直感と逆である。**

| フィールド | 中身 |
|---|---|
| `error` | **破棄時**の例外（後から起きた方） |
| `suppressed` | **本体**の例外（本来の失敗原因） |

つまり素朴に `e.message` を読んでも**どちらの原因も取れない**。本来の失敗原因は `suppressed` に埋まる。§6.2 の `cause` と同じ「情報を落とすな」の問題なので、境界でログ・整形する箇所では両方を辿る。

判定に `instanceof` を使わない理由は §6.2 と同じ（realm を跨ぐと誤判定する）。**`Error.isSuppressedError` は存在しない**ので、`Error.isError` と構造で判定する。

```typescript
// ✅ 本来の原因まで辿る（realm を跨いでも判定できる）
// 2つとも検査する。片方だけでは他方が絞れず型エラーになる
if (Error.isError(e) && 'suppressed' in e && 'error' in e) {
  logger.error('本体の失敗', e.suppressed);
  logger.error('後始末も失敗', e.error);
}

// ❌ 別 realm 由来だと false になり、この分岐ごと素通りする
if (e instanceof SuppressedError) { ... }
```

### 6.4 カスタムエラークラスの書き方

`name` はクラスフィールド（`override readonly`）で宣言する。**パラメータプロパティは使わない**（フィールドの宣言と代入を分けて書く）。

```typescript
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
    this.body = body;
  }
}
```

### 6.5 TSDoc

型は型定義で表現するため `@param` に型注釈は不要。

- `@param name - 説明` — **ダッシュ ` - ` 必須**、型注釈なし
- `@returns` / `@throws`（送出する場合）/ 設計上の制限事項

```typescript
/**
 * Salesforce API クライアントを作成する
 *
 * @param instanceUrl - 組織固有の My Domain URL (例: https://yourorg.my.salesforce.com)
 * @param options - オプション設定
 * @returns Salesforce API クライアント
 * @throws {TypeError} instanceUrl が空文字の場合
 */
export const create = (instanceUrl: string, options: CreateOptions = {}): SalesforceApiClient => { ... };
```

---

## 7. テスト

**ランナーは実行モデルに合わせてプロジェクトごとに選ぶ。** 本規約はランナーもアサーションも指定しない（§8 の「要求は満たすべき機能で書き、ツール固有の名前を出さない」に従う）。ランナーを lint に登録する要求は §8.1 が持つ。

**モックの既定は依存注入**（§2.7 の decode / parse を引き回す設計と一致）。**モジュール単位のモックに依存する設計にしない** — 依存を差し替えられない設計は §2.8 の契約と衝突し、ランナーを変えた瞬間にテストが書けなくなる。

| 対象 | 方針 |
|---|---|
| **純関数・共有ロジック** | 直接ユニットテストする |
| **境界（I/O・フレームワーク越し）** | 依存をモックしてテストする |
| **検証範囲** | 正常系だけでなく**エラー経路も検証する** |
| **バルク・境界値** | 上限付近・空・1件・大量を検証する |

**ファイル名は `*.test.ts`**（JSX を含むなら `*.test.tsx`）**。配置は `src/` と分けてよい**（`tests/` を推奨）。名前で判別できるので、どちらの配置でもランナーに拾わせられる（探索設定はランナーごとに確かめる）。

**実行モデルが複数あるなら、テストの置き場も実行モデルごとに分ける**（§8）。1つに混ぜると、両モデルの設定が互いのテストを拾い合って**両方の型チェックが同時に落ちる**。

**分ける場合も、テストを typecheck / lint の対象範囲に必ず含める**（§8.1）。**これは配置の問題ではなく範囲の問題**なので、同居させても範囲から外れれば同じことが起きる。

配布物からテストを除く方法は §8.1。

### 7.1 テストコードは本体と同じ制約をかけない

| | 本体 | テスト |
|---|---|---|
| `as unknown as` | 理由コメント必須 | **許容**（モック生成） |
| `any` とその周辺 | 禁止 | **一式まとめて許容** |
| `async` だが `await` なし | 検出 | **許容**（`async () => value` のモック） |
| 重複 | 避ける | **許容**（可読性優先） |

**`any` を許容するなら周辺ルールも一式で緩める。** `any` の宣言だけ許して呼び出しやメンバアクセスを禁じると、**宣言できるが使えない**状態になる。

**実行可能性のガードは緩めない。** デコレータ構文と `accessor` フィールドはテストでも実行できないので、表現力の問題ではない。テスト向けに構文制限ルールを丸ごと無効化すると**この2つのガードも一緒に消える**（lint は緑になり実行時に SyntaxError）。緩めたいものだけを名指しで外す。

> コンパイラのフラグはファイル単位で緩められないので、§8.1 のコンパイラ要求はテストにも同じ厳しさでかかる。分けたい場合はテスト用の設定を別に持つしかない（コストと引き換え）。

### 7.2 段階適用

scaffold 段階は**テストの構成**を最小限にしてよい。共有ロジックや実装本体を書く段でこの章の構成へ寄せる。段階の切り替え時期を曖昧にしないため、どちらの段階かを変更の説明に書く（PR を使う運用なら PR に書く）。

**緩められるのはこの章だけで、§8 の設定は scaffold 段階でも先に用意する**（理由は §1.4）。

---

## 8. 機械強制の要求事項

**設定ファイルは本規約が配布しない。** 各リポジトリで、**本規約に完全準拠させることを目的として**作る（§1.2）。以下は「設定が満たすべき要求事項」であり、設定そのものではない。

**1つのリポジトリに複数の実行モデルがあるなら、実行モデルごとに設定を分ける**（§1.3）。以下で **［実行モデル依存］** と印を付けた要求は、実行モデルごとに値が変わる（バンドラ経由では逆になるものがある）。印の無い要求はどの実行モデルでも同じである。

> **要求は満たすべき機能で書き、ツール固有の名前を出さない**（実現手段は複数あり、名前は変わる）。**例外は「採用しない」と決めたもの**で、そちらは名指ししないと読み手が同定できないため実名で書く。**実名は §4.9 が持つ。**

### 8.1 設定が満たすべきこと

**コンパイラ**

- strict モード（§4.1）
- 消去可能構文だけを許す（§4.8）
- import / export の構文を保持する（§2.3）
- **［実行モデル依存］** 相対 import の拡張子を出力時に書き換える（§2.2。バンドラ経由では不要）
- インデックスアクセスを厳しくする（§4.3。`!` 禁止の強制ではない）
- `switch` のフォールスルーを検出（§5.1）／`override` を必須にする（§6.4）
- **［実行モデル依存］標準ライブラリと型定義の範囲を明示する** — Node 側は DOM を排除し実行環境の型定義を入れる。**renderer 側は逆に DOM が要る**
- **［実行モデル依存］モジュール解決を実行モデルに合わせる**。Node 直接実行では `package.json` に `"type": "module"` を置く（§2.1）
- **［実行モデル依存］型チェックの対象にする拡張子とディレクトリをすべて書く** — Node 直接実行なら `.ts` / `.mts`、バンドラ経由なら `.tsx` も（`.js` / `.mjs` は型チェックに含めない。lint 側で扱う）。**テストの置き場も含める**（§7。テストは対象コードと同じ実行モデルに属する）
- ビルド出力からテストを除くのは**別の設定ファイル**で行う

**採用しないもの**: optional プロパティを厳密にするフラグ／宣言ファイルを単独生成可能にするフラグ（理由は §4.9）。規則に対応しない基盤設定は各リポジトリの裁量。

**lint**

- **［実行モデル依存］そのリポジトリに存在する拡張子をすべて対象にする**（`.ts` 系・`.js` 系、バンドラ経由があれば `.tsx` 系）。片方にしかルールを置かないと**もう片方が完全な死角になる**。**「どれが共通か」を列挙で持たない**
- **［実行モデル依存］`.js` 系にはその実行モデルのグローバルを与える**
- **型情報を使う「厳格」水準のプリセットを、型注釈を持つファイル（`.ts` / `.mts`、バンドラ経由なら `.tsx` も）に対して有効化する** — 「推奨」水準では `!` を禁じるルールが含まれず、**`any` 禁止だけが効いて片方が静かに死ぬ**（§4.1・§5.3・§5.5・§7.1）。**`.js` 系は構文レベルのルールだけでよい**（型情報を使う lint の対象にするとコンパイラ側にも JS を含める設定が要り、ビルド設定と衝突する）
- **`switch` の網羅性検査と、公開関数の戻り値型を要求するルールを明示的に足す** — 「厳格」プリセットには含まれていない（§4.1・§5.2）
- **デコレータ構文と `accessor` フィールドを禁じる** — コンパイラも既定のバンドラも素通りするので、lint しか止められない（§4.8）
- **［実行モデル依存］相対 import の `.js` を静的・動的の両方で禁じる。対象は `.ts` / `.mts`** — コンパイラは通してしまう。動的 `import()` は静的 import 用のルールでは捕まらない（§2.2。バンドラ経由では掛けない）
- `forEach` / `var` / ブロック省略 / Yoda 条件を禁じる（§5.1）／`.then()` チェーンを禁じる（§5.3）
- **1行あたりの文の数を1に制限する**（§5.1 の一行化）
- **`switch` のフォールスルーを lint 側でも禁じる** — コンパイラの検出は `.js` を見ない
- **等価演算子は厳格に。ただし `null` は除外**（§5.6 の `== null`）
- **未使用の変数・引数・catch 変数のすべてで `_` 接頭辞を除外する** — 指定はそれぞれ別（§3）
- **不要になった抑制コメントを検出する**（§4.7）
- **ランナーが公開するテスト宣言関数が Promise を返す場合、「戻り値を捨ててよい呼び出し」として登録する** — 返さないランナーでは不要（§8.3 で確かめる）
- **プロジェクト解決を使う場合、コンパイラの対象範囲と揃える**

**整形**: コード例の書式（シングルクォート）に合わせた設定を置く。整形ツールは一行化を展開するが、整形を通さない経路が残るので lint 側でも塞ぐ。

**バージョンの選び方**: 具体的な版を本規約に固定しない（すぐ腐る）。満たすべき条件は2つ。

- **型情報を使う lint が動く組み合わせを選ぶ。** **コンパイラの最新版が lint 側の対応範囲より先に進んでいることは珍しくない。** 速い方を採るか lint を維持するかは、**この規約を機械強制できるかどうか**で決める（§1.2）
- **Node は型注釈除去が stable な版以降**（付録 A）。LTS の切り替え時期に baseline を見直す

固定した版とその理由は `package.json` の隣に書き、**本規約には書かない**。

### 8.2 機械の守備範囲の境目

「何がどこまで守られるか」の所在一覧。**理由は各節が持つ。**
特に2つ目のグループは、設定を入れても検出されないので**規約文の側で守るしかない**。
**この一覧は網羅ではない。** ここに無い規則が機械強制されているとは限らない（§8.3 で確かめる）。

**コンパイラだけでは落ちない**（lint が要る）

- `any` / `!`（§4.1）
- デコレータ構文 / `accessor` フィールド（§4.8）
- 相対 import の `.js`（§2.2）

**どちらでも落ちない**（人間が守る）

- リソース解放の付け忘れ（§5.5）
- 沈黙の失敗（§5.4）・`SuppressedError` の向き（§6.3）
- `as` の是非（§4.1・§4.2）・命名規則（§3）・境界の規律（§2.5〜§2.8）・許容枠の理由の妥当性（§4.7）

**誤解しやすいもの**

- インデックスアクセスを厳しくするフラグは **`!` 禁止を強制しない**（チェックを強制するだけ。§4.3）

### 8.3 検証義務

**§8.1 の各要求につき、束ねたコマンド（下記）で確かめる。** ツール単体で確認すると、**ツールは正しいのにコマンドに繋がっていない**という穴を見逃す。**ただし、出力の中身はコマンドの合否に現れない。配布物を作るなら、出力を直接見る。** 確認していない要求を「機械が守っている」と扱わない。設定を変えたとき・依存を更新したときも同じ確認をする。

確かめ方は要求の性質で3通りある。**どれに当たるかを先に決める。**

| 要求の性質 | 確かめ方 | 例 |
|---|---|---|
| **禁止するもの** | 違反コードを1件書き、**落ちる**ことを確かめる | `any` の禁止、デコレータ構文の禁止 |
| **通すための土台** | 準拠コードを1件書き、**通る**ことを確かめる（外すと落ちることも確かめる） | 実行環境のグローバル、テストランナーの呼び出し登録 |
| **対象範囲の指定** | 範囲の端にファイルを1枚置き、**入る／入らないのどちらが正しいかを決めてから**そうなっていることを確かめる | 対象ファイルの拡張子、プロジェクト解決の範囲 |

**警告ゼロで通ることは「守られている」の証拠にならない** — ルールを緩めても同じく緑になる。

範囲の切り方:

```
自分のコード         警告ゼロを強制する（設定ファイル・スクリプトも含む）
借り物・生成物        lint / typecheck の対象から外す（`dist/` 等の出力もここ）
既存の CommonJS      対象から外すか、移行対象として計画を立てる（§1.3）
テストコード         lint 側の設定だけ緩める（§7.1）
```

**抑制コメントは借り物コードには使えない**（同期や再生成で上書きされる）。設定ファイル側で、**コードを書き始める前に**範囲を切る。

`lint` / `format` / `typecheck` / `test` は1本のコマンドに束ね、**ローカルと CI で同じものを実行する**。**配布物を作るなら `build` も束ねる**（§8.1 には出力時にしか現れない要求がある）。**`format` は検査モードで束ねる** — 書き換えモードは違反を黙って直すので、常に緑になり一度も現れない。AI エージェントに作業させる場合は、完了報告の前にそれを通すことを `AGENTS.md` 側に書く。

---

## 付録 A. 実行環境の下限と baseline の更新

規則ではなく、規則を運用するための材料。§5.6（新しい API を使う前の確認）と §8.1（LTS 切り替え時に baseline を見直す）が要求する作業の実体をここに置く。

### A.1 下限マーカー

本規約の baseline は「型注釈除去が stable な Node」（§8.1）。**型注釈除去は Node 24.12 / 25.2 で stable になった**（この事実は baseline を上げても変わらない）。**baseline より後に入った機能は、下限を満たす環境でしか使えない。**

| 機能 | 下限 |
|---|---|
| **§5.3 が使うもの**（`AbortSignal.timeout` / `AbortSignal.any` / `Promise.all` / `Promise.allSettled` / `Promise.any` / `AggregateError`） | baseline |
| **§5.5・§6.3 が使うもの**（`using` / `await using` / `DisposableStack` / `AsyncDisposableStack` / `Symbol.dispose` / `Symbol.asyncDispose` / `SuppressedError`） | baseline |
| **§6.2 が使うもの**（`Error.isError` / `structuredClone`） | baseline |
| **§5.6 が挙げるもの**（`toSorted` / `with` / `Object.groupBy` / `Map.groupBy` / Iterator Helpers〔`Iterator.concat` を除く〕/ 集合演算 / `RegExp.escape` / `Promise.withResolvers` / `Promise.try` / `Array.fromAsync` / Import Attributes / `import.meta.dirname` / `import.meta.filename`） | baseline |
| `Uint8Array` の base64 / hex 変換 | **Node 25+** |
| `Temporal` | **Node 26+** |
| `Map.getOrInsert` / `getOrInsertComputed` | **Node 26+** |
| `Iterator.concat` | **Node 26+** |

**本文が新しい API の名前を挙げたら、この表にも足す。** 節単位でまとめてよい。
**この表は ES 機能の網羅ではない。** ここに無い新しい API は、使う前に自分で実行環境を確認し、行を足す。**型が通ったことを可用性の根拠にしない**（§5.6）。

### A.2 baseline を上げるときの手順

1. 冒頭の前提と §8.1 の baseline 条件を更新する（A.1 冒頭の版数は下限マーカーなので変えない）
2. A.1 で**下限が満たされた行を消す**（マーカーの役目が終わる）
3. **解禁された機能を自動で採用しない。** 採ると決めたら、規則の形にしてから本文に書く
4. §8.3 の検証をやり直す（依存を更新したときと同じ扱い）

### A.3 次の baseline 更新で決めること

- **`Temporal` を日時の第一選択にするか。** `Date` は可変・月が 0 始まり・タイムゾーンを持たない。`Temporal` は不変で、日付・時刻・タイムゾーンを別の型に分ける。§1 の「Java ライクな堅牢性」に照らすと `java.time` と同じ位置づけにあたるため、**採否を先送りせず A.2 の手順3で判断する**
