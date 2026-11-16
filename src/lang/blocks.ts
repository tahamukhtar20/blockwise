// Block definitions: what each row looks like and which slots it has.

export type Cat = "variables" | "math" | "logic" | "control" | "functions" | "lists" | "files" | "output";

export type Kind =
  | "set" | "change" | "print"
  | "if" | "elseif" | "else" | "while" | "repeat" | "for"
  | "foreach" | "add" | "removeAt" | "setItem"
  | "function" | "return" | "call"
  | "write" | "append" | "read";

/** expr: an expression. var: a variable name. name: a function name. params: comma-separated names. args: comma-separated expressions. */
export type SlotKind = "expr" | "var" | "name" | "params" | "args";

export interface SlotDef {
  key: string;
  kind: SlotKind;
  ph: string;
  optional?: boolean;
}
export type Part = string | SlotDef;

export interface BlockDef {
  kind: Kind;
  cat: Cat;
  parts: Part[];
  container?: boolean;
  defaults: Record<string, string>;
}

const S = (key: string, kind: SlotKind, ph: string, optional = false): SlotDef => ({ key, kind, ph, optional });

const list: BlockDef[] = [
  { kind: "set", cat: "variables", parts: ["set", S("name", "var", "name"), "to", S("value", "expr", "value")], defaults: { name: "", value: "0" } },
  { kind: "change", cat: "variables", parts: ["change", S("name", "var", "name"), "by", S("by", "expr", "amount")], defaults: { name: "", by: "1" } },

  { kind: "if", cat: "control", parts: ["if", S("cond", "expr", "condition")], container: true, defaults: { cond: "" } },
  { kind: "elseif", cat: "control", parts: ["else if", S("cond", "expr", "condition")], container: true, defaults: { cond: "" } },
  { kind: "else", cat: "control", parts: ["else"], container: true, defaults: {} },
  { kind: "while", cat: "control", parts: ["while", S("cond", "expr", "condition")], container: true, defaults: { cond: "" } },
  { kind: "repeat", cat: "control", parts: ["repeat", S("times", "expr", "n"), "times"], container: true, defaults: { times: "3" } },
  {
    kind: "for",
    cat: "control",
    parts: ["for", S("name", "var", "i"), "from", S("from", "expr", "start"), "to", S("to", "expr", "end"), "step", S("step", "expr", "1", true)],
    container: true,
    defaults: { name: "i", from: "1", to: "10", step: "" },
  },

  { kind: "function", cat: "functions", parts: ["function", S("name", "name", "name"), "with", S("params", "params", "no inputs", true)], container: true, defaults: { name: "", params: "" } },
  { kind: "return", cat: "functions", parts: ["return", S("value", "expr", "value", true)], defaults: { value: "" } },
  { kind: "call", cat: "functions", parts: ["call", S("name", "name", "function"), "with", S("args", "args", "no inputs", true)], defaults: { name: "", args: "" } },

  { kind: "foreach", cat: "lists", parts: ["for each", S("name", "var", "item"), "in", S("list", "expr", "list")], container: true, defaults: { name: "item", list: "" } },
  { kind: "add", cat: "lists", parts: ["add", S("value", "expr", "value"), "to", S("list", "var", "list")], defaults: { value: "", list: "" } },
  { kind: "removeAt", cat: "lists", parts: ["remove index", S("index", "expr", "0"), "from", S("list", "var", "list")], defaults: { index: "0", list: "" } },
  { kind: "setItem", cat: "lists", parts: ["set index", S("index", "expr", "0"), "of", S("list", "var", "list"), "to", S("value", "expr", "value")], defaults: { index: "0", list: "", value: "" } },

  { kind: "write", cat: "files", parts: ["write", S("value", "expr", "value"), "to file", S("file", "expr", "file name")], defaults: { value: "", file: '"notes.txt"' } },
  { kind: "append", cat: "files", parts: ["append", S("value", "expr", "value"), "to file", S("file", "expr", "file name")], defaults: { value: "", file: '"notes.txt"' } },
  { kind: "read", cat: "files", parts: ["read file", S("file", "expr", "file name"), "into", S("name", "var", "name")], defaults: { file: '"notes.txt"', name: "contents" } },

  { kind: "print", cat: "output", parts: ["print", S("value", "expr", "value")], defaults: { value: '"Hello"' } },
];

export const BLOCKS = new Map<Kind, BlockDef>(list.map((b) => [b.kind, b]));
export const KINDS = list.map((b) => b.kind);

export const slotsOf = (kind: Kind) => BLOCKS.get(kind)!.parts.filter((p): p is SlotDef => typeof p !== "string");
export const isContainer = (kind: Kind) => !!BLOCKS.get(kind)?.container;

export const CATS: { id: Cat; label: string }[] = [
  { id: "variables", label: "Variables" },
  { id: "math", label: "Math" },
  { id: "logic", label: "Logic" },
  { id: "control", label: "Control" },
  { id: "functions", label: "Functions" },
  { id: "lists", label: "Lists" },
  { id: "files", label: "Files" },
  { id: "output", label: "Output" },
];

/** A palette entry: a row block, the if/else pair, or text inserted into the focused slot. */
export type Chip =
  | { type: "block"; kind: Kind }
  | { type: "ifelse" }
  | { type: "expr"; label: string; insert: string; caret?: number; title: string };

const op = (label: string, insert: string, title: string): Chip => ({ type: "expr", label, insert: ` ${insert} `, title });
const fn = (label: string, insert: string, title: string): Chip => ({ type: "expr", label, insert, caret: insert.indexOf("(") + 1, title });

export const PALETTE: Record<Cat, Chip[]> = {
  variables: [{ type: "block", kind: "set" }, { type: "block", kind: "change" }],
  math: [
    op("+", "+", "Add, or join text"),
    op("−", "-", "Subtract"),
    op("×", "*", "Multiply"),
    op("÷", "/", "Divide"),
    op("mod", "mod", "Remainder after dividing"),
    fn("random", "random(1, 10)", "A whole number between the two, inclusive"),
    fn("round", "round()", "Round to the nearest whole number"),
    fn("sqrt", "sqrt()", "Square root"),
  ],
  logic: [
    op("=", "=", "Equal"),
    op("≠", "≠", "Not equal"),
    op("<", "<", "Less than"),
    op(">", ">", "Greater than"),
    op("≤", "≤", "Less than or equal"),
    op("≥", "≥", "Greater than or equal"),
    op("and", "and", "Both are true"),
    op("or", "or", "At least one is true"),
    { type: "expr", label: "not", insert: "not ", title: "The opposite" },
    { type: "expr", label: "true", insert: "true", title: "Yes" },
    { type: "expr", label: "false", insert: "false", title: "No" },
  ],
  control: [
    { type: "block", kind: "if" },
    { type: "ifelse" },
    { type: "block", kind: "elseif" },
    { type: "block", kind: "while" },
    { type: "block", kind: "repeat" },
    { type: "block", kind: "for" },
  ],
  functions: [{ type: "block", kind: "function" }, { type: "block", kind: "return" }, { type: "block", kind: "call" }],
  lists: [
    { type: "block", kind: "foreach" },
    { type: "block", kind: "add" },
    { type: "block", kind: "removeAt" },
    { type: "block", kind: "setItem" },
    { type: "expr", label: "[ ]", insert: "[]", caret: 1, title: "A list, such as [1, 2, 3]" },
    fn("length", "length()", "How many items in a list, or characters in text"),
  ],
  files: [{ type: "block", kind: "write" }, { type: "block", kind: "append" }, { type: "block", kind: "read" }, fn("lines", "lines()", "Split text into a list of lines")],
  output: [{ type: "block", kind: "print" }, fn("text", "text()", "Turn a value into text"), fn("upper", "upper()", "Text in capitals")],
};
