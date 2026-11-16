// Pointer-based dragging for rows and palette blocks. The canvas tells it where a drop would land.
import { useSyncExternalStore } from "react";
import type { Kind } from "../lang/blocks.ts";

export type Payload = { type: "row"; id: string } | { type: "new"; kind: Kind | "ifelse" };
export type Target = { gap: number; depth: number; y: number; x: number };

interface DragState {
  payload: Payload;
  label: string;
  x: number;
  y: number;
  target: Target | null;
}

let cur: DragState | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const useDrag = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);

let hit: ((p: Payload, x: number, y: number) => Target | null) | null = null;
let drop: ((p: Payload, t: Target) => void) | null = null;
export function registerCanvas(h: typeof hit, d: typeof drop) {
  hit = h;
  drop = d;
}

/** Call from pointerdown. Returns nothing; a short press without movement stays a click. */
export function beginDrag(e: React.PointerEvent, payload: Payload, label: string, onDragStart?: () => void) {
  if (e.button !== 0 || e.pointerType === "touch") return;
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      onDragStart?.();
      document.body.classList.add("dragging");
    }
    ev.preventDefault();
    cur = { payload, label, x: ev.clientX, y: ev.clientY, target: hit?.(payload, ev.clientX, ev.clientY) ?? null };
    emit();
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
    if (started) {
      document.body.classList.remove("dragging");
      // Swallow the click that follows a drag.
      const swallow = (ce: Event) => ce.stopPropagation();
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, true), 0);
      const t = cur?.target;
      cur = null;
      emit();
      if (t) drop?.(payload, t);
    }
  };
  const cancel = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
    document.body.classList.remove("dragging");
    cur = null;
    emit();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      cancel();
    }
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key, true);
}
