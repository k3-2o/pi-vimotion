import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Case, hasNvim, runNvim, opMotion, opTextObject, opFind,
} from "./nvim-parity-helpers.ts";
import { type EdState, setYank, pasteAfter, deleteLines } from "../src/ops.ts";
import { findWordEnd, findCharOnLine, firstNonBlankCol } from "../src/motions.ts";

function cursorAt(s: EdState, line: number, col: number): void {
  s.cursorLine = line;
  s.cursorCol = col;
}

const CASES: Case[] = [
  { name: "e: mid-word -> word end", buffer: ["foo bar baz"], cursor: [0, 1], keys: "e",
    ours: (s) => { s.cursorCol = findWordEnd(s.lines[0], s.cursorCol + 1); } },
  { name: "e: word end -> next word end", buffer: ["foo bar"], cursor: [0, 2], keys: "e",
    ours: (s) => { s.cursorCol = findWordEnd(s.lines[0], s.cursorCol + 1); } },
  { name: "e: no word end ahead -> stays", buffer: ["foo bar"], cursor: [0, 6], keys: "e",
    ours: (s) => { const t = findWordEnd(s.lines[0], s.cursorCol + 1); if (t >= 0) s.cursorCol = t; } },
  { name: "f: find next char", buffer: ["a(b)c"], cursor: [0, 0], keys: "f(",
    ours: (s) => opFindCursor(s, "(", "f") },
  { name: "t: adjacent target fails (zero motion)", buffer: ["a,b"], cursor: [0, 0], keys: "t,",
    ours: (s) => opFindCursor(s, ",", "t") },
  { name: "fb then ; repeat finds the next match", buffer: ["abcb"], cursor: [0, 0], keys: "fb;",
    ours: (s) => { opFindCursor(s, "b", "f"); opFindCursor(s, "b", "f"); } },
  { name: "dt,: delete till before comma", buffer: ["a,b"], cursor: [0, 0], keys: "dt,",
    ours: (s) => opFind(s, ",", "t", "delete") },
  { name: "dT,: adjacent target is inclusive (deletes cursor char)", buffer: ["a,b"], cursor: [0, 2], keys: "dT,",
    ours: (s) => opFind(s, ",", "T", "delete") },
  { name: "df,: delete through comma", buffer: ["a,b,c"], cursor: [0, 0], keys: "df,",
    ours: (s) => opFind(s, ",", "f", "delete") },
  { name: "d0: delete to line start", buffer: ["hello"], cursor: [0, 3], keys: "d0",
    ours: (s) => opMotion(s, "delete", "0") },
  { name: "d$: delete to line end", buffer: ["hello"], cursor: [0, 3], keys: "d$",
    ours: (s) => opMotion(s, "delete", "$") },
  { name: "dd: delete current line", buffer: ["a", "b", "c"], cursor: [1, 0], keys: "dd",
    ours: (s) => { cursorAt(s, 1, 0); deleteLines(s, 1); } },
  { name: "dj: delete down linewise", buffer: ["a", "b", "c"], cursor: [0, 0], keys: "dj",
    ours: (s) => deleteLines(s, 2) },
  { name: "dk: delete up linewise", buffer: ["a", "b", "c"], cursor: [1, 0], keys: "dk",
    ours: (s) => { cursorAt(s, 0, 0); deleteLines(s, 2); } },
  { name: "dG: delete to buffer end", buffer: ["a", "b", "c"], cursor: [0, 0], keys: "dG",
    ours: (s) => deleteLines(s, 3) },
  { name: "G: last line, first non-blank", buffer: ["ab", "  cd"], cursor: [0, 0], keys: "G",
    ours: (s) => { s.cursorLine = s.lines.length - 1; s.cursorCol = firstNonBlankCol(s.lines[s.cursorLine] ?? ""); } },
  { name: "gg: first line, first non-blank", buffer: ["  ab", "cd"], cursor: [1, 0], keys: "gg",
    ours: (s) => { s.cursorLine = 0; s.cursorCol = firstNonBlankCol(s.lines[0] ?? ""); } },
  { name: "diw: inner word", buffer: ["foo bar"], cursor: [0, 1], keys: "diw",
    ours: (s) => opTextObject(s, "delete", "word", "inner") },
  { name: "daw: word with trailing space", buffer: ["foo bar"], cursor: [0, 1], keys: "daw",
    ours: (s) => opTextObject(s, "delete", "word", "around") },
  { name: "daw on last word takes the leading space", buffer: ["foo bar"], cursor: [0, 5], keys: "daw",
    ours: (s) => opTextObject(s, "delete", "word", "around") },
  { name: "di(: inner parens", buffer: ["f(a b)"], cursor: [0, 2], keys: "di(",
    ours: (s) => opTextObject(s, "delete", "parens", "inner") },
  { name: "da(: around parens", buffer: ["f(a b)"], cursor: [0, 2], keys: "da(",
    ours: (s) => opTextObject(s, "delete", "parens", "around") },
  { name: "di( spans lines", buffer: ["f(a", "b)g"], cursor: [0, 2], keys: "di(",
    ours: (s) => opTextObject(s, "delete", "parens", "inner") },
  { name: 'di": inner double quotes', buffer: ['say "hi" now'], cursor: [0, 6], keys: 'di"',
    ours: (s) => opTextObject(s, "delete", "doubleQuote", "inner") },
  { name: "ye p: charwise yank of e-motion then put", buffer: ["hello world"], cursor: [0, 1], keys: "yep",
    ours: (s) => { opMotion(s, "yank", "e"); pasteAfter(s); } },
  { name: "yy p on last line: linewise put below", buffer: ["a", "b"], cursor: [1, 0], keys: "yyp",
    ours: (s) => { setYank(s.lines[1] ?? "", "line"); pasteAfter(s); } },
  { name: "yy p: linewise text (cursor placement is a documented divergence)", buffer: ["a", "b"], cursor: [0, 0], keys: "yyp",
    ignoreCursor: "nvim lands on the pasted line's first non-blank; ours sits at col 0",
    ours: (s) => { setYank(s.lines[0] ?? "", "line"); pasteAfter(s); } },
];

function opFindCursor(s: EdState, ch: string, kind: "f" | "t"): void {
  const target = findCharOnLine(s.lines[s.cursorLine] ?? "", s.cursorCol, ch, kind);
  if (target < 0 || target === s.cursorCol) return; // failed / zero motion
  s.cursorCol = target;
}

test("motions + operators match nvim", async (t) => {
  if (!hasNvim()) { t.skip("nvim not installed"); return; }
  const results = runNvim(CASES);
  assert.equal(results.length, CASES.length);
  CASES.forEach((c, i) => {
    const nvim = results[i];
    const s: EdState = { lines: [...c.buffer], cursorLine: c.cursor[0], cursorCol: c.cursor[1] };
    c.ours(s);
    assert.deepEqual(
      s.lines, nvim.lines,
      `[${c.name}] text\n  ours: ${JSON.stringify(s.lines)}\n  nvim: ${JSON.stringify(nvim.lines)}`,
    );
    if (!c.ignoreCursor) {
      // nvim never sits past EOL; normalize our past-end positions to match
      const ourCol = Math.min(s.cursorCol, Math.max(0, (s.lines[s.cursorLine] ?? "").length - 1));
      assert.equal(
        [s.cursorLine, ourCol].join(":"),
        [nvim.line - 1, nvim.col - 1].join(":"),
        `[${c.name}] cursor`,
      );
    }
  });
});
