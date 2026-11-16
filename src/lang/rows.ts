// Pure edits on the row list. A row's children are the rows right after it with a greater depth.
import { BLOCKS, isContainer, type Kind } from "./blocks.ts";
import type { Row } from "./compile.ts";

let n = 0;
export const newId = () => `r${Date.now().toString(36)}${(n++).toString(36)}`;

export const newRow = (kind: Kind, depth: number): Row => ({ id: newId(), kind, depth, slots: { ...BLOCKS.get(kind)!.defaults } });

/** Index just past the row's last descendant. */
export function subtreeEnd(rows: Row[], i: number): number {
  let e = i + 1;
  while (e < rows.length && rows[e].depth > rows[i].depth) e++;
  return e;
}

export function parentOf(rows: Row[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (rows[j].depth < rows[i].depth) return j;
  return -1;
}

function prevSibling(rows: Row[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].depth === rows[i].depth) return j;
    if (rows[j].depth < rows[i].depth) return -1;
  }
  return -1;
}

/** Where a new row of this kind goes when added with a click: below the selected row, or inside it if it holds rows. */
export function insertPoint(rows: Row[], sel: number, kind: Kind | "ifelse"): { index: number; depth: number } {
  if (sel < 0 || sel >= rows.length) {
    if (kind === "else" || kind === "elseif") {
      for (let j = rows.length - 1; j >= 0; j--) if (rows[j].depth === 0) return chainEnd(rows, j, kind);
    }
    return { index: rows.length, depth: 0 };
  }
  if (kind === "function") {
    let top = sel;
    while (rows[top].depth > 0) top = parentOf(rows, top);
    return { index: subtreeEnd(rows, top), depth: 0 };
  }
  if (kind === "else" || kind === "elseif") {
    // Attach to the nearest if / else if that the selection sits in (or is).
    for (let j = sel; j >= 0; j = parentOf(rows, j)) if (rows[j].kind === "if" || rows[j].kind === "elseif") return chainEnd(rows, j, kind);
  }
  const r = rows[sel];
  if (isContainer(r.kind)) return { index: sel + 1, depth: r.depth + 1 };
  return { index: subtreeEnd(rows, sel), depth: r.depth };
}

function chainEnd(rows: Row[], head: number, kind: Kind): { index: number; depth: number } {
  const d = rows[head].depth;
  let idx = subtreeEnd(rows, head);
  if (kind === "else") while (idx < rows.length && rows[idx].depth === d && rows[idx].kind === "elseif") idx = subtreeEnd(rows, idx);
  return { index: idx, depth: d };
}

export function insert(rows: Row[], index: number, add: Row[]): Row[] {
  return [...rows.slice(0, index), ...add, ...rows.slice(index)];
}

export function remove(rows: Row[], i: number): Row[] {
  return [...rows.slice(0, i), ...rows.slice(subtreeEnd(rows, i))];
}

export function canMove(rows: Row[], i: number) {
  const e = subtreeEnd(rows, i);
  const p = prevSibling(rows, i);
  return {
    up: p >= 0,
    down: e < rows.length && rows[e].depth === rows[i].depth,
    indent: p >= 0 && isContainer(rows[p].kind),
    outdent: rows[i].depth > 0,
  };
}

/** Swaps the row (with its children) with the sibling above or below. */
export function move(rows: Row[], i: number, dir: -1 | 1): Row[] {
  const e = subtreeEnd(rows, i);
  if (dir === -1) {
    const p = prevSibling(rows, i);
    if (p < 0) return rows;
    return [...rows.slice(0, p), ...rows.slice(i, e), ...rows.slice(p, i), ...rows.slice(e)];
  }
  if (e >= rows.length || rows[e].depth !== rows[i].depth) return rows;
  const e2 = subtreeEnd(rows, e);
  return [...rows.slice(0, i), ...rows.slice(e, e2), ...rows.slice(i, e), ...rows.slice(e2)];
}

const shift = (block: Row[], by: number) => block.map((r) => ({ ...r, depth: r.depth + by }));

/** Moves the row inside the container right above it. */
export function indent(rows: Row[], i: number): Row[] {
  if (!canMove(rows, i).indent) return rows;
  const e = subtreeEnd(rows, i);
  return [...rows.slice(0, i), ...shift(rows.slice(i, e), 1), ...rows.slice(e)];
}

/** Moves the row out of its container, to just after it. */
export function outdent(rows: Row[], i: number): Row[] {
  if (rows[i].depth === 0) return rows;
  const e = subtreeEnd(rows, i);
  const p = parentOf(rows, i);
  const pe = subtreeEnd(rows, p);
  const block = shift(rows.slice(i, e), -1);
  const rest = [...rows.slice(0, i), ...rows.slice(e)];
  const at = pe - (e - i);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Depths a row may take when dropped into the gap before index g. */
export function gapDepths(rows: Row[], g: number): [number, number] {
  const above = rows[g - 1];
  const below = rows[g];
  const max = above ? above.depth + (isContainer(above.kind) ? 1 : 0) : 0;
  const min = below ? Math.min(below.depth, max) : 0;
  return [min, max];
}

/** Moves a row (with its children) to gap g of the list without it, at the given depth. */
export function moveTo(rows: Row[], i: number, g: number, depth: number): Row[] {
  const e = subtreeEnd(rows, i);
  const block = rows.slice(i, e);
  const rest = [...rows.slice(0, i), ...rows.slice(e)];
  return [...rest.slice(0, g), ...shift(block, depth - rows[i].depth), ...rest.slice(g)];
}

/** Gap index in the list without rows i..end that corresponds to gap g in the full list. */
export function gapWithout(rows: Row[], i: number, g: number): number | null {
  const e = subtreeEnd(rows, i);
  if (g > i && g <= e) return null;
  return g > e ? g - (e - i) : g;
}
