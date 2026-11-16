import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKS } from "./blocks.ts";
import { compile, type Row } from "./compile.ts";
import { EXAMPLES } from "./examples.ts";
import { emit, parse } from "./expr.ts";
import { drive, load, makeRuntime, step, variables, type Cursor, type Files } from "./runtime.ts";

let id = 0;
const rows = (spec: [number, string, Record<string, string>?][]): Row[] =>
  spec.map(([depth, kind, slots]) => ({ id: String(id++), kind: kind as Row["kind"], depth, slots: { ...BLOCKS.get(kind as Row["kind"])!.defaults, ...slots } }));

function run(r: Row[], files: Files = {}, limit = 2000) {
  const c = compile(r);
  assert.deepEqual(c.problems, [], JSON.stringify(c.problems));
  const out: string[] = [];
  const main = load(c.exec!, makeRuntime(files, (s) => out.push(s)));
  const outcome = drive(main(), limit);
  return { out, outcome, files, code: c.lines.map((l) => l.text).join("\n") };
}

const js = (src: string) => emit(parse(src), { useVar: () => {}, fnArity: () => 1, exec: false });

test("expressions become JavaScript", () => {
  assert.equal(js("n mod 2 = 0"), "n % 2 === 0");
  assert.equal(js("a + b * c"), "a + b * c");
  assert.equal(js("(a + b) * c"), "(a + b) * c");
  assert.equal(js("a - (b - c)"), "a - (b - c)");
  assert.equal(js("not a = b"), "!(a === b)");
  assert.equal(js("a ≤ b and c ≠ d or e"), "a <= b && c !== d || e");
  assert.equal(js("a or b and c"), "a || b && c");
  assert.equal(js("(a or b) and c"), "(a || b) && c");
  assert.equal(js("- -x"), "- -x");
  assert.equal(js("length(xs) + 1"), "xs.length + 1");
  assert.equal(js("length(a + b)"), "(a + b).length");
  assert.equal(js("xs[i + 1]"), "xs[i + 1]");
  assert.equal(js("'it' + \"s\""), '"it" + "s"');
  assert.equal(js("random(1, 6)"), "random(1, 6)");
  assert.equal(js("length(1)"), "(1).length");
  assert.equal(js("010 + 1.50"), "10 + 1.5");
  assert.throws(() => parse("_i + 1"));
  assert.throws(() => parse("1 < 2 < 3"));
  assert.throws(() => parse("a +"));
  assert.throws(() => parse('"open'));
  assert.throws(() => parse("a b"));
  assert.throws(() => parse(""));
});

test("every example compiles and runs", () => {
  const expect: Record<string, string[]> = {
    evens: ["odd 1", "odd 3", "odd 5", "odd 7", "odd 9", "total 30"],
    fizzbuzz: ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz", "16", "17", "Fizz", "19", "Buzz"],
    primes: ["2", "3", "5", "7", "11", "13", "17", "19", "23", "29", "31", "37"],
    factorial: ["1! = 1", "2! = 2", "3! = 6", "4! = 24", "5! = 120", "6! = 720", "7! = 5040", "8! = 40320", "9! = 362880", "10! = 3628800"],
    files: ["4 people", "ADA", "ALAN", "GRACE", "LINUS"],
  };
  for (const ex of EXAMPLES) {
    const r = run(rows(ex.rows), { ...ex.files });
    assert.equal(r.outcome.status, "done", ex.id);
    assert.deepEqual(r.out, expect[ex.id], ex.id);
    // The display code must itself be valid JavaScript.
    assert.doesNotThrow(() => new Function(r.code), ex.id + "\n" + r.code);
  }
});

test("display code reads naturally", () => {
  const r = run(rows(EXAMPLES[0].rows));
  assert.equal(
    r.code,
    [
      "function isEven(n) {",
      "  return n % 2 === 0;",
      "}",
      "let total = 0;",
      "let evens = [];",
      "for (let i = 1; i <= 10; i++) {",
      "  if (isEven(i)) {",
      "    total += i;",
      "    evens.push(i);",
      "  } else {",
      '    print("odd " + i);',
      "  }",
      "}",
      'writeFile("evens.txt", evens);',
      'print("total " + total);',
    ].join("\n"),
  );
  assert.equal(r.files["evens.txt"], "2\n4\n6\n8\n10");
});

test("variables set inside blocks are declared at the top", () => {
  const r = run(rows([[0, "if", { cond: "true" }], [1, "set", { name: "x", value: "1" }], [0, "print", { value: "x" }]]));
  assert.match(r.code, /^let x;\n/);
  assert.deepEqual(r.out, ["1"]);
});

test("for counts down with a negative step and handles expressions", () => {
  assert.deepEqual(run(rows([[0, "for", { name: "i", from: "3", to: "1", step: "-1" }], [1, "print", { value: "i" }]])).out, ["3", "2", "1"]);
  assert.deepEqual(run(rows([[0, "set", { name: "s", value: "2" }], [0, "for", { name: "i", from: "0", to: "6", step: "s" }], [1, "print", { value: "i" }]])).out, ["0", "2", "4", "6"]);
  assert.deepEqual(run(rows([[0, "repeat", { times: "2" }], [1, "repeat", { times: "2" }], [2, "print", { value: '"x"' }]])).out, ["x", "x", "x", "x"]);
});

test("functions see globals and keep their own locals", () => {
  const r = run(
    rows([
      [0, "set", { name: "count", value: "0" }],
      [0, "function", { name: "bump", params: "by" }],
      [1, "set", { name: "tmp", value: "by * 2" }],
      [1, "change", { name: "count", by: "tmp" }],
      [0, "call", { name: "bump", args: "1" }],
      [0, "call", { name: "bump", args: "5" }],
      [0, "print", { value: "count" }],
    ]),
  );
  assert.deepEqual(r.out, ["12"]);
});

test("problems are found before running", () => {
  const msgs = (spec: [number, string, Record<string, string>?][]) => compile(rows(spec)).problems.map((p) => p.msg);
  assert.match(msgs([[0, "print", { value: "x" }]])[0], /no variable called x/);
  assert.match(msgs([[0, "print", { value: "x" }], [0, "set", { name: "x", value: "1" }]])[0], /x is used before it is set/);
  assert.match(msgs([[0, "else"]])[0], /needs an if/);
  assert.match(msgs([[0, "print", {}], [1, "print", {}]])[0], /can't hold other rows/);
  assert.match(msgs([[0, "print", {}], [2, "print", {}]])[0], /indented further/);
  assert.match(msgs([[0, "return", {}]])[0], /only works inside a function/);
  assert.match(msgs([[0, "set", { name: "class", value: "1" }]])[0], /reserved word/);
  assert.match(msgs([[0, "set", { name: "x", value: "" }]])[0], /empty slot/);
  assert.match(msgs([[0, "change", { name: "y", by: "1" }]])[0], /Set y before changing it/);
  assert.match(msgs([[0, "call", { name: "nope", args: "" }]])[0], /no function called nope/);
  assert.match(msgs([[0, "function", { name: "f", params: "a" }], [0, "call", { name: "f", args: "" }]])[0], /takes 1 input, not 0/);
  assert.match(msgs([[0, "for", { name: "i", from: "1", to: "3", step: "0" }]])[0], /step can't be 0/);
  assert.match(msgs([[0, "for", { name: "i", from: "1", to: "3" }], [0, "print", { value: "i" }]])[0], /not available here/);
  assert.equal(compile(rows([[0, "print", { value: "x" }]])).exec, null);
});

test("runtime errors and endless loops are reported with their row", () => {
  const e = run(rows([[0, "set", { name: "xs", value: "[1]" }], [0, "removeAt", { index: "3", list: "xs" }]])).outcome;
  assert.equal(e.status, "error");
  assert.equal((e as { row: number }).row, 1);
  assert.match((e as { msg: string }).msg, /no index 3/);
  const t = run(rows([[0, "set", { name: "n", value: "0" }], [0, "while", { cond: "true" }], [1, "change", { name: "n", by: "1" }]]), {}, 100).outcome;
  assert.equal(t.status, "timeout");
  assert.equal((t as { loopRow: number }).loopRow, 1);
  const f = run(rows([[0, "read", { file: '"missing.txt"', name: "t" }]])).outcome;
  assert.match((f as { msg: string }).msg, /no file called "missing.txt"/);
  const deep = run(rows([[0, "function", { name: "f", params: "n" }], [1, "return", { value: "f(n + 1)" }], [0, "print", { value: "f(1)" }]])).outcome;
  assert.match((deep as { msg: string }).msg, /nested function calls/);
});

test("review fixes", () => {
  const msgs = (spec: [number, string, Record<string, string>?][]) => compile(rows(spec)).problems.map((p) => p.msg);
  // A global used inside a function is declared before the function can be called.
  const g = run(rows([[0, "function", { name: "f", params: "" }], [1, "print", { value: "t" }], [0, "set", { name: "t", value: "1" }], [0, "call", { name: "f", args: "" }]]));
  assert.match(g.code, /^let t;/);
  assert.doesNotThrow(() => new Function("print", g.code)(() => {}));
  // Errors after a call point at the calling row.
  const e = run(rows([[0, "function", { name: "f", params: "" }], [1, "return", { value: "1" }], [0, "print", { value: "upper(f())" }]])).outcome;
  assert.equal((e as { row: number }).row, 2);
  // Names that clash with functions.
  assert.match(msgs([[0, "function", { name: "g", params: "" }], [0, "for", { name: "g", from: "1", to: "2" }]]).join(), /already the name of a function/);
  assert.match(msgs([[0, "function", { name: "g", params: "g" }]]).join(), /already the name of a function/);
  // change on a for each variable.
  assert.deepEqual(run(rows([[0, "foreach", { name: "x", list: "[1, 2]" }], [1, "change", { name: "x", by: "10" }], [1, "print", { value: "x" }]])).out, ["11", "12"]);
  // Low-precedence loop bounds.
  assert.deepEqual(run(rows([[0, "set", { name: "n", value: "0" }], [0, "for", { name: "i", from: "1", to: "n or 2" }], [1, "print", { value: "i" }]])).out, ["1", "2"]);
  // File names that are object members.
  const f = run(rows([[0, "append", { value: '"hi"', file: '"toString"' }], [0, "read", { file: '"toString"', name: "c" }], [0, "print", { value: "c" }]]));
  assert.deepEqual(f.out, ["hi"]);
  const missing = run(rows([[0, "read", { file: '"constructor"', name: "c" }]])).outcome;
  assert.equal(missing.status, "error");
});

test("step mode pauses before each row and exposes variables", () => {
  const c = compile(rows([[0, "set", { name: "a", value: "1" }], [0, "set", { name: "b", value: "a + 1" }], [0, "print", { value: "b" }]]));
  const out: string[] = [];
  const gen = load(c.exec!, makeRuntime({}, (s) => out.push(s)))();
  const cur: Cursor = { row: -1, loopRow: -1, snap: null };
  const seen: number[] = [];
  let o = step(gen, cur);
  while (!o) {
    seen.push(cur.row);
    o = step(gen, cur);
  }
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(out, ["2"]);
  assert.deepEqual(variables(() => ({ a: 1, b: [1, "x"], _i: 3, c: undefined })), [
    { name: "a", value: "1" },
    { name: "b", value: '[1, "x"]' },
  ]);
});
