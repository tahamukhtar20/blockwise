import { useEffect, useRef } from "react";
import { BLOCKS } from "./lang/blocks.ts";
import { BlockBar } from "./ui/BlockBar.tsx";
import { Canvas } from "./ui/Canvas.tsx";
import { useDrag } from "./ui/drag.ts";
import { Icon, Logo } from "./ui/icons.tsx";
import { CodePane, ExamplesMenu, OutputPane } from "./ui/Panels.tsx";
import { dismissToast, get, moveRow, redo, removeRow, run, runToEnd, select, stepExit, stepNext, stop, ui, undo, useStore } from "./store.ts";

function Header() {
  const phase = useStore((s) => s.phase);
  return (
    <header className="top">
      <div className="logo">
        <Logo />
        <span>Blockwise</span>
      </div>
      <ExamplesMenu />
      <span className="sp" />
      {phase === "running" ? (
        <button type="button" className="btn" onClick={stop}>
          <Icon name="stop" size={13} /> Stop
        </button>
      ) : phase === "stepping" ? (
        <>
          <button type="button" className="btn quiet" onClick={stepExit} title="Stop stepping (Esc)">
            Exit
          </button>
          <button type="button" className="btn" onClick={runToEnd} title="Run the rest of the program">
            <Icon name="play" size={12} /> <span className="hide-xs">Run to end</span>
          </button>
          <button type="button" className="btn p" onClick={stepNext} title="Run this row and pause at the next (F10)" autoFocus>
            <Icon name="step" size={14} /> Next
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn" onClick={stepNext} title="Run one row at a time (F10)">
            <Icon name="step" size={14} /> Step
          </button>
          <button type="button" className="btn p" onClick={run} title="Run (Ctrl+Enter)">
            <Icon name="play" size={12} /> Run
          </button>
        </>
      )}
    </header>
  );
}

function MobileSwitch() {
  const view = useStore((s) => s.view);
  return (
    <div className="seg" role="tablist" aria-label="View">
      {(
        [
          ["blocks", "Blocks"],
          ["code", "Code"],
          ["output", "Output"],
        ] as const
      ).map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => ui({ view: v })}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Right() {
  const split = useStore((s) => s.split);
  const ref = useRef<HTMLElement>(null);
  const startDrag = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => ui({ split: Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)) });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    e.preventDefault();
  };
  return (
    <aside className="right" ref={ref} style={{ gridTemplateRows: `${split}fr 7px ${1 - split}fr` }}>
      <CodePane />
      <div
        className="divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize code and output"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") ui({ split: Math.max(0.2, split - 0.05) });
          if (e.key === "ArrowDown") ui({ split: Math.min(0.8, split + 0.05) });
        }}
      />
      <OutputPane />
    </aside>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className="toast" role="status" key={t.id}>
      <span>{t.msg}</span>
      {t.undo && (
        <button
          type="button"
          onClick={() => {
            undo();
            dismissToast();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="x" aria-label="Dismiss" onClick={dismissToast}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function Ghost() {
  const d = useDrag();
  if (!d) return null;
  return (
    <div className="ghost" style={{ left: d.x + 12, top: d.y + 8 }}>
      {d.label}
    </div>
  );
}

const focusRow = (i: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.row[data-i="${i}"]`)?.focus());

export default function App() {
  const view = useStore((s) => s.view);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = get();
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as HTMLElement;
      const typing = t.matches("input, textarea");
      if (mod && e.key === "Enter") {
        e.preventDefault();
        return run();
      }
      if (e.key === "F10") {
        e.preventDefault();
        return stepNext();
      }
      if (mod && !e.altKey && e.key.toLowerCase() === "z" && !t.matches("textarea, .fname")) {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && e.key.toLowerCase() === "y" && !t.matches("textarea, .fname")) {
        e.preventDefault();
        return redo();
      }
      if (typing || s.menu || document.querySelector(".menu")) return;
      if (e.key === "Escape") {
        if (s.phase === "stepping") return stepExit();
        if (s.phase === "running") return stop();
        return select(null);
      }
      const i = s.sel ? s.rows.findIndex((r) => r.id === s.sel) : -1;
      if (!t.closest(".canvas") && t !== document.body) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (e.altKey && i >= 0) {
          moveRow(s.rows[i].id, e.key === "ArrowUp" ? "up" : "down");
          const j = get().rows.findIndex((r) => r.id === s.sel);
          return focusRow(j);
        }
        const j = i < 0 ? 0 : Math.max(0, Math.min(s.rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        if (s.rows[j]) {
          select(s.rows[j].id);
          focusRow(j);
        }
        return;
      }
      // The remaining keys act on the selected row only while the row itself has focus.
      if (i < 0 || !t.matches(".row")) return;
      if (e.key === "Tab") {
        e.preventDefault();
        moveRow(s.rows[i].id, e.shiftKey ? "outdent" : "indent");
        return focusRow(get().rows.findIndex((r) => r.id === s.sel));
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeRow(s.rows[i].id);
        const j = get().rows.findIndex((r) => r.id === get().sel);
        if (j >= 0) focusRow(j);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const slot = BLOCKS.get(s.rows[i].kind)!.parts.find((p) => typeof p !== "string");
        if (slot && typeof slot !== "string") ui({ pendingFocus: { row: s.rows[i].id, slot: slot.key, selectAll: true } });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app v-${view}`}>
      <Header />
      <BlockBar />
      <MobileSwitch />
      <div className="body">
        <Canvas />
        <Right />
      </div>
      <Toast />
      <Ghost />
    </div>
  );
}
