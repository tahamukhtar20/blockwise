// Starter programs. Each row is [depth, kind, slots].
import type { Kind } from "./blocks.ts";
import type { Files } from "./runtime.ts";

type R = [number, Kind, Record<string, string>?];

export interface Example {
  id: string;
  title: string;
  about: string;
  rows: R[];
  files?: Files;
}

export const EXAMPLES: Example[] = [
  {
    id: "evens",
    title: "Sum of even numbers",
    about: "A function, a for loop and if / else",
    rows: [
      [0, "function", { name: "isEven", params: "n" }],
      [1, "return", { value: "n mod 2 = 0" }],
      [0, "set", { name: "total", value: "0" }],
      [0, "set", { name: "evens", value: "[]" }],
      [0, "for", { name: "i", from: "1", to: "10", step: "" }],
      [1, "if", { cond: "isEven(i)" }],
      [2, "change", { name: "total", by: "i" }],
      [2, "add", { value: "i", list: "evens" }],
      [1, "else"],
      [2, "print", { value: '"odd " + i' }],
      [0, "write", { value: "evens", file: '"evens.txt"' }],
      [0, "print", { value: '"total " + total' }],
    ],
  },
  {
    id: "fizzbuzz",
    title: "FizzBuzz",
    about: "else if chains and mod",
    rows: [
      [0, "for", { name: "i", from: "1", to: "20", step: "" }],
      [1, "if", { cond: "i mod 15 = 0" }],
      [2, "print", { value: '"FizzBuzz"' }],
      [1, "elseif", { cond: "i mod 3 = 0" }],
      [2, "print", { value: '"Fizz"' }],
      [1, "elseif", { cond: "i mod 5 = 0" }],
      [2, "print", { value: '"Buzz"' }],
      [1, "else"],
      [2, "print", { value: "i" }],
    ],
  },
  {
    id: "primes",
    title: "Prime numbers",
    about: "Nested while loops",
    rows: [
      [0, "set", { name: "n", value: "2" }],
      [0, "while", { cond: "n ≤ 40" }],
      [1, "set", { name: "prime", value: "true" }],
      [1, "set", { name: "d", value: "2" }],
      [1, "while", { cond: "d * d ≤ n and prime" }],
      [2, "if", { cond: "n mod d = 0" }],
      [3, "set", { name: "prime", value: "false" }],
      [2, "change", { name: "d", by: "1" }],
      [1, "if", { cond: "prime" }],
      [2, "print", { value: "n" }],
      [1, "change", { name: "n", by: "1" }],
    ],
  },
  {
    id: "factorial",
    title: "Factorial",
    about: "A function that calls itself",
    rows: [
      [0, "function", { name: "factorial", params: "n" }],
      [1, "if", { cond: "n ≤ 1" }],
      [2, "return", { value: "1" }],
      [1, "return", { value: "n * factorial(n - 1)" }],
      [0, "for", { name: "k", from: "1", to: "10", step: "" }],
      [1, "print", { value: 'k + "! = " + factorial(k)' }],
    ],
  },
  {
    id: "files",
    title: "Write and read a file",
    about: "Files, lists and for each",
    rows: [
      [0, "set", { name: "people", value: '["Ada", "Alan", "Grace"]' }],
      [0, "write", { value: "people", file: '"people.txt"' }],
      [0, "append", { value: '"Linus"', file: '"people.txt"' }],
      [0, "read", { file: '"people.txt"', name: "contents" }],
      [0, "set", { name: "names", value: "lines(contents)" }],
      [0, "print", { value: 'length(names) + " people"' }],
      [0, "foreach", { name: "person", list: "names" }],
      [1, "print", { value: "upper(person)" }],
    ],
  },
];
