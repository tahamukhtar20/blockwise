import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { BLOCKS, type Cat, type SlotDef } from "../lang/blocks.ts";
import type { Problem, Row } from "../lang/compile.ts";
import { canMove, gapDepths, gapWithout, subtreeEnd } from "../lang/rows.ts";
import { add, dropRow, moveRow, removeRow, select, setSlot, ui, useCompiled, useStore, type Status } from "../store.ts";
import { chipText } from "./BlockBar.tsx";
import { beginDrag, registerCanvas, useDrag, type Payload } from "./drag.ts";
import { Icon } from "./icons.tsx";

const GUTTER = 54;
const INDENT = 22;
const catOf = (r: Row): Cat => BLOCKS.get(r.kind)!.cat;

function Slot({ row, def, bad, n }: { row: Row; def: SlotDef; bad: boolean; n: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const pending = useStore((s) => s.pendingFocus);
  const value = row.slots[def.key] ?? "";
  useEffect(() => {
    const el = ref.current;
    if (!pending || !el || pending.row !== row.id || pending.slot !== def.key) return;
    el.focus({ preventScroll: false });
    if (pending.selectAll) el.select();
    else if (pending.caret !== undefined) el.setSelectionRange(pending.caret, pending.caret);
    ui({ pendingFocus: null });
  }, [pending, row.id, def.key]);
  const remember = () => {
    const el = ref.current;
    if (el) ui({ focus: { row: row.id, slot: def.key, start: el.selectionStart ?? value.length, end: el.selectionEnd ?? value.length } });
  };
  const str = def.kind === "expr" && /^\s*(".*"|'.*'|“.*”)\s*$/.test(value);
  const width = Math.max(value.length || def.ph.length, 1);
  return (
    <input
      ref={ref}
      className={`slot k-${def.kind}${str ? " str" : ""}${bad ? " bad" : ""}${def.optional && !value ? " opt" : ""}`}
      style={{ width: `calc(${width}ch + 16px)` }}
      value={value}
      placeholder={def.ph}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      aria-label={`Row ${n + 1}, ${def.ph}`}
      aria-invalid={bad || undefined}
      list={def.kind === "var" ? "bw-vars" : def.kind === "name" ? "bw-fns" : undefined}
      onChange={(e) => {
        setSlot(row.id, def.key, e.target.value);
        ui({ focus: { row: row.id, slot: def.key, start: e.target.selectionStart ?? 0, end: e.target.selectionEnd ?? 0 } });
      }}
      onFocus={() => {
        select(row.id);
        remember();
      }}
      onSelect={remember}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
          e.preventDefault();
          (e.currentTarget.closest(".row") as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

interface RowProps {
  row: Row;
  i: number;
  rails: Cat[];
  sel: boolean;
  step: boolean;
  hover: boolean;
  problems: Problem[];
  runErr: string | null;
  moves: ReturnType<typeof canMove> | null;
}

const RowView = memo(function RowView({ row, i, rails, sel, step, hover, problems, runErr, moves }: RowProps) {
  const def = BLOCKS.get(row.kind)!;
  const badSlots = new Set(problems.map((p) => p.slot).filter(Boolean));
  const err = problems.length > 0 || !!runErr;
  return (
    <>
      <div
        className={`row${sel ? " sel" : ""}${step ? " step" : ""}${hover ? " hv" : ""}${err ? " err" : ""}`}
        data-i={i}
        tabIndex={sel ? 0 : -1}
        aria-label={`Row ${i + 1}: ${chipText(row.kind)}`}
        aria-current={step ? "step" : undefined}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("input,button")) {
            select(row.id);
            (e.currentTarget as HTMLElement).focus();
            e.preventDefault();
          }
        }}
        onMouseEnter={() => ui({ hover: i })}
        onMouseLeave={() => ui({ hover: null })}
      >
        <span className="ln">{i + 1}</span>
        <div className="cell">
          {rails.map((c, d) => (
            <span key={d} className="ind" style={{ ["--rail" as string]: `var(--c-${c})` }} />
          ))}
          <div className="blk" style={{ ["--k" as string]: `var(--c-${def.cat})` }}>
            <span className="grip" title="Drag to move" aria-hidden onPointerDown={(e) => beginDrag(e, { type: "row", id: row.id }, chipText(row.kind), () => select(row.id))}>
              <svg width="8" height="14" viewBox="0 0 8 14">
                {[2, 7, 12].map((y) => [2, 6].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
              </svg>
            </span>
            {def.parts.map((p, k) =>
              typeof p === "string" ? (
                <span key={k} className={k === 0 ? "kw" : "t"}>
                  {p}
                </span>
              ) : (
                <Slot key={k} row={row} def={p} bad={badSlots.has(p.key)} n={i} />
              ),
            )}
          </div>
          {sel && moves && (
            <div className="tools" role="toolbar" aria-label={`Row ${i + 1} actions`}>
              <button type="button" disabled={!moves.up} onClick={() => moveRow(row.id, "up")} title="Move up (Alt+↑)" aria-label="Move up">
                <Icon name="up" size={14} />
              </button>
              <button type="button" disabled={!moves.down} onClick={() => moveRow(row.id, "down")} title="Move down (Alt+↓)" aria-label="Move down">
                <Icon name="down" size={14} />
              </button>
              <button type="button" disabled={!moves.outdent} onClick={() => moveRow(row.id, "outdent")} title="Move out (Shift+Tab)" aria-label="Move out of the block">
                <Icon name="outdent" size={14} />
              </button>
              <button type="button" disabled={!moves.indent} onClick={() => moveRow(row.id, "indent")} title="Move into the block above (Tab)" aria-label="Move into the block above">
                <Icon name="indent" size={14} />
              </button>
              <button type="button" className="del" onClick={() => removeRow(row.id)} title="Delete (Delete key)" aria-label="Delete row">
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      {(problems.length > 0 || runErr) && (
        <div className="msg" style={{ paddingLeft: `calc(var(--gut) + ${rails.length} * var(--ind))` }} role="alert">
          {runErr ?? problems[0].msg}
          {problems.length > 1 && <span className="more"> and {problems.length - 1} more on this row</span>}
        </div>
      )}
    </>
  );
});

export function Canvas() {
  const rows = useStore((s) => s.rows);
  const sel = useStore((s) => s.sel);
  const stepRow = useStore((s) => s.stepRow);
  const hover = useStore((s) => s.hover);
  const showProblems = useStore((s) => s.showProblems);
  const status: Status = useStore((s) => s.status);
  const c = useCompiled();
  const drag = useDrag();
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);

  // Hit testing for drag and drop.
  useEffect(() => {
    const hit = (p: Payload, x: number, y: number) => {
      const el = list.current;
      const sc = scroller.current;
      if (!el || !sc) return null;
      const box = sc.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      const rowsNow = rows;
      const els = [...el.querySelectorAll<HTMLElement>(".row")];
      let g = els.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if (g < 0) g = els.length;
      let range: [number, number];
      if (p.type === "row") {
        const i = rowsNow.findIndex((r) => r.id === p.id);
        const g2 = gapWithout(rowsNow, i, g);
        if (g2 === null) return null;
        const e = subtreeEnd(rowsNow, i);
        range = gapDepths([...rowsNow.slice(0, i), ...rowsNow.slice(e)], g2);
      } else range = gapDepths(rowsNow, g);
      const left = el.getBoundingClientRect().left + GUTTER;
      const want = Math.round((x - left - 30) / INDENT);
      const depth = Math.max(range[0], Math.min(range[1], want));
      const top = el.getBoundingClientRect().top;
      const ly = g < els.length ? els[g].getBoundingClientRect().top - top : els.length ? els[els.length - 1].getBoundingClientRect().bottom - top : 0;
      return { gap: g, depth, y: ly, x: GUTTER + depth * INDENT };
    };
    registerCanvas(hit, (p, t) => (p.type === "row" ? dropRow(p.id, t.gap, t.depth) : add(p.kind, { index: t.gap, depth: t.depth })));
  }, [rows]);

  // Keep the stepping row in view.
  useLayoutEffect(() => {
    if (stepRow === null) return;
    list.current?.querySelector<HTMLElement>(`.row[data-i="${stepRow}"]`)?.scrollIntoView({ block: "nearest" });
  }, [stepRow]);

  const byRow = new Map<number, Problem[]>();
  if (showProblems) for (const p of c.problems) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
  const runRow = status.kind === "error" || status.kind === "timeout" ? status.row : -1;
  const runMsg = status.kind === "error" || status.kind === "timeout" ? status.msg : null;

  const stack: Cat[] = [];
  return (
    <section
      className="canvas"
      ref={scroller}
      aria-label="Program"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("rows")) select(null);
      }}
    >
      <div className="rows" ref={list} role="list">
        {rows.length === 0 && <p className="empty">Pick a block above to start, or open one of the examples.</p>}
          {rows.map((r, i) => {
            stack.length = r.depth;
            const rails = stack.slice(0, r.depth);
            while (rails.length < r.depth) rails.push("control");
            stack[r.depth] = catOf(r);
            const isSel = r.id === sel;
            return (
              <RowView
                key={r.id}
                row={r}
                i={i}
                rails={rails}
                sel={isSel}
                step={stepRow === i}
                hover={hover === i}
                problems={byRow.get(i) ?? []}
                runErr={runRow === i ? runMsg : null}
                moves={isSel ? canMove(rows, i) : null}
              />
            );
          })}
        {drag?.target && <div className="drop" style={{ top: drag.target.y - 1, left: drag.target.x }} />}
      </div>
      <datalist id="bw-vars">
        {c.vars.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="bw-fns">
        {c.fns.map((f) => (
          <option key={f.name} value={f.name} />
        ))}
      </datalist>
    </section>
  );
}
