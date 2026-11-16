import { BLOCKS, CATS, PALETTE, type Chip, type Kind } from "../lang/blocks.ts";
import { add, insertText, ui, useCompiled, useStore } from "../store.ts";
import { beginDrag } from "./drag.ts";

export const chipText = (kind: Kind) =>
  BLOCKS.get(kind)!
    .parts.map((p) => (typeof p === "string" ? p : "…"))
    .join(" ");

function BlockChip({ kind, pair }: { kind: Kind; pair?: boolean }) {
  const def = BLOCKS.get(kind)!;
  const payloadKind = pair ? ("ifelse" as const) : kind;
  const label = pair ? "if … else" : chipText(kind);
  return (
    <button
      type="button"
      className="chip"
      style={{ ["--k" as string]: `var(--c-${def.cat})` }}
      onPointerDown={(e) => beginDrag(e, { type: "new", kind: payloadKind }, label)}
      onClick={() => add(payloadKind)}
      title={`Add ${label}`}
    >
      {def.parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i} className={i === 0 ? "w" : "g"}>
            {p}
          </span>
        ) : p.optional ? null : (
          <span key={i} className="box" />
        ),
      )}
      {pair && <span className="g">else</span>}
    </button>
  );
}

function ExprChip({ chip, enabled }: { chip: Extract<Chip, { type: "expr" }>; enabled: boolean }) {
  return (
    <button
      type="button"
      className="chip expr"
      disabled={!enabled}
      title={chip.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => insertText(chip.insert, chip.caret)}
    >
      {chip.label}
    </button>
  );
}

export function BlockBar() {
  const tab = useStore((s) => s.tab);
  const focus = useStore((s) => s.focus);
  const sel = useStore((s) => s.sel);
  const rows = useStore((s) => s.rows);
  const c = useCompiled();
  const focusRow = focus ? rows.findIndex((r) => r.id === focus.row) : -1;
  const canInsert = focusRow >= 0;
  const chips = PALETTE[tab];
  const extra: Extract<Chip, { type: "expr" }>[] =
    tab === "variables"
      ? c.vars.map((v) => ({ type: "expr", label: v, insert: v, title: `Insert ${v}` }))
      : tab === "functions"
        ? c.fns.map((f) => ({ type: "expr", label: `${f.name}()`, insert: `${f.name}()`, caret: f.name.length + 1, title: `Call ${f.name} inside a slot` }))
        : [];
  const hasBlocks = chips.some((ch) => ch.type !== "expr");
  const selIdx = sel ? rows.findIndex((r) => r.id === sel) : -1;

  let hint: string;
  if (!hasBlocks) hint = canInsert ? `Inserts into the slot you were editing on row ${focusRow + 1}` : "Click into a slot on a row first, then pick one of these";
  else hint = selIdx >= 0 ? `Click to add below row ${selIdx + 1}, or drag into place` : "Click to add at the end, or drag into place";

  return (
    <div className="bar">
      <div className="tabs" role="tablist" aria-label="Block categories">
        {CATS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={tab === cat.id}
            className={`tab${tab === cat.id ? " on" : ""}`}
            onClick={() => ui({ tab: cat.id })}
          >
            <i style={{ background: `var(--c-${cat.id})` }} />
            {cat.label}
          </button>
        ))}
      </div>
      <div className="chips" role="tabpanel" aria-label={`${CATS.find((x) => x.id === tab)!.label} blocks`}>
        {chips.map((ch, i) =>
          ch.type === "block" ? (
            <BlockChip key={i} kind={ch.kind} />
          ) : ch.type === "ifelse" ? (
            <BlockChip key={i} kind="if" pair />
          ) : (
            <ExprChip key={i} chip={ch} enabled={canInsert} />
          ),
        )}
        {extra.length > 0 && <span className="vsep" aria-hidden />}
        {extra.map((ch) => (
          <ExprChip key={ch.label} chip={ch} enabled={canInsert} />
        ))}
        <span className="hint">{hint}</span>
      </div>
    </div>
  );
}
