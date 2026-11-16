import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXAMPLES } from "../lang/examples.ts";
import { clearOutput, deleteFile, loadExample, renameFile, select, setFile, ui, useCompiled, useStore, get, type Status } from "../store.ts";
import { Icon } from "./icons.tsx";

// ---------------------------------------------------------------- code

const TOK = /(\/\*.*?\*\/)|("(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(function|return|let|const|for|of|if|else|while)\b|([A-Za-z_]\w*)(?=\()/g;

function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = m[1] ? "cm" : m[2] ? "s" : m[3] ? "nm" : m[4] ? "k" : "f";
    out.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function CodePane() {
  const c = useCompiled();
  const sel = useStore((s) => s.sel);
  const rows = useStore((s) => s.rows);
  const stepRow = useStore((s) => s.stepRow);
  const hover = useStore((s) => s.hover);
  const showProblems = useStore((s) => s.showProblems);
  const [copied, setCopied] = useState(false);
  const prev = useRef<string[]>([]);
  const [flash, setFlash] = useState<{ lines: Set<number>; n: number }>({ lines: new Set(), n: 0 });
  const box = useRef<HTMLDivElement>(null);

  const texts = c.lines.map((l) => l.text);
  useEffect(() => {
    const old = prev.current;
    prev.current = texts;
    if (!old.length || old.length !== texts.length) return;
    const changed = new Set<number>();
    texts.forEach((t, i) => t !== old[i] && changed.add(i));
    if (changed.size && changed.size <= 3) setFlash((f) => ({ lines: changed, n: f.n + 1 }));
  }, [texts.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  const selIdx = sel ? rows.findIndex((r) => r.id === sel) : -1;
  const active = stepRow ?? selIdx;
  const badRows = new Set(showProblems ? c.problems.map((p) => p.row) : []);

  useEffect(() => {
    if (active < 0) return;
    const ln = c.rowLines[active]?.[0];
    if (ln === undefined) return;
    box.current?.querySelector<HTMLElement>(`[data-ln="${ln}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, c]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(texts.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="pane code-pane">
      <div className="ph">
        <b>JavaScript</b>
        <span className="m hide-xs">Updates as you edit</span>
        <span className="sp" />
        <button type="button" className="lnk" onClick={copy} disabled={!texts.length}>
          <Icon name="copy" size={13} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code" ref={box} role="region" aria-label="Generated JavaScript" tabIndex={0}>
        {c.lines.length === 0 && <p className="code-empty">The JavaScript for your blocks appears here.</p>}
        {c.lines.map((l, i) => {
          const num = l.row !== null && c.rowLines[l.row][0] === i ? l.row + 1 : null;
          const cls = [l.row !== null && l.row === active ? (stepRow !== null ? "step" : "hl") : "", l.row !== null && l.row === hover ? "hv" : "", l.row !== null && badRows.has(l.row) ? "bad" : "", flash.lines.has(i) ? `fl f${flash.n % 2}` : ""].filter(Boolean).join(" ");
          return (
            <div key={i} data-ln={i} className={cls} onMouseEnter={() => l.row !== null && ui({ hover: l.row })} onMouseLeave={() => ui({ hover: null })} onClick={() => l.row !== null && select(get().rows[l.row]?.id ?? null)}>
              <span className="n">{num ?? ""}</span>
              <span className="t">{highlight(l.text) as ReactNode}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- output

function statusLine(s: Status) {
  switch (s.kind) {
    case "running":
      return <span className="st run">Running</span>;
    case "stepping":
      return <span className="st step">Step {s.n}</span>;
    case "done":
      return <span className="st ok">Finished in {s.ms} ms</span>;
    case "stopped":
      return <span className="st">Stopped</span>;
    case "problems":
      return (
        <span className="st bad">
          {s.count} problem{s.count === 1 ? "" : "s"} to fix
        </span>
      );
    case "error":
      return <span className="st bad">{s.row >= 0 ? `Error on row ${s.row + 1}` : "Error"}</span>;
    case "timeout":
      return <span className="st bad">Stopped after 2 s</span>;
    default:
      return null;
  }
}

export function OutputPane() {
  const output = useStore((s) => s.output);
  const status = useStore((s) => s.status);
  const phase = useStore((s) => s.phase);
  const vars = useStore((s) => s.vars);
  const outTab = useStore((s) => s.outTab);
  const files = useStore((s) => s.files);
  const body = useRef<HTMLDivElement>(null);
  const nFiles = Object.keys(files).length;

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <div className="pane out-pane">
      <div className="ph">
        <div className="tb" role="tablist" aria-label="Output">
          <button type="button" role="tab" aria-selected={outTab === "output"} className={outTab === "output" ? "on" : ""} onClick={() => ui({ outTab: "output" })}>
            Output
          </button>
          <button type="button" role="tab" aria-selected={outTab === "files"} className={outTab === "files" ? "on" : ""} onClick={() => ui({ outTab: "files" })}>
            Files{nFiles ? <span className="n">{nFiles}</span> : null}
          </button>
        </div>
        {outTab === "output" && statusLine(status)}
        <span className="sp" />
        {outTab === "output" && output.length > 0 && phase !== "running" && (
          <button type="button" className="lnk" onClick={clearOutput}>
            Clear output
          </button>
        )}
      </div>
      {outTab === "output" ? (
        <>
          {phase === "stepping" && (
            <div className="vars" aria-label="Variables">
              {vars.length === 0 ? (
                <span className="none">No variables set yet</span>
              ) : (
                vars.map((v) => (
                  <span key={v.name} className="var">
                    <b>{v.name}</b> = <span className="mono">{v.value}</span>
                  </span>
                ))
              )}
            </div>
          )}
          <div className="outp" ref={body} role="log" aria-live="polite">
            {output.length === 0 && phase !== "running" && <p className="dim">{phase === "stepping" ? "Nothing printed yet." : "Press Run to see the output."}</p>}
            {output.map((l, i) =>
              l.kind === "err" && l.row !== undefined ? (
                <button key={i} type="button" className="line err" onClick={() => select(get().rows[l.row!]?.id ?? null)}>
                  {l.text}
                </button>
              ) : (
                <div key={i} className={`line ${l.kind}`}>
                  {l.text === "" ? "\u00a0" : l.text}
                </div>
              ),
            )}
          </div>
        </>
      ) : (
        <FilesView />
      )}
    </div>
  );
}

function FilesView() {
  const files = useStore((s) => s.files);
  const open = useStore((s) => s.openFile);
  const names = Object.keys(files).sort();
  const cur = open && open in files ? open : names[0] ?? null;
  const [name, setName] = useState(cur ?? "");
  useEffect(() => setName(cur ?? ""), [cur]);

  const create = () => {
    let k = 1;
    while (`file${k}.txt` in files) k++;
    setFile(`file${k}.txt`, "");
    ui({ openFile: `file${k}.txt` });
  };

  if (!names.length)
    return (
      <div className="files empty-files">
        <p className="dim">No files yet. Programs can write files with the blocks in the Files tab, or you can add one here for a program to read.</p>
        <button type="button" className="btn sm" onClick={create}>
          <Icon name="plus" size={14} /> New file
        </button>
      </div>
    );

  return (
    <div className="files">
      <div className="flist" role="listbox" aria-label="Files">
        {names.map((f) => (
          <button key={f} type="button" role="option" aria-selected={f === cur} className={f === cur ? "on" : ""} onClick={() => ui({ openFile: f })}>
            <Icon name="file" size={14} />
            <span className="fn">{f}</span>
            <span className="sz">{files[f].split("\n").length} line{files[f].split("\n").length === 1 ? "" : "s"}</span>
          </button>
        ))}
        <button type="button" className="add" onClick={create}>
          <Icon name="plus" size={14} /> New file
        </button>
      </div>
      {cur && (
        <div className="fedit">
          <div className="fh">
            <input
              className="fname mono"
              value={name}
              aria-label="File name"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => (renameFile(cur, name.trim()) ? undefined : setName(cur))}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <button type="button" className="icon-btn" aria-label={`Delete ${cur}`} title="Delete file" onClick={() => deleteFile(cur)}>
              <Icon name="trash" size={15} />
            </button>
          </div>
          <textarea className="mono" value={files[cur]} spellCheck={false} aria-label={`Contents of ${cur}`} onChange={(e) => setFile(cur, e.target.value)} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- examples menu

export function ExamplesMenu() {
  const open = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) ui({ menu: false });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && ui({ menu: false });
    addEventListener("pointerdown", close);
    addEventListener("keydown", key);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => ui({ menu: !open })}>
        <Icon name="book" size={15} className="show-xs" />
        <span className="hide-xs">Examples</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} type="button" role="menuitem" onClick={() => loadExample(ex.id)}>
              <b>{ex.title}</b>
              <span>{ex.about}</span>
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={() => loadExample(null)}>
            <b>New program</b>
            <span>Start from an empty canvas</span>
          </button>
          <p className="credit">
            By tahamukhtar20 ·{" "}
            <a href="https://github.com/tahamukhtar20/blockwise" target="_blank" rel="noreferrer">
              Source
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

