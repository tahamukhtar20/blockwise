// What a running program can call, and the loop that drives it. Shared by the worker, step mode and tests.

export class BwError extends Error {}
class LimitError extends Error {}

export type Files = Record<string, string>;
export type Snap = () => Record<string, unknown>;
export type Gen = Generator<[number, number, Snap], unknown, void>;

export const MAX_LINES = 5000;
const MAX_FILE = 200_000;
const MAX_FILES = 50;

/** How a value is printed. Text inside lists keeps its quotes. */
export function fmt(v: unknown, inner = false): string {
  if (typeof v === "string") return inner ? JSON.stringify(v) : v;
  if (Array.isArray(v)) return `[${v.map((x) => fmt(x, true)).join(", ")}]`;
  if (typeof v === "number") return Number.isInteger(v) || !Number.isFinite(v) ? String(v) : String(Number(v.toPrecision(12)));
  return String(v);
}

const toText = (v: unknown) => (Array.isArray(v) ? v.map((x) => fmt(x)).join("\n") : fmt(v));

const fileName = (name: unknown) => {
  if (typeof name !== "string" || !name.trim()) throw new BwError("A file name must be text, such as \"notes.txt\"");
  const n = name.trim();
  if (n === "__proto__") throw new BwError("That file name can't be used");
  return n;
};
const has = (files: Files, n: string) => Object.prototype.hasOwnProperty.call(files, n);

export function makeRuntime(files: Files, out: (line: string) => void) {
  let lines = 0;
  const store = (name: string, text: string) => {
    if (!has(files, name) && Object.keys(files).length >= MAX_FILES) throw new BwError(`There can be at most ${MAX_FILES} files`);
    if (text.length > MAX_FILE) throw new BwError(`${name} would be too large (over ${MAX_FILE.toLocaleString("en")} characters)`);
    files[name] = text;
  };
  const checkIndex = (list: unknown[], i: unknown, name: string) => {
    if (typeof i !== "number" || !Number.isInteger(i)) throw new BwError(`An index must be a whole number, not ${fmt(i, true)}`);
    if (i < 0 || i >= list.length)
      throw new BwError(list.length ? `${name} has no index ${i}. It has ${list.length} item${list.length === 1 ? "" : "s"}, at index 0 to ${list.length - 1}` : `${name} is empty, so it has no index ${i}`);
  };
  const isList = (v: unknown, name: string): unknown[] => {
    if (!Array.isArray(v)) throw new BwError(`${name} is not a list. Set it to [] first`);
    return v;
  };
  return {
    print(v: unknown) {
      if (++lines > MAX_LINES) throw new LimitError();
      out(fmt(v));
    },
    random(a: unknown, b: unknown) {
      if (typeof a !== "number" || typeof b !== "number" || !Number.isInteger(a) || !Number.isInteger(b)) throw new BwError("random needs two whole numbers, such as random(1, 6)");
      const lo = Math.min(a, b);
      return lo + Math.floor(Math.random() * (Math.abs(b - a) + 1));
    },
    writeFile(name: unknown, v: unknown) {
      store(fileName(name), toText(v));
    },
    appendFile(name: unknown, v: unknown) {
      const n = fileName(name);
      const old = has(files, n) ? files[n] : "";
      store(n, old + (old && !old.endsWith("\n") ? "\n" : "") + toText(v));
    },
    readFile(name: unknown) {
      const n = fileName(name);
      if (!has(files, n)) throw new BwError(`There is no file called "${n}". Write it first, or add it in the Files tab`);
      return files[n];
    },
    __push(list: unknown, v: unknown, name: string) {
      isList(list, name).push(v);
    },
    __removeAt(list: unknown, i: unknown, name: string) {
      const l = isList(list, name);
      checkIndex(l, i, name);
      l.splice(i as number, 1);
    },
    __setItem(list: unknown, i: unknown, v: unknown, name: string) {
      const l = isList(list, name);
      checkIndex(l, i, name);
      l[i as number] = v;
    },
    __list(v: unknown) {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") return [...v];
      throw new BwError(`for each needs a list or text, not ${fmt(v, true)}`);
    },
  };
}
export type Runtime = ReturnType<typeof makeRuntime>;

/** Builds the program's main generator from the compiled exec code. */
export function load(exec: string, rt: Runtime): () => Gen {
  // __call pauses on the calling row again once a function returns, so later errors point at the right row.
  const prelude =
    "const { print, random, writeFile, appendFile, readFile, __push, __removeAt, __setItem, __list } = __rt;\n" +
    "function* __call(g, mark) { const v = yield* g; yield mark; return v; }\n";
  return new Function("__rt", prelude + exec)(rt) as () => Gen;
}

/** Plain-language version of an error thrown while running. */
export function friendly(e: unknown): string {
  if (e instanceof BwError) return e.message;
  if (e instanceof RangeError && /call stack/i.test(e.message)) return "Too many nested function calls. Check that the function reaches a return without calling itself forever";
  const m = e instanceof Error ? e.message : String(e);
  if (/toUpperCase|toLowerCase/.test(m) && /not a function/.test(m)) return "upper and lower only work on text";
  if (/\.split is not a function/.test(m)) return "lines needs text";
  if (/\.join is not a function/.test(m)) return "join needs a list";
  if (/\.includes is not a function/.test(m)) return "contains needs a list or text";
  if (/reading 'length'/.test(m)) return "length needs a list or text, but this value is not set yet";
  if (/Cannot read properties of (undefined|null)/.test(m)) return "A value used here is not set yet";
  return `JavaScript error: ${m}`;
}

export type Outcome =
  | { status: "done" }
  | { status: "timeout"; row: number; loopRow: number }
  | { status: "limit"; row: number }
  | { status: "error"; row: number; msg: string };

export interface Cursor {
  row: number;
  loopRow: number;
  snap: Snap | null;
}

/** Runs until the program ends, fails, or the time limit passes. */
export function drive(gen: Gen, limitMs: number, cur: Cursor = { row: -1, loopRow: -1, snap: null }): Outcome {
  const t0 = performance.now();
  let steps = 0;
  try {
    for (;;) {
      const r = gen.next();
      if (r.done) return { status: "done" };
      cur.row = r.value[0];
      cur.snap = r.value[2];
      if (r.value[1]) cur.loopRow = cur.row;
      if ((++steps & 1023) === 0 && performance.now() - t0 > limitMs) return { status: "timeout", row: cur.row, loopRow: cur.loopRow };
    }
  } catch (e) {
    if (e instanceof LimitError) return { status: "limit", row: cur.row };
    return { status: "error", row: cur.row, msg: friendly(e) };
  }
}

/** One step: runs the current row and pauses before the next one. */
export function step(gen: Gen, cur: Cursor): Outcome | null {
  try {
    const r = gen.next();
    if (r.done) return { status: "done" };
    cur.row = r.value[0];
    cur.snap = r.value[2];
    if (r.value[1]) cur.loopRow = cur.row;
    return null;
  } catch (e) {
    if (e instanceof LimitError) return { status: "limit", row: cur.row };
    return { status: "error", row: cur.row, msg: friendly(e) };
  }
}

/** Variable values for the step strip: set values only, internal counters hidden. */
export function variables(snap: Snap | null): { name: string; value: string }[] {
  if (!snap) return [];
  let vals: Record<string, unknown>;
  try {
    vals = snap();
  } catch {
    return [];
  }
  return Object.entries(vals)
    .filter(([k, v]) => !k.startsWith("_") && v !== undefined)
    .map(([name, v]) => {
      const s = fmt(v, true);
      return { name, value: s.length > 48 ? s.slice(0, 47) + "…" : s };
    });
}
