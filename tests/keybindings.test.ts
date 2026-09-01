import test from "node:test";
import assert from "node:assert/strict";
import { SECTIONS } from "../src/keybindings/content.ts";
import { CHROME_LINES, drawOverlay, paginate, type Palette } from "../src/keybindings/layout.ts";

// Raw-ANSI palette: styling is inspectable, widths stay honest.
const CODE: Record<string, number> = { accent: 96, border: 90, muted: 37, warning: 93 };
const palette: Palette = {
  fg: (c, s) => `\x1b[${CODE[c]!}m${s}\x1b[39m`,
  bg: (_c, s) => `\x1b[48;5;236m${s}\x1b[49m`,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  italic: (s) => `\x1b[3m${s}\x1b[23m`,
};

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const draw = (width: number, termRows: number, selected = 0) =>
  drawOverlay({ width, termRows, sections: SECTIONS, selected, palette });

test("paginate: rows fit exactly -> nothing hidden, no hint line reserved", () => {
  assert.deepEqual(paginate(8, 8), { rowsShown: 8, hidden: 0 });
});

test("paginate: overflow -> hint row reserved so shown + hint == available", () => {
  assert.deepEqual(paginate(11, 8), { rowsShown: 7, hidden: 4 });
  assert.deepEqual(paginate(8, 3), { rowsShown: 2, hidden: 6 });
});

test("paginate: no room at all -> zero rows shown", () => {
  assert.deepEqual(paginate(8, 0), { rowsShown: 0, hidden: 8 });
});

test("drawOverlay: framed — first and last lines are full-width rules", () => {
  const lines = draw(90, 24);
  assert.equal(stripAnsi(lines[0]!), "─".repeat(90));
  assert.equal(stripAnsi(lines.at(-1)!), "─".repeat(90));
});

test("drawOverlay: title, every section title, and footer help present", () => {
  const text = stripAnsi(draw(90, 24).join("\n"));
  assert.match(text, /pi-vim keybindings/);
  for (const s of SECTIONS) assert.match(text, new RegExp(s.title));
  assert.match(text, /close/);
});

test("drawOverlay: fits a normal terminal with room to spare", () => {
  // 24 rows: chrome (11) + all 8 Motions rows, notes none.
  assert.equal(draw(90, 24, 0).length, CHROME_LINES + 8);
});

test("drawOverlay: short terminal -> exact fit with a visible overflow hint", () => {
  // 18 rows: chrome 11 + available 7 -> 6 rows + 1 hint = 18.
  const lines = draw(90, 18, 0);
  assert.equal(lines.length, 18);
  assert.match(stripAnsi(lines.join("\n")), /…2 more rows/);
});

test("drawOverlay: notes budgeted — section with a note loses an available row", () => {
  // Operators: 7 rows + 1 note. At 20 rows: avail = 20-11-1 = 8 >= 7 -> all fit.
  const lines = draw(90, 20, 1);
  assert.equal(lines.length, CHROME_LINES + 7 + 1);
  assert.doesNotMatch(stripAnsi(lines.join("\n")), /more rows/);
});

test("drawOverlay: every section renders a framed panel", () => {
  for (let i = 0; i < SECTIONS.length; i++) {
    const lines = draw(90, 24, i);
    assert.equal(lines[0], lines.at(-1));
    assert.ok(lines.length >= CHROME_LINES, `section ${i} collapsed`);
  }
});
