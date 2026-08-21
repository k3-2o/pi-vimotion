import { test } from "node:test";
import assert from "node:assert/strict";
import { textObjectRange } from "../src/ops.ts";
import type { EdState } from "../src/ops.ts";

function at(lines: string[], col: number): EdState {
  return { lines, cursorLine: 0, cursorCol: col };
}

test("paired text objects pick the INNERMOST enclosing pair when nested", () => {
  const lines = ["a(b(cd)e)f"];
  // Cursor on the inner opening paren (index 3).
  const inner = textObjectRange(at(lines, 3), "parens", "inner");
  assert.deepEqual(inner, { startLine: 0, startCol: 4, endLine: 0, endCol: 6 }); // "cd"

  const around = textObjectRange(at(lines, 3), "parens", "around");
  assert.deepEqual(around, { startLine: 0, startCol: 3, endLine: 0, endCol: 7 }); // "(cd)"

  // Cursor anywhere inside the inner pair still targets the inner pair.
  const inside = textObjectRange(at(lines, 4), "parens", "inner");
  assert.deepEqual(inside, { startLine: 0, startCol: 4, endLine: 0, endCol: 6 });
});

test("same innermost rule holds for nested brackets/braces", () => {
  const [line] = ["[a[b[c]]d]"];
  // Cursor at inner open paren is index 4; innermost pair is "[c]" (cols 4..7).
  assert.deepEqual(textObjectRange(at([line], 5), "brackets", "inner"), {
    startLine: 0, startCol: 5, endLine: 0, endCol: 6,
  });
});

test("single (non-nested) pair is unchanged", () => {
  const inner = textObjectRange(at(["(hello)"], 1), "parens", "inner");
  assert.deepEqual(inner, { startLine: 0, startCol: 1, endLine: 0, endCol: 6 });
  const around = textObjectRange(at(["(hello)"], 1), "parens", "around");
  assert.deepEqual(around, { startLine: 0, startCol: 0, endLine: 0, endCol: 7 });
});
