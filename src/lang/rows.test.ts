import { test } from "node:test";
import assert from "node:assert/strict";
import type { Row } from "./compile.ts";
import { canMove, gapDepths, gapWithout, indent, insertPoint, move, moveTo, outdent, remove } from "./rows.ts";

const R = (spec: string): Row[] =>
  spec
    .trim()
    .split("\n")
    .map((line, i) => {
      const depth = (line.length - line.trimStart().length) / 2;
      return { id: String(i), kind: line.trim() as Row["kind"], depth, slots: {} };
    });
const show = (rows: Row[]) => rows.map((r) => "  ".repeat(r.depth) + r.kind).join("\n");

const prog = R(`
set
for
  if
    print
  else
    print
print
`);

test("click insertion goes below the selection, or inside a container", () => {
  assert.deepEqual(insertPoint(prog, 0, "print"), { index: 1, depth: 0 });
  assert.deepEqual(insertPoint(prog, 1, "print"), { index: 2, depth: 1 });
  assert.deepEqual(insertPoint(prog, 3, "print"), { index: 4, depth: 2 });
  assert.deepEqual(insertPoint(prog, -1, "print"), { index: 7, depth: 0 });
  assert.deepEqual(insertPoint(prog, 3, "elseif"), { index: 4, depth: 1 });
  assert.deepEqual(insertPoint(prog, 3, "function"), { index: 6, depth: 0 });
  assert.deepEqual(insertPoint(R("if\n  print"), 1, "else"), { index: 2, depth: 0 });
});

test("move, indent and outdent carry children along", () => {
  assert.equal(show(move(prog, 1, -1)), "for\n  if\n    print\n  else\n    print\nset\nprint");
  assert.equal(show(move(prog, 1, 1)), "set\nprint\nfor\n  if\n    print\n  else\n    print");
  assert.equal(show(outdent(prog, 3)), "set\nfor\n  if\n  print\n  else\n    print\nprint");
  assert.equal(show(indent(R("while\nprint"), 1)), "while\n  print");
  assert.equal(show(indent(R("set\nprint"), 1)), "set\nprint");
  assert.deepEqual(canMove(prog, 0), { up: false, down: true, indent: false, outdent: false });
  assert.equal(show(remove(prog, 1)), "set\nprint");
});

test("drag targets", () => {
  assert.deepEqual(gapDepths(prog, 2), [1, 1]);
  assert.deepEqual(gapDepths(prog, 7), [0, 0]);
  assert.deepEqual(gapDepths(prog, 4), [1, 2]);
  assert.equal(gapWithout(prog, 1, 3), null);
  assert.equal(gapWithout(prog, 1, 7), 2);
  assert.equal(show(moveTo(prog, 6, 0, 0)), "print\nset\nfor\n  if\n    print\n  else\n    print");
});
