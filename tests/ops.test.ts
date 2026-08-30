import { test } from "node:test";
import assert from "node:assert/strict";
import { textObjectRange, deleteRange, deleteLines, pasteAfter, pasteBefore, setYank, textBetween, motionRange, graphemeAt, graphemeBefore, joinLines } from "../src/ops.ts";
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

test("graphemeAt: astral chars yield the full grapheme (x/s yank contract)", () => {
  const line = "x\u{1F44D}y";
  assert.equal(graphemeAt(line, 1), "\u{1F44D}"); // was a lone surrogate before the fix
  assert.equal(graphemeAt(line, 0), "x");
  assert.equal(graphemeAt(line, 3), "y");
  assert.equal(graphemeAt(line, 99), "");          // past end -> "" (no yank)
  assert.equal(graphemeAt("ab", 1), "b");
});

test("pasteBefore: charwise at cursor, cursor on last pasted char", () => {
  const { s } = undoable(["hello"], 2);
  setYank("XY", "char");
  pasteBefore(s);
  assert.deepEqual(s.lines, ["heXYllo"]);
  assert.equal(s.cursorCol, 3);
});

test("pasteBefore: linewise inserts above, cursor at col 0", () => {
  const { s } = undoable(["a", "b"], 0);
  setYank("z", "line");
  pasteBefore(s);
  assert.deepEqual(s.lines, ["z", "a", "b"]);
  assert.deepEqual({ line: s.cursorLine, col: s.cursorCol }, { line: 0, col: 0 });
});

test("joinLines: single space, cursor on join point", () => {
  const { s } = undoable(["foo", "  bar"], 0);
  joinLines(s);
  assert.deepEqual(s.lines, ["foo bar"]);
  assert.equal(s.cursorCol, 3); // the join space
});

test("joinLines: no space before ) and on blank/last-line edges", () => {
  const s1: EdState = { lines: ["foo(", ")"], cursorLine: 0, cursorCol: 0 };
  joinLines(s1);
  assert.deepEqual(s1.lines, ["foo()"]);
  const s2: EdState = { lines: ["foo", "   "], cursorLine: 0, cursorCol: 0 };
  joinLines(s2);
  assert.deepEqual(s2.lines, ["foo"]);
  const s3: EdState = { lines: ["only"], cursorLine: 0, cursorCol: 0 };
  joinLines(s3); // no next line: no-op
  assert.deepEqual(s3.lines, ["only"]);
});

test("graphemeBefore: previous grapheme, edges", () => {
  const line = "x\u{1F44D}y";
  assert.equal(graphemeBefore(line, 3), "\u{1F44D}"); // grapheme ending at col 3
  assert.equal(graphemeBefore(line, 1), "x");
  assert.equal(graphemeBefore(line, 0), "");
  assert.equal(graphemeBefore(line, 99), "");
});
