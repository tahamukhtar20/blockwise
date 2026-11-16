// The small expression language typed into slots, and how it becomes JavaScript.
//
//   numbers 3.5   text "hi"   true false   lists [1, 2]   names total
//   + - * / mod (also × ÷ −)   = ≠ < > ≤ ≥ (also == != <= >=)   and or not
//   list[0]   calls: isEven(n), length(x), random(1, 10) ...

export class LangError extends Error {}

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number };

const OPS = ["<=", ">=", "==", "!=", "≠", "≤", "≥", "=", "<", ">", "+", "-", "−", "*", "×", "/", "÷", "%", "(", ")", "[", "]", ","];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "”") {
      const close = c === "“" ? "”" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== close) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new LangError("This text is missing its closing quote");
      out.push({ t: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const o = OPS.find((op) => src.startsWith(op, i));
    if (!o) throw new LangError(`"${c}" is not something Blockwise understands`);
    out.push({ t: "op", v: o, pos: i });
    i += o.length;
  }
  out.push({ t: "eof", v: "", pos: src.length });
  return out;
}

export type Expr =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "var"; name: string }
  | { t: "list"; items: Expr[] }
  | { t: "index"; obj: Expr; idx: Expr }
  | { t: "call"; name: string; args: Expr[] }
  | { t: "un"; op: "-" | "!"; e: Expr }
  | { t: "bin"; op: string; l: Expr; r: Expr };

const CMP: Record<string, string> = { "=": "===", "==": "===", "!=": "!==", "≠": "!==", "<": "<", ">": ">", "<=": "<=", "≤": "<=", ">=": ">=", "≥": ">=" };
const ADD: Record<string, string> = { "+": "+", "-": "-", "−": "-" };
const MUL: Record<string, string> = { "*": "*", "×": "*", "/": "/", "÷": "/", "%": "%", mod: "%" };
const WORDS = new Set(["and", "or", "not", "mod", "true", "false"]);

export function parse(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isWord = (v: string) => peek().t === "id" && peek().v === v;
  const expect = (v: string, what: string) => {
    if (!isOp(v)) throw new LangError(`Expected ${what}`);
    next();
  };

  const or = (): Expr => {
    let l = and();
    while (isWord("or")) (next(), (l = { t: "bin", op: "||", l, r: and() }));
    return l;
  };
  const and = (): Expr => {
    let l = not();
    while (isWord("and")) (next(), (l = { t: "bin", op: "&&", l, r: not() }));
    return l;
  };
  const not = (): Expr => (isWord("not") ? (next(), { t: "un", op: "!", e: not() }) : cmp());
  const cmp = (): Expr => {
    const l = add();
    const t = peek();
    if (t.t === "op" && CMP[t.v]) {
      next();
      const r = add();
      const t2 = peek();
      if (t2.t === "op" && CMP[t2.v]) throw new LangError("Compare two things at a time, and join comparisons with and");
      return { t: "bin", op: CMP[t.v], l, r };
    }
    return l;
  };
  const add = (): Expr => {
    let l = mul();
    while (peek().t === "op" && ADD[peek().v]) {
      const op = ADD[next().v];
      l = { t: "bin", op, l, r: mul() };
    }
    return l;
  };
  const mul = (): Expr => {
    let l = unary();
    while ((peek().t === "op" && MUL[peek().v]) || isWord("mod")) {
      const op = MUL[next().v];
      l = { t: "bin", op, l, r: unary() };
    }
    return l;
  };
  const unary = (): Expr => {
    if (isOp("-") || isOp("−")) {
      next();
      return { t: "un", op: "-", e: unary() };
    }
    return postfix();
  };
  const postfix = (): Expr => {
    let e = primary();
    for (;;) {
      if (isOp("[")) {
        next();
        const idx = or();
        expect("]", "a closing ]");
        e = { t: "index", obj: e, idx };
      } else if (isOp("(")) {
        if (e.t !== "var") throw new LangError("Only a function name can be followed by (");
        next();
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(or());
          while (isOp(",")) (next(), args.push(or()));
        }
        expect(")", "a closing )");
        e = { t: "call", name: e.name, args };
      } else return e;
    }
  };
  const primary = (): Expr => {
    const t = next();
    if (t.t === "num") return { t: "num", v: t.v };
    if (t.t === "str") return { t: "str", v: t.v };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { t: "bool", v: t.v === "true" };
      if (WORDS.has(t.v)) throw new LangError(`"${t.v}" needs something on each side`);
      return { t: "var", name: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      const e = or();
      expect(")", "a closing )");
      return e;
    }
    if (t.t === "op" && t.v === "[") {
      const items: Expr[] = [];
      if (!isOp("]")) {
        items.push(or());
        while (isOp(",")) (next(), items.push(or()));
      }
      expect("]", "a closing ]");
      return { t: "list", items };
    }
    if (t.t === "eof") throw new LangError("Something is missing at the end");
    throw new LangError(`"${t.v}" is in an unexpected place`);
  };

  if (peek().t === "eof") throw new LangError("This slot is empty");
  const e = or();
  if (peek().t !== "eof") throw new LangError(`"${peek().v}" is in an unexpected place`);
  return e;
}

/** Comma-separated expressions (call arguments). Empty text means no arguments. */
export function parseArgs(src: string): Expr[] {
  if (!src.trim()) return [];
  const e = parse(`f(${src})`);
  return (e as Extract<Expr, { t: "call" }>).args;
}

// ---------------------------------------------------------------- names

const JS_RESERVED =
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async of arguments eval undefined NaN Infinity Math String Number Array Object JSON globalThis self window document console";
const HELPERS = "print random writeFile appendFile readFile";
const LANG = "and or not mod";

export const BUILTINS: Record<string, { min: number; max: number; js: (a: string[]) => string; doc: string }> = {
  random: { min: 2, max: 2, js: (a) => `random(${a.join(", ")})`, doc: "random(a, b)" },
  round: { min: 1, max: 1, js: (a) => `Math.round(${a[0]})`, doc: "round(x)" },
  floor: { min: 1, max: 1, js: (a) => `Math.floor(${a[0]})`, doc: "floor(x)" },
  ceil: { min: 1, max: 1, js: (a) => `Math.ceil(${a[0]})`, doc: "ceil(x)" },
  abs: { min: 1, max: 1, js: (a) => `Math.abs(${a[0]})`, doc: "abs(x)" },
  sqrt: { min: 1, max: 1, js: (a) => `Math.sqrt(${a[0]})`, doc: "sqrt(x)" },
  min: { min: 1, max: 20, js: (a) => `Math.min(${a.join(", ")})`, doc: "min(a, b)" },
  max: { min: 1, max: 20, js: (a) => `Math.max(${a.join(", ")})`, doc: "max(a, b)" },
  length: { min: 1, max: 1, js: (a) => `${a[0]}.length`, doc: "length(x)" },
  text: { min: 1, max: 1, js: (a) => `String(${a[0]})`, doc: "text(x)" },
  number: { min: 1, max: 1, js: (a) => `Number(${a[0]})`, doc: "number(x)" },
  upper: { min: 1, max: 1, js: (a) => `${a[0]}.toUpperCase()`, doc: "upper(text)" },
  lower: { min: 1, max: 1, js: (a) => `${a[0]}.toLowerCase()`, doc: "lower(text)" },
  lines: { min: 1, max: 1, js: (a) => `${a[0]}.split("\\n")`, doc: "lines(text)" },
  join: { min: 2, max: 2, js: (a) => `${a[0]}.join(${a[1]})`, doc: "join(list, separator)" },
  contains: { min: 2, max: 2, js: (a) => `${a[0]}.includes(${a[1]})`, doc: "contains(list, x)" },
};

const RESERVED = new Set([...JS_RESERVED.split(" "), ...HELPERS.split(" "), ...LANG.split(" "), ...Object.keys(BUILTINS)]);

/** Why a name can't be used, or null when it can. */
export function badName(name: string): string | null {
  if (!name) return "Give it a name";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return `"${name}" is not a valid name. Use letters and digits, starting with a letter`;
  if (Object.prototype.hasOwnProperty.call(BUILTINS, name)) return `"${name}" is already a built-in function. Pick another name`;
  if (RESERVED.has(name)) return `"${name}" is a reserved word. Pick another name`;
  return null;
}

// ---------------------------------------------------------------- emit

export interface EmitCtx {
  /** Called for every variable read; throws LangError if it can't be used here. */
  useVar: (name: string) => void;
  /** Arity of a user function, or undefined if there is none with this name. */
  fnArity: (name: string) => number | undefined;
  /** Generator calls for the instrumented version. */
  exec: boolean;
  /** Wraps a user function call in the instrumented version. */
  wrapCall?: (call: string) => string;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "===": 3, "!==": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function emit(e: Expr, ctx: EmitCtx, outer = 0): string {
  const wrap = (s: string, prec: number) => (prec < outer ? `(${s})` : s);
  switch (e.t) {
    case "num": {
      // Normalised, so 010 means ten and 1.length can't appear.
      const s = String(Number(e.v));
      return outer >= 9 ? `(${s})` : s;
    }
    case "str":
      return JSON.stringify(e.v);
    case "bool":
      return String(e.v);
    case "var":
      ctx.useVar(e.name);
      return e.name;
    case "list":
      return `[${e.items.map((x) => emit(x, ctx)).join(", ")}]`;
    case "index":
      return `${emit(e.obj, ctx, 9)}[${emit(e.idx, ctx)}]`;
    case "un":
      // "- -x" must not become "--x"
      return wrap(e.op + (e.op === "-" && e.e.t === "un" ? " " : "") + emit(e.e, ctx, 8), 8);
    case "bin": {
      const p = PREC[e.op];
      return wrap(`${emit(e.l, ctx, p)} ${e.op} ${emit(e.r, ctx, p + 1)}`, p);
    }
    case "call": {
      const b = Object.prototype.hasOwnProperty.call(BUILTINS, e.name) ? BUILTINS[e.name] : undefined;
      if (b) {
        if (e.args.length < b.min || e.args.length > b.max) throw new LangError(`${b.doc} takes ${b.min === b.max ? b.min : `${b.min} or more`} input${b.max === 1 ? "" : "s"}`);
        // Member-style builtins (length, upper ...) need their argument tightly bound.
        const member = b.js(["\0"]).startsWith("\0");
        return wrap(b.js(e.args.map((a, k) => emit(a, ctx, member && k === 0 ? 9 : 0))), 9);
      }
      const n = ctx.fnArity(e.name);
      if (n === undefined) throw new LangError(`There is no function called ${e.name}`);
      if (n !== e.args.length) throw new LangError(`${e.name} takes ${n} input${n === 1 ? "" : "s"}, not ${e.args.length}`);
      const call = `${e.name}(${e.args.map((a) => emit(a, ctx)).join(", ")})`;
      return ctx.exec ? (ctx.wrapCall ? ctx.wrapCall(call) : `(yield* ${call})`) : call;
    }
  }
}

/** True for a plain number literal, possibly negative; returns its value. */
export function literalNumber(e: Expr): number | null {
  if (e.t === "num") return Number(e.v);
  if (e.t === "un" && e.op === "-" && e.e.t === "num") return -Number(e.e.v);
  return null;
}
