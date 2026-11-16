// App state: the program, selection, undo history and the current run.
import { useSyncExternalStore } from "react";
import { BLOCKS, KINDS, type Cat, type Kind } from "./lang/blocks.ts";
import { compile, type Compiled, type Row } from "./lang/compile.ts";
import { EXAMPLES } from "./lang/examples.ts";
import * as R from "./lang/rows.ts";
import { drive, load, makeRuntime, step as stepOnce, variables, type Cursor, type Files, type Gen, type Outcome } from "./lang/runtime.ts";

export const LIMIT_MS = 2000;
const KEY = "blockwise:v1";

export type OutLine = { text: string; kind: "out" | "info" | "err"; row?: number };
export type Status =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "stepping"; n: number }
  | { kind: "done"; ms: number }
  | { kind: "stopped" }
  | { kind: "problems"; count: number }
  | { kind: "error"; row: number; msg: string }
  | { kind: "timeout"; row: number; msg: string };

interface Snapshot {
  rows: Row[];
  files: Files;
}

export interface State {
  rows: Row[];
  files: Files;
  sel: string | null;
  tab: Cat;
  /** The slot that last had focus, for inserting operators. */
  focus: { row: string; slot: string; start: number; end: number } | null;
  pendingFocus: { row: string; slot: string; caret?: number; selectAll?: boolean } | null;
  showProblems: boolean;
  past: Snapshot[];
  future: Snapshot[];
  phase: "idle" | "running" | "stepping";
  output: OutLine[];
  status: Status;
  stepRow: number | null;
  vars: { name: string; value: string }[];
  toast: { id: number; msg: string; undo: boolean } | null;
  view: "blocks" | "code" | "output";
  outTab: "output" | "files";
  openFile: string | null;
  hover: number | null;
  split: number;
  menu: boolean;
}

// ---------------------------------------------------------------- persistence

function sanitize(raw: unknown): { rows: Row[]; files: Files; split?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { rows?: unknown; files?: unknown; split?: unknown };
  if (!Array.isArray(o.rows)) return null;
  const rows: Row[] = [];
  for (const r of o.rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Partial<Row>;
    if (!KINDS.includes(x.kind as Kind)) continue;
    const slots: Record<string, string> = { ...BLOCKS.get(x.kind as Kind)!.defaults };
    if (x.slots && typeof x.slots === "object") for (const k of Object.keys(slots)) if (typeof x.slots[k] === "string") slots[k] = x.slots[k].slice(0, 500);
    const depth = Number.isInteger(x.depth) && (x.depth as number) >= 0 ? Math.min(x.depth as number, 20) : 0;
    rows.push({ id: R.newId(), kind: x.kind as Kind, depth, slots });
  }
  const files: Files = {};
  if (o.files && typeof o.files === "object") for (const [k, v] of Object.entries(o.files as object)) if (typeof v === "string" && k.trim()) files[k.slice(0, 80)] = v.slice(0, 200_000);
  const split = typeof o.split === "number" && o.split > 0.15 && o.split < 0.85 ? o.split : undefined;
  return { rows: rows.slice(0, 400), files, split };
}

const exampleRows = (id: string): Snapshot => {
  const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
  return {
    rows: ex.rows.map(([depth, kind, slots]) => ({ id: R.newId(), kind, depth, slots: { ...BLOCKS.get(kind)!.defaults, ...slots } })),
    files: { ...(ex.files ?? {}) },
  };
};

function initial(): State {
  let saved: ReturnType<typeof sanitize> = null;
  try {
    saved = sanitize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    saved = null;
  }
  const start = saved ?? exampleRows("evens");
  return {
    rows: start.rows,
    files: start.files,
    sel: null,
    tab: "control",
    focus: null,
    pendingFocus: null,
    showProblems: false,
    past: [],
    future: [],
    phase: "idle",
    output: [],
    status: { kind: "none" },
    stepRow: null,
    vars: [],
    toast: null,
    view: "blocks",
    outTab: "output",
    openFile: null,
    hover: null,
    split: saved?.split ?? 0.58,
    menu: false,
  };
}

// ---------------------------------------------------------------- store

let state: State = initial();
const subs = new Set<() => void>();
let saveTimer = 0;

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  const prev = state;
  state = { ...state, ...p };
  if (prev.rows !== state.rows || prev.files !== state.files || prev.split !== state.split) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 300);
  }
  subs.forEach((f) => f());
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ rows: state.rows.map(({ kind, depth, slots }) => ({ kind, depth, slots })), files: state.files, split: state.split }));
  } catch {
    /* storage full or blocked: the editor keeps working */
  }
}
addEventListener("pagehide", save);

export const get = () => state;
export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => pick(state),
  );
}

let compiledFor: Row[] | null = null;
let compiled: Compiled;
export function getCompiled(rows = state.rows): Compiled {
  if (rows !== compiledFor) {
    compiled = compile(rows);
    compiledFor = rows;
  }
  return compiled;
}
export const useCompiled = () => getCompiled(useStore((s) => s.rows));

// ---------------------------------------------------------------- history

let lastEdit = { key: "", at: 0 };

/** Applies a program change and records it for undo. Typing in one slot within a short time counts as one change. */
function commit(next: Partial<Snapshot> & Partial<State>, coalesce?: string) {
  const now = Date.now();
  const merge = coalesce && coalesce === lastEdit.key && now - lastEdit.at < 1200;
  lastEdit = { key: coalesce ?? "", at: now };
  stopStep();
  set((s) => ({
    ...afterEdit(s),
    toast: null,
    ...next,
    past: merge ? s.past : [...s.past.slice(-99), { rows: s.rows, files: s.files }],
    future: [],
  }));
}

/** An edit leaves step mode and clears run results that point at rows. */
function afterEdit(s: State): Partial<State> {
  return {
    phase: s.phase === "stepping" ? "idle" : s.phase,
    stepRow: null,
    vars: [],
    status: s.phase === "stepping" || s.status.kind === "error" || s.status.kind === "timeout" ? { kind: "none" } : s.status,
  };
}

export function undo() {
  const s = state;
  if (!s.past.length) return;
  lastEdit = { key: "", at: 0 };
  stopStep();
  set({ ...afterEdit(s), rows: s.past[s.past.length - 1].rows, files: s.past[s.past.length - 1].files, past: s.past.slice(0, -1), future: [{ rows: s.rows, files: s.files }, ...s.future], toast: null });
}
export function redo() {
  const s = state;
  if (!s.future.length) return;
  lastEdit = { key: "", at: 0 };
  stopStep();
  set({ ...afterEdit(s), rows: s.future[0].rows, files: s.future[0].files, future: s.future.slice(1), past: [...s.past, { rows: s.rows, files: s.files }], toast: null });
}

let toastN = 0;
let toastTimer = 0;
export function toast(msg: string, undoable = false) {
  clearTimeout(toastTimer);
  set({ toast: { id: ++toastN, msg, undo: undoable } });
  toastTimer = window.setTimeout(() => set({ toast: null }), 5000);
}
export const dismissToast = () => set({ toast: null });

// ---------------------------------------------------------------- editing

export const ui = (p: Partial<State>) => set(p);
const idx = (id: string | null) => (id ? state.rows.findIndex((r) => r.id === id) : -1);

export function select(id: string | null) {
  if (state.sel !== id) set({ sel: id, focus: state.focus && state.focus.row !== id ? null : state.focus });
}

export function setSlot(rowId: string, key: string, value: string) {
  const rows = state.rows.map((r) => (r.id === rowId ? { ...r, slots: { ...r.slots, [key]: value } } : r));
  commit({ rows }, `${rowId}:${key}`);
}

const firstSlot = (row: Row) => {
  const slots = BLOCKS.get(row.kind)!.parts.filter((p) => typeof p !== "string") as { key: string; optional?: boolean }[];
  return slots.find((s) => !row.slots[s.key] && !s.optional) ?? slots[0];
};

export function add(kind: Kind | "ifelse", at?: { index: number; depth: number }) {
  const pos = at ?? R.insertPoint(state.rows, idx(state.sel), kind);
  const made = kind === "ifelse" ? [R.newRow("if", pos.depth), R.newRow("else", pos.depth)] : [R.newRow(kind, pos.depth)];
  const rows = R.insert(state.rows, pos.index, made);
  const head = made[0];
  const slot = firstSlot(head);
  commit({ rows, sel: head.id, pendingFocus: slot ? { row: head.id, slot: slot.key, selectAll: true } : null, view: "blocks" });
}

export function removeRow(id: string) {
  const i = idx(id);
  if (i < 0) return;
  const count = R.subtreeEnd(state.rows, i) - i;
  const rows = R.remove(state.rows, i);
  const nextSel = rows[Math.min(i, rows.length - 1)]?.id ?? null;
  commit({ rows, sel: nextSel });
  toast(count > 1 ? `Deleted ${count} rows` : "Deleted 1 row", true);
}

export function moveRow(id: string, op: "up" | "down" | "indent" | "outdent") {
  const i = idx(id);
  if (i < 0) return;
  const rows = op === "up" ? R.move(state.rows, i, -1) : op === "down" ? R.move(state.rows, i, 1) : op === "indent" ? R.indent(state.rows, i) : R.outdent(state.rows, i);
  if (rows !== state.rows) commit({ rows });
}

export function dropRow(id: string, gap: number, depth: number) {
  const i = idx(id);
  if (i < 0) return;
  const g = R.gapWithout(state.rows, i, gap);
  if (g === null) return;
  const rows = R.moveTo(state.rows, i, g, depth);
  if (rows.some((r, k) => r !== state.rows[k])) commit({ rows, sel: id });
}

/** Puts operator or function text into the slot that last had focus. */
export function insertText(text: string, caret?: number) {
  const f = state.focus;
  const row = f && state.rows.find((r) => r.id === f.row);
  if (!f || !row) return false;
  const cur = row.slots[f.slot] ?? "";
  let start = Math.min(f.start, cur.length);
  const end = Math.min(f.end, cur.length);
  let t = text;
  // Avoid doubled spaces around operators.
  if (t.startsWith(" ") && (start === 0 || cur[start - 1] === " ")) t = t.trimStart();
  if (t.endsWith(" ") && cur[end] === " ") t = t.trimEnd();
  const value = cur.slice(0, start) + t + cur.slice(end);
  const pos = start + (caret ?? t.length);
  setSlot(row.id, f.slot, value);
  lastEdit = { key: "", at: 0 };
  start = pos;
  set({ focus: { row: row.id, slot: f.slot, start, end: start }, pendingFocus: { row: row.id, slot: f.slot, caret: pos } });
  return true;
}

export function loadExample(id: string | null) {
  const snap: Snapshot = id ? exampleRows(id) : { rows: [], files: {} };
  commit({ ...snap, sel: null, showProblems: false, menu: false, output: [], status: { kind: "none" }, focus: null });
  const ex = EXAMPLES.find((e) => e.id === id);
  toast(ex ? `Opened ${ex.title}` : "Started a new program", true);
}

export function setFile(name: string, text: string) {
  commit({ files: { ...state.files, [name]: text } }, `file:${name}`);
}
export function deleteFile(name: string) {
  const files = { ...state.files };
  delete files[name];
  commit({ files, openFile: state.openFile === name ? null : state.openFile });
  toast(`Deleted ${name}`, true);
}
export function renameFile(from: string, to: string) {
  if (from === to || !to.trim() || to in state.files) return false;
  const files: Files = {};
  for (const [k, v] of Object.entries(state.files)) files[k === from ? to : k] = v;
  commit({ files, openFile: to });
  return true;
}

// ---------------------------------------------------------------- running

let worker: Worker | null = null;
let backstop = 0;
let session: { gen: Gen; cur: Cursor; files: Files; start: Files; steps: number; buf: OutLine[] } | null = null;

function stopStep() {
  session = null;
}

function blocked(): boolean {
  const c = getCompiled();
  if (!c.problems.length) return false;
  set({
    showProblems: true,
    phase: "idle",
    status: { kind: "problems", count: c.problems.length },
    output: c.problems.map((p) => ({ text: `Row ${p.row + 1}: ${p.msg}`, kind: "err" as const, row: p.row })),
    outTab: "output",
    view: matchMedia("(max-width: 760px)").matches ? "blocks" : state.view,
    sel: state.rows[c.problems[0].row]?.id ?? state.sel,
  });
  return true;
}

function finish(o: Outcome, output: OutLine[], files: Files, ms: number, start: Files) {
  let status: Status = { kind: "done", ms };
  const extra: OutLine[] = [];
  if (o.status === "error") {
    status = { kind: "error", row: o.row, msg: o.msg };
    extra.push({ text: o.row >= 0 ? `Row ${o.row + 1}: ${o.msg}` : o.msg, kind: "err", row: o.row >= 0 ? o.row : undefined });
  } else if (o.status === "timeout") {
    const r = o.loopRow >= 0 ? o.loopRow : o.row;
    const msg = r >= 0 ? `Stopped after ${LIMIT_MS / 1000} s. The loop on row ${r + 1} did not finish.` : `Stopped after ${LIMIT_MS / 1000} s. The program did not finish.`;
    status = { kind: "timeout", row: r, msg };
    extra.push({ text: msg, kind: "err", row: r });
  } else if (o.status === "limit") {
    status = { kind: "stopped" };
    extra.push({ text: "Stopped after 5,000 lines of output.", kind: "info" });
  }
  const changed = Object.keys(files).filter((k) => files[k] !== start[k]);
  for (const k of changed) extra.push({ text: `Wrote ${k}`, kind: "info" });
  const merged = changed.length ? { ...state.files, ...Object.fromEntries(changed.map((k) => [k, files[k]])) } : state.files;
  set((s) => ({
    phase: "idle",
    status,
    output: [...output, ...extra],
    files: merged,
    // Files a program writes can be undone like any other change.
    ...(changed.length ? { past: [...s.past.slice(-99), { rows: s.rows, files: s.files }], future: [] } : {}),
    stepRow: null,
    vars: [],
    showProblems: false,
  }));
  session = null;
}

export function run() {
  if (state.phase === "running") return;
  if (state.phase === "stepping" && session) return runToEnd();
  if (blocked()) return;
  const exec = getCompiled().exec!;
  const start = state.files;
  worker?.terminate();
  const w = new Worker(new URL("./lang/worker.ts", import.meta.url), { type: "module" });
  worker = w;
  const t0 = performance.now();
  set({ phase: "running", status: { kind: "running" }, output: [], outTab: "output", view: state.view === "code" ? "code" : "output", showProblems: false });
  w.onmessage = (e: MessageEvent<{ outcome: Outcome; output: string[]; files: Files; ms: number }>) => {
    if (worker !== w) return;
    clearTimeout(backstop);
    w.terminate();
    worker = null;
    finish(e.data.outcome, e.data.output.map((text) => ({ text, kind: "out" })), e.data.files, Math.max(1, Math.round(e.data.ms)), start);
  };
  w.onerror = (e) => {
    if (worker !== w) return;
    clearTimeout(backstop);
    w.terminate();
    worker = null;
    finish({ status: "error", row: -1, msg: e.message || "The program could not start" }, [], start, performance.now() - t0, start);
  };
  w.postMessage({ exec, files: state.files, limitMs: LIMIT_MS });
  // If the worker can't even report back (a single huge operation), stop it from here.
  clearTimeout(backstop);
  backstop = window.setTimeout(() => {
    if (worker !== w) return;
    w.terminate();
    worker = null;
    set({ phase: "idle", status: { kind: "stopped" }, output: [...state.output, { text: "Stopped: the program did not respond.", kind: "err" }] });
  }, LIMIT_MS + 2000);
}

export function stop() {
  if (worker) {
    worker.terminate();
    worker = null;
    clearTimeout(backstop);
    set({ phase: "idle", status: { kind: "stopped" }, output: [...state.output, { text: "Stopped.", kind: "info" }] });
  }
}

function afterStep(o: Outcome | null, ms = 0) {
  const s = session!;
  const output = s.buf.length ? [...state.output, ...s.buf] : state.output;
  s.buf = [];
  if (o) return finish(o, output, s.files, ms, s.start);
  s.steps++;
  set({ output, stepRow: s.cur.row, vars: variables(s.cur.snap), status: { kind: "stepping", n: s.steps } });
}

export function stepStart() {
  if (state.phase === "running") return;
  if (blocked()) return;
  const files = { ...state.files };
  const buf: OutLine[] = [];
  let gen: Gen;
  try {
    gen = load(getCompiled().exec!, makeRuntime(files, (text) => session?.buf.push({ text, kind: "out" })))();
  } catch (err) {
    return finish({ status: "error", row: -1, msg: err instanceof Error ? err.message : String(err) }, [], files, 0, state.files);
  }
  session = { gen, cur: { row: -1, loopRow: -1, snap: null }, files, start: state.files, steps: 0, buf };
  set({ phase: "stepping", output: [], outTab: "output", showProblems: false });
  afterStep(stepOnce(gen, session.cur));
}

export function stepNext() {
  if (!session) return stepStart();
  afterStep(stepOnce(session.gen, session.cur));
}

export function runToEnd() {
  const s = session;
  if (!s) return;
  const t0 = performance.now();
  const o = drive(s.gen, LIMIT_MS, s.cur);
  afterStep(o, Math.max(1, Math.round(performance.now() - t0)));
}

export function stepExit() {
  session = null;
  set({ phase: "idle", stepRow: null, vars: [], status: { kind: "none" } });
}

export function clearOutput() {
  set({ output: [], status: state.phase === "stepping" ? state.status : { kind: "none" } });
}
