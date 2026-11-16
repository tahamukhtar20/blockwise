# Blockwise

Build small programs from blocks, see the JavaScript they turn into, and run or step through them in the browser.

Live at https://blockwise.tahamukhtar.com

## What it does

- Blocks for variables, math, logic, if / else if / else, while, repeat, for, functions with return values, lists, files and print.
- Slots take short expressions such as `n mod 2 = 0`, `length(names) + 1` or `isEven(i)`. They are parsed by a small expression language, so only these forms reach the generated code.
- The JavaScript panel updates as you edit. Hovering a row highlights its lines, and the other way round.
- Run executes the program in a Web Worker and stops it after 2 seconds, so an endless loop never freezes the page.
- Step runs one row at a time and shows the current value of every variable.
- Problems are found before running and shown under the row they belong to, in plain words.
- Files written by a program live in the browser, and can be opened and edited in the Files tab.
- Undo and redo, drag and drop, keyboard shortcuts, and a layout that works on phones. Everything is saved in local storage.

## How it works

The program is a flat list of rows, each with a kind, an indent depth and its slot values. `src/lang/compile.ts` turns that list into two versions of the same program: readable JavaScript for the code panel, and a generator that pauses before every row. Running drives the generator to the end inside a worker; stepping advances it one row at a time on the page.

| Path | Contents |
| --- | --- |
| `src/lang/blocks.ts` | Block definitions and the palette |
| `src/lang/expr.ts` | Expression parser and JavaScript output |
| `src/lang/compile.ts` | Checks and code generation |
| `src/lang/runtime.ts` | Helpers available to programs, run and step loops |
| `src/lang/rows.ts` | Insert, move, indent and drag operations on rows |
| `src/store.ts` | Editor state, undo history and running |
| `src/ui/` | Block bar, canvas, code and output panels |

## Running locally

```bash
npm install
npm run dev
```

`npm test` runs the language and row tests. `npm run build` type-checks and builds to `dist/`, which is deployed as static assets on Cloudflare Workers with `npx wrangler deploy`.

## Background

First written in 2023 as Scratchh, a block editor that produced PHP and ran it on a server. This version produces JavaScript and runs it entirely in the browser.

## License

MIT
