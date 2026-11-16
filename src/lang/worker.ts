// Runs a compiled program away from the page, so a slow program never freezes the editor.
import { drive, load, makeRuntime, type Files } from "./runtime.ts";

postMessage({ ready: true });

self.onmessage = (e: MessageEvent<{ exec: string; files: Files; limitMs: number }>) => {
  const { exec, files, limitMs } = e.data;
  const output: string[] = [];
  const fs = { ...files };
  const t0 = performance.now();
  let outcome;
  try {
    const main = load(exec, makeRuntime(fs, (s) => output.push(s)));
    outcome = drive(main(), limitMs);
  } catch (err) {
    outcome = { status: "error" as const, row: -1, msg: err instanceof Error ? err.message : String(err) };
  }
  postMessage({ outcome, output, files: fs, ms: performance.now() - t0 });
};
