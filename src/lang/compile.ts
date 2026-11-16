// Turns the list of rows into JavaScript.
//
// Two versions come out of one walk:
//   lines: readable JavaScript shown in the code panel, with the row each line came from.
//   exec:  the same program as a generator that pauses before every row, used to run and step it.

import { BLOCKS, isContainer, type Kind } from "./blocks.ts";
import { badName, emit, LangError, literalNumber, parse, parseArgs, type Expr } from "./expr.ts";

export interface Row {
  id: string;
  kind: Kind;
  depth: number;
  slots: Record<string, string>;
}
export interface Problem {
  row: number;
  slot?: string;
  msg: string;
}
export interface CodeLine {
  text: string;
  row: number | null;
}
export interface Compiled {
  problems: Problem[];
  lines: CodeLine[];
  /** Body of the runnable generator, or null when there are problems. */
  exec: string | null;
  /** Display line indices for each row. */
  rowLines: number[][];
  vars: string[];
  fns: { name: string; arity: number }[];
}

interface Node {
  i: number;
  row: Row;
  depth: number;
  kids: Node[];
}

const label = (k: Kind) => (BLOCKS.get(k)!.parts[0] as string);

function build(rows: Row[], problems: Problem[]): Node[] {
  const root: Node[] = [];
  const stack: Node[] = [];
  let prev = -1;
  rows.forEach((row, i) => {
    let d = Math.max(0, Math.floor(row.depth || 0));
    if (d > prev + 1) {
      problems.push({ row: i, msg: "This row is indented further than the row above allows. Move it left" });
      d = prev + 1;
    }
    const node: Node = { i, row, depth: d, kids: [] };
    if (d === 0) root.push(node);
    else {
      const parent = stack[d - 1];
      if (!isContainer(parent.row.kind)) problems.push({ row: i, msg: `A ${label(parent.row.kind)} row can't hold other rows. Move this row left` });
      parent.kids.push(node);
    }
    stack[d] = node;
    stack.length = d + 1;
    prev = d;
  });
  return root;
}

const tryParse = (s: string | undefined): Expr | null => {
  try {
    return s && s.trim() ? parse(s) : null;
  } catch {
    return null;
  }
};

function exprVars(e: Expr | null, out: Set<string>) {
  if (!e) return;
  switch (e.t) {
    case "var":
      out.add(e.name);
      break;
    case "list":
      e.items.forEach((x) => exprVars(x, out));
      break;
    case "index":
      exprVars(e.obj, out);
      exprVars(e.idx, out);
      break;
    case "call":
      e.args.forEach((x) => exprVars(x, out));
      break;
    case "un":
      exprVars(e.e, out);
      break;
    case "bin":
      exprVars(e.l, out);
      exprVars(e.r, out);
      break;
  }
}

/** Every name a row mentions, read or written. */
function mentions(row: Row): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(row.slots)) {
    if (k === "name" || k === "list") {
      if (row.kind === "foreach" && k === "list") exprVars(tryParse(v), out);
      else if (row.kind !== "function" && row.kind !== "call") out.add(v.trim());
    } else if (k === "args") {
      try {
        parseArgs(v).forEach((a) => exprVars(a, out));
      } catch {
        /* reported later */
      }
    } else if (k !== "params") exprVars(tryParse(v), out);
  }
  return out;
}

const assigns = (row: Row) => (row.kind === "set" || row.kind === "read" ? row.slots.name?.trim() || null : null);

function flat(nodes: Node[], skipFns: boolean, out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (skipFns && n.row.kind === "function") continue;
    out.push(n);
    flat(n.kids, skipFns, out);
  }
  return out;
}

interface Scope {
  fn: string | null;
  base: number;
  params: string[];
  /** Names declared with let at the top of this scope (display), or all of them (exec). */
  names: Set<string>;
  /** name -> row where the display version declares it inline. */
  inlineAt: Map<string, number>;
  known: Set<string>;
  loops: string[];
}

const COUNTERS = ["_i", "_j", "_k", "_l", "_m", "_n"];

export function compile(rows: Row[]): Compiled {
  const problems: Problem[] = [];
  const lines: CodeLine[] = [];
  const rowLines: number[][] = rows.map(() => []);
  const ex: string[] = [];
  const bad = new Set<number>();
  const problem = (row: number, msg: string, slot?: string) => {
    problems.push({ row, msg, slot });
    bad.add(row);
  };

  const root = build(rows, problems);

  // ---- functions
  const fns = new Map<string, { arity: number; params: string[]; node: Node }>();
  const allFns = flat(root, false).filter((n) => n.row.kind === "function");
  for (const n of allFns) {
    const name = n.row.slots.name?.trim() ?? "";
    const why = badName(name);
    if (why) {
      problem(n.i, why, "name");
      continue;
    }
    if (n.depth > 0) problem(n.i, "Functions go at the top level, not inside other rows");
    if (fns.has(name)) problem(n.i, `There is already a function called ${name}`, "name");
    const raw = n.row.slots.params?.trim() ?? "";
    const params = raw ? raw.split(",").map((p) => p.trim()) : [];
    for (const p of params) {
      const w = badName(p);
      if (w) problem(n.i, w === "Give it a name" ? "An input name is missing between commas" : w, "params");
    }
    if (new Set(params).size !== params.length) problem(n.i, "Two inputs have the same name", "params");
    fns.set(name, { arity: params.length, params, node: n });
  }
  const fnArity = (name: string) => fns.get(name)?.arity;

  // ---- scopes
  const progNodes = flat(root, true);
  const globals = new Set<string>();
  for (const n of progNodes) {
    const a = assigns(n.row);
    if (a && !badName(a)) globals.add(a);
  }
  for (const f of fns.values()) for (const p of f.params) if (fns.has(p)) problem(f.node.i, `${p} is already the name of a function`, "params");
  // Globals that functions use are declared at the top, so calling a function early never hits an undeclared name.
  const usedInFns = new Set<string>();
  for (const f of allFns) for (const b of flat(f.kids, false)) mentions(b.row).forEach((x) => usedInFns.add(x));

  const inlineFor = (nodes: Node[], names: Set<string>, base: number) => {
    const at = new Map<string, number>();
    const seen = new Set<string>();
    for (const n of nodes) {
      const m = mentions(n.row);
      const a = assigns(n.row);
      if (a && names.has(a) && !seen.has(a) && n.depth === base && !(base === 0 && usedInFns.has(a))) {
        const own = new Set<string>();
        for (const [k, v] of Object.entries(n.row.slots)) if (k !== "name") exprVars(tryParse(v), own);
        if (!own.has(a)) at.set(a, n.i);
      }
      m.forEach((x) => seen.add(x));
    }
    return at;
  };

  const allVars = new Set<string>(globals);

  // ---- emit helpers
  const ind = (n: number) => "  ".repeat(n);
  const L = (level: number, text: string, row: number | null) => {
    if (row !== null) rowLines[row].push(lines.length);
    lines.push({ text: ind(level) + text, row });
  };
  const X = (s: string) => ex.push(s);

  const useVarIn = (sc: Scope) => (name: string) => {
    if (sc.known.has(name) || sc.loops.includes(name) || sc.params.includes(name)) return;
    if (sc.fn && globals.has(name)) return;
    if (fns.has(name)) throw new LangError(`${name} is a function. Call it with ${name}(...)`);
    if (sc.names.has(name) || (!sc.fn && globals.has(name))) throw new LangError(`${name} is used before it is set`);
    if (allVars.has(name)) throw new LangError(`${name} is not available here`);
    throw new LangError(`There is no variable called ${name}`);
  };

  const snap = (sc: Scope) => {
    const names = new Set<string>([...sc.params, ...(sc.fn ? globals : []), ...sc.names, ...sc.loops]);
    return `() => ({${[...names].join(", ")}})`;
  };
  const Y = (sc: Scope, i: number, loop = false) => X(`yield [${i}, ${loop ? 1 : 0}, ${snap(sc)}];`);

  const expr = (sc: Scope, i: number, key: string, optional = false, outer = 0): { d: string; x: string } | null => {
    const src = rows[i].slots[key] ?? "";
    if (!src.trim()) {
      if (optional) return null;
      problem(i, "Fill in the empty slot", key);
      return { d: "/* ? */", x: "undefined" };
    }
    try {
      const e = parse(src);
      const d = emit(e, { useVar: useVarIn(sc), fnArity, exec: false }, outer);
      const x = emit(e, { useVar: () => {}, fnArity, exec: true, wrapCall: (c) => `(yield* __call(${c}, [${i}, 0, ${snap(sc)}]))` }, outer);
      return { d, x };
    } catch (err) {
      if (!(err instanceof LangError)) throw err;
      problem(i, err.message, key);
      return { d: "/* ? */", x: "undefined" };
    }
  };

  const varSlot = (i: number, key = "name") => {
    const name = rows[i].slots[key]?.trim() ?? "";
    const why = badName(name);
    if (why) {
      problem(i, why, key);
      return name || "/* ? */";
    }
    if (fns.has(name)) problem(i, `${name} is already the name of a function`, key);
    return name;
  };

  const needKnown = (sc: Scope, i: number, key: string, verb: string) => {
    const name = varSlot(i, key);
    if (bad.has(i)) return name;
    try {
      useVarIn(sc)(name);
    } catch {
      problem(i, `Set ${name} before ${verb} it`, key);
    }
    return name;
  };

  // ---- statements
  const block = (nodes: Node[], sc: Scope, level: number) => {
    let k = 0;
    while (k < nodes.length) {
      const n = nodes[k];
      if (n.row.kind === "if") {
        // An if takes the else if / else rows that directly follow it.
        let j = k + 1;
        while (j < nodes.length && nodes[j].row.kind === "elseif") j++;
        if (j < nodes.length && nodes[j].row.kind === "else") j++;
        ifChain(nodes.slice(k, j), sc, level);
        k = j;
        continue;
      }
      if (n.row.kind === "elseif" || n.row.kind === "else") {
        problem(n.i, `${label(n.row.kind)} needs an if (or else if) right above it, at the same indent`);
        L(level, `${n.row.kind === "else" ? "else" : "else if (…)"} {`, n.i);
        block(n.kids, sc, level + 1);
        L(level, "}", null);
        k++;
        continue;
      }
      stmt(n, sc, level);
      k++;
    }
  };

  const ifChain = (chain: Node[], sc: Scope, level: number) => {
    let closers = 0;
    chain.forEach((n, idx) => {
      const head = idx === 0 ? "" : "} ";
      if (n.row.kind === "else") {
        L(level, `${head}else {`, n.i);
        X("else {");
      } else {
        const c = expr(sc, n.i, "cond")!;
        L(level, `${head}${idx === 0 ? "if" : "else if"} (${c.d}) {`, n.i);
        if (idx > 0) {
          X("else {");
          closers++;
        }
        Y(sc, n.i);
        X(`if (${c.x}) {`);
      }
      block(n.kids, sc, level + 1);
      X("}");
    });
    L(level, "}", null);
    for (let c = 0; c < closers; c++) X("}");
  };

  const loopVar = (sc: Scope, name: string) => !sc.names.has(name) && !sc.params.includes(name) && !sc.known.has(name);

  const stmt = (n: Node, sc: Scope, level: number) => {
    const i = n.i;
    const r = n.row;
    const s = (k: string, opt = false, outer = 0) => expr(sc, i, k, opt, outer);
    switch (r.kind) {
      case "set":
      case "read": {
        const v = varSlot(i);
        const val = r.kind === "set" ? s("value")! : (() => {
          const f = s("file")!;
          return { d: `readFile(${f.d})`, x: `readFile(${f.x})` };
        })();
        L(level, `${sc.inlineAt.get(v) === i ? "let " : ""}${v} = ${val.d};`, i);
        Y(sc, i);
        X(`${v} = ${val.x};`);
        if (!badName(v)) sc.known.add(v);
        return;
      }
      case "change": {
        const v = needKnown(sc, i, "name", "changing");
        const by = s("by")!;
        L(level, `${v} += ${by.d};`, i);
        Y(sc, i);
        X(`${v} += ${by.x};`);
        return;
      }
      case "print": {
        const v = s("value")!;
        L(level, `print(${v.d});`, i);
        Y(sc, i);
        X(`print(${v.x});`);
        return;
      }
      case "while": {
        const c = s("cond")!;
        L(level, `while (${c.d}) {`, i);
        X("while (true) {");
        Y(sc, i, true);
        X(`if (!(${c.x})) break;`);
        block(n.kids, sc, level + 1);
        X("}");
        L(level, "}", null);
        return;
      }
      case "repeat": {
        const t = s("times", false, 5)!;
        const depth = sc.loops.filter((x) => x.startsWith("_")).length;
        const c = COUNTERS[depth] ?? `_r${depth}`;
        L(level, `for (let ${c} = 0; ${c} < ${t.d}; ${c}++) {`, i);
        X(`for (let ${c} = 0; ; ${c}++) {`);
        sc.loops.push(c);
        Y(sc, i, true);
        X(`if (!(${c} < ${t.x})) break;`);
        block(n.kids, sc, level + 1);
        sc.loops.pop();
        X("}");
        L(level, "}", null);
        return;
      }
      case "for": {
        const v = varSlot(i);
        const a = s("from")!;
        const b = s("to", false, 5)!;
        const st = s("step", true, 5);
        const local = loopVar(sc, v);
        if (!badName(v)) allVars.add(v);
        const decl = local ? "let " : "";
        const k = st ? literalNumber(tryParse(r.slots.step) ?? { t: "var", name: "" }) : 1;
        if (k === 0) problem(i, "The step can't be 0", "step");
        let cond: string, upd: string, condX: string, updX: string;
        if (k !== null && k > 0) {
          cond = `${v} <= ${b.d}`;
          condX = `${v} <= ${b.x}`;
          upd = k === 1 ? `${v}++` : `${v} += ${k}`;
        } else if (k !== null && k < 0) {
          cond = `${v} >= ${b.d}`;
          condX = `${v} >= ${b.x}`;
          upd = k === -1 ? `${v}--` : `${v} -= ${-k}`;
        } else {
          cond = `${st!.d} > 0 ? ${v} <= ${b.d} : ${v} >= ${b.d}`;
          condX = `(${st!.x}) > 0 ? ${v} <= ${b.x} : ${v} >= ${b.x}`;
          upd = `${v} += ${st!.d}`;
        }
        updX = k === null ? `${v} += ${st!.x}` : upd;
        L(level, `for (${decl}${v} = ${a.d}; ${cond}; ${upd}) {`, i);
        X(`for (${decl}${v} = ${a.x}; ; ${updX}) {`);
        if (local) sc.loops.push(v);
        Y(sc, i, true);
        X(`if (!(${condX})) break;`);
        if (!local) sc.known.add(v);
        block(n.kids, sc, level + 1);
        if (local) sc.loops.pop();
        X("}");
        L(level, "}", null);
        return;
      }
      case "foreach": {
        const v = varSlot(i);
        const list = s("list")!;
        const local = loopVar(sc, v);
        if (!badName(v)) allVars.add(v);
        L(level, `for (${local ? "let " : ""}${v} of ${list.d}) {`, i);
        X(`for (${local ? "let " : ""}${v} of __list(${list.x})) {`);
        if (local) sc.loops.push(v);
        else sc.known.add(v);
        Y(sc, i, true);
        block(n.kids, sc, level + 1);
        if (local) sc.loops.pop();
        X("}");
        L(level, "}", null);
        return;
      }
      case "function": {
        const name = r.slots.name?.trim() || "/* ? */";
        const f = fns.get(name);
        const params = f?.params ?? [];
        const body = flat(n.kids, false);
        const locals = new Set<string>();
        for (const b of body) {
          const a = assigns(b.row);
          if (a && !badName(a) && !globals.has(a) && !params.includes(a)) locals.add(a);
        }
        locals.forEach((x) => allVars.add(x));
        params.forEach((x) => allVars.add(x));
        const inner: Scope = { fn: name, base: n.depth + 1, params, names: locals, inlineAt: inlineFor(body, locals, n.depth + 1), known: new Set(), loops: [] };
        L(level, `function ${name}(${params.join(", ")}) {`, i);
        const hoist = [...locals].filter((x) => !inner.inlineAt.has(x));
        if (hoist.length) L(level + 1, `let ${hoist.join(", ")};`, null);
        X(`function* ${name}(${params.join(", ")}) {`);
        if (locals.size) X(`let ${[...locals].join(", ")};`);
        block(n.kids, inner, level + 1);
        X("}");
        L(level, "}", null);
        return;
      }
      case "return": {
        if (!sc.fn) problem(i, "return only works inside a function");
        const v = s("value", true);
        L(level, v ? `return ${v.d};` : "return;", i);
        Y(sc, i);
        X(v ? `return ${v.x};` : "return;");
        return;
      }
      case "call": {
        const name = r.slots.name?.trim() ?? "";
        let args: Expr[] = [];
        let d = "/* ? */";
        let x = "";
        if (!name) problem(i, "Pick which function to call", "name");
        else if (!fns.has(name)) problem(i, `There is no function called ${name}`, "name");
        try {
          args = parseArgs(r.slots.args ?? "");
          const n2 = fnArity(name);
          if (n2 !== undefined && n2 !== args.length) problem(i, `${name} takes ${n2} input${n2 === 1 ? "" : "s"}, not ${args.length}`, "args");
          d = args.map((a) => emit(a, { useVar: useVarIn(sc), fnArity, exec: false })).join(", ");
          x = args.map((a) => emit(a, { useVar: () => {}, fnArity, exec: true, wrapCall: (c) => `(yield* __call(${c}, [${i}, 0, ${snap(sc)}]))` })).join(", ");
        } catch (err) {
          if (!(err instanceof LangError)) throw err;
          problem(i, err.message, "args");
        }
        L(level, `${name || "/* ? */"}(${d});`, i);
        Y(sc, i);
        X(`yield* ${name}(${x});`);
        return;
      }
      case "add": {
        const v = s("value")!;
        const list = needKnown(sc, i, "list", "adding to");
        L(level, `${list}.push(${v.d});`, i);
        Y(sc, i);
        X(`__push(${list}, ${v.x}, ${JSON.stringify(list)});`);
        return;
      }
      case "removeAt": {
        const idx = s("index")!;
        const list = needKnown(sc, i, "list", "removing from");
        L(level, `${list}.splice(${idx.d}, 1);`, i);
        Y(sc, i);
        X(`__removeAt(${list}, ${idx.x}, ${JSON.stringify(list)});`);
        return;
      }
      case "setItem": {
        const idx = s("index")!;
        const list = needKnown(sc, i, "list", "changing");
        const v = s("value")!;
        L(level, `${list}[${idx.d}] = ${v.d};`, i);
        Y(sc, i);
        X(`__setItem(${list}, ${idx.x}, ${v.x}, ${JSON.stringify(list)});`);
        return;
      }
      case "write":
      case "append": {
        const v = s("value")!;
        const f = s("file")!;
        const fn = r.kind === "write" ? "writeFile" : "appendFile";
        L(level, `${fn}(${f.d}, ${v.d});`, i);
        Y(sc, i);
        X(`${fn}(${f.x}, ${v.x});`);
        return;
      }
      case "if":
      case "elseif":
      case "else":
        return; // handled by block()
    }
  };

  const prog: Scope = { fn: null, base: 0, params: [], names: globals, inlineAt: inlineFor(progNodes, globals, 0), known: new Set(), loops: [] };
  const hoist = [...globals].filter((g) => !prog.inlineAt.has(g));
  if (hoist.length) {
    L(0, `let ${hoist.join(", ")};`, null);
    L(0, "", null);
  }
  X("return function* __main() {");
  if (globals.size) X(`let ${[...globals].join(", ")};`);
  block(root, prog, 0);
  X("};");

  problems.sort((a, b) => a.row - b.row);
  return {
    problems,
    lines,
    exec: problems.length ? null : ex.join("\n"),
    rowLines,
    vars: [...allVars],
    fns: [...fns].map(([name, f]) => ({ name, arity: f.arity })),
  };
}
