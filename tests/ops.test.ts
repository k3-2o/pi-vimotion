import { test } from "node:test";
import assert from "node:assert/strict";
import { textObjectRange, deleteRange, deleteLines, pasteAfter, setYank, textBetween, motionRange } from "../src/ops.ts";
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

// ------------------------------------------------------------------
// Regression tests
// ------------------------------------------------------------------

/** EdState with an undo stack that mirrors pi's editor semantics:
 *  pushUndoSnapshot clones the CURRENT state; undo pops and restores it. */
function undoable(lines: string[], col = 0, line = 0) {
  const snaps: Array<{ lines: string[]; cursorLine: number; cursorCol: number }> = [];
  const s: EdState = { lines, cursorLine: line, cursorCol: col };
  s.pushUndoSnapshot = () => {
    snaps.push(structuredClone({ lines: s.lines, cursorLine: s.cursorLine, cursorCol: s.cursorCol }));
  };
  const undo = () => {
    const snap = snaps.pop();
    if (snap) Object.assign(s, snap);
  };
  return { s, snaps, undo };
}

test("deleteRange: empty range is a no-op with no undo entry", () => {
  const { s, snaps } = undoable(["hello"], 2);
  assert.equal(deleteRange(s, 0, 2, 0, 2), "");
  assert.deepEqual(s.lines, ["hello"]);
  assert.equal(snaps.length, 0);
});

test("deleteRange: reversed args are normalized into a single delete", () => {
  const { s } = undoable(["hello", "world"], 0);
  const deleted = deleteRange(s, 1, 3, 0, 1); // end before start
  assert.equal(deleted, "ello\nwor");
  assert.deepEqual(s.lines, ["hwld".slice(0, 1) + "ld"]);
  assert.equal(s.lines[0], "hld");
});

test("pasteAfter: multi-line charwise yank splits lines (no embedded newline)", () => {
  const { s } = undoable(["abc", "def", "ghi"], 1);
  setYank("X\nY", "char");
  pasteAfter(s);
  // insertAt=2: "ab" + "X" | "Y" + "c" -> ["abX", "Yc", "def", "ghi"]
  assert.deepEqual(s.lines, ["abX", "Yc", "def", "ghi"]);
  assert.deepEqual({ line: s.cursorLine, col: s.cursorCol }, { line: 1, col: 0 });
});

test("pasteAfter: single-line charwise yank pastes after the cursor char", () => {
  const { s } = undoable(["hello"], 1); // cursor on "e"
  setYank("XY", "char");
  pasteAfter(s);
  assert.deepEqual(s.lines, ["heXYllo"]);
  assert.equal(s.cursorCol, 3); // last char of "XY" at col 2+2-1
});

test("pasteAfter: linewise yank inserts below the cursor line", () => {
  const { s } = undoable(["a", "b"], 0);
  setYank("z", "line");
  pasteAfter(s);
  assert.deepEqual(s.lines, ["a", "z", "b"]);
  assert.deepEqual({ line: s.cursorLine, col: s.cursorCol }, { line: 1, col: 0 });
});

test("pasteAfter: empty charwise yank does nothing (and no undo entry)", () => {
  const { s, snaps } = undoable(["abc"], 0);
  setYank("", "char");
  pasteAfter(s);
  assert.deepEqual(s.lines, ["abc"]);
  assert.equal(snaps.length, 0);
});

test("deleteRange snapshots the PRE-change state so one `u` undoes one op", () => {
  const { s, undo } = undoable(["hello", "world"], 0);
  const before = structuredClone({ lines: s.lines, cursorLine: 0, cursorCol: 0 });
  deleteRange(s, 0, 1, 1, 3);
  assert.deepEqual(s.lines, ["hld"]);
  undo(); // single undo must restore the full pre-change state
  assert.deepEqual(s.lines, before.lines);
  assert.equal(s.cursorLine, 0);
  assert.equal(s.cursorCol, 0);
});

test("deleteLines snapshots the PRE-change state; deleting last line leaves one empty line", () => {
  const { s, undo } = undoable(["only"], 0);
  const deleted = deleteLines(s, 1);
  assert.equal(deleted, "only");
  assert.deepEqual(s.lines, [""]);
  undo();
  assert.deepEqual(s.lines, ["only"]);
});

test("pasteAfter snapshots the PRE-change state so one `u` undoes the paste", () => {
  const { s, undo } = undoable(["ab"], 0);
  setYank("c", "char");
  pasteAfter(s);
  assert.deepEqual(s.lines, ["acb"]);
  undo();
  assert.deepEqual(s.lines, ["ab"]);
});

test("textBetween: single-line slice and multi-line join", () => {
  const lines = ["hello", "world", "again"];
  assert.equal(textBetween(lines, 0, 1, 0, 4), "ell");
  assert.equal(textBetween(lines, 0, 1, 2, 3), "ello\nworld\naga");
});

test("motionRange: forward, backward, and cursor restoration", () => {
  const s: EdState = { lines: ["hello", "world"], cursorLine: 0, cursorCol: 1 };
  const ed = {
    applyMotion: () => { s.cursorLine = 1; s.cursorCol = 3; },
    st: s,
  };
  const r = motionRange("w", 1, 0, 1, ed);
  assert.equal(r.text, "ello\nwor");
  assert.deepEqual({ sl: r.startLine, sc: r.startCol, el: r.endLine, ec: r.endCol },
                   { sl: 0, sc: 1, el: 1, ec: 3 });
  // the cursor save/restore contract: caller's cursor is untouched
  assert.deepEqual({ line: s.cursorLine, col: s.cursorCol }, { line: 0, col: 1 });

  const back = motionRange("b", 1, 1, 3, { applyMotion: () => { s.cursorLine = 0; s.cursorCol = 1; }, st: s });
  assert.equal(back.text, "ello\nwor");
  assert.deepEqual({ sl: back.startLine, sc: back.startCol, el: back.endLine, ec: back.endCol },
                   { sl: 0, sc: 1, el: 1, ec: 3 });
});
