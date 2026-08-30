/**
 * Parity harness: drives ONE headless nvim through every case's keystrokes
 * and reports final text + cursor, so pi-vimotion's own motion/operator
 * semantics can be pinned to the reference editor.
 *
 * Scope: only what pi-vimotion implements itself. h/j/k/l/w/b cursor
 * primitives are delegated to pi (verified by source-trace, not here).
 * Buffers are ASCII-only: nvim columns are byte-based, ours code-unit
 * based; they agree only there.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type EdState, textObjectRange, deleteRange, deleteLines, pasteAfter, setYank, motionRange,
} from "../src/ops.ts";
import { findWordEnd, findCharOnLine } from "../src/motions.ts";

export type Op = "delete" | "yank";

export interface Case {
  name: string;
  buffer: string[];
  cursor: [number, number]; // 0-based
  keys: string;             // executed as `normal!`
  ours: (s: EdState) => void;
  ignoreCursor?: string;    // documented divergence: compare text only
}

/** Operator + motion through the same composition the editor uses. */
export function opMotion(s: EdState, op: Op, motion: string): void {
  const range = motionRange(motion, 1, s.cursorLine, s.cursorCol, {
    applyMotion: (m) => {
      if (m === "e") {
        const t = findWordEnd(s.lines[s.cursorLine] ?? "", s.cursorCol + 1);
        if (t >= 0) s.cursorCol = t;
      } else if (m === "0") s.cursorCol = 0;
      else if (m === "$") s.cursorCol = (s.lines[s.cursorLine] ?? "").length;
      else throw new Error(`delegated motion reached the parity harness: ${m}`);
    },
    st: s,
  }, { inclusiveEnd: motion === "e" });
  if (range.text === "") return; // failed motion aborts the operator
  setYank(range.text, "char");
  if (op === "yank") return;
  deleteRange(s, range.startLine, range.startCol, range.endLine, range.endCol);
}

/** Operator + text object, mirroring applyOperatorToRange. */
export function opTextObject(
  s: EdState, op: Op,
  object: Parameters<typeof textObjectRange>[1],
  scope: "inner" | "around",
): void {
  const range = textObjectRange(s, object, scope);
  if (!range) return;
  const text =
    range.startLine === range.endLine
      ? (s.lines[range.startLine] ?? "").slice(range.startCol, range.endCol)
      : (() => {
          const parts = [(s.lines[range.startLine] ?? "").slice(range.startCol)];
          for (let i = range.startLine + 1; i < range.endLine; i++) parts.push(s.lines[i] ?? "");
          parts.push((s.lines[range.endLine] ?? "").slice(0, range.endCol));
          return parts.join("\n");
        })();
  setYank(text, "char");
  if (op === "yank") return;
  deleteRange(s, range.startLine, range.startCol, range.endLine, range.endCol);
}

/** f/t as operator target, mirroring resolveFind (zero-motion aborts). */
export function opFind(s: EdState, ch: string, kind: "f" | "t", op: Op): void {
  const target = findCharOnLine(s.lines[s.cursorLine] ?? "", s.cursorCol, ch, kind);
  if (target < 0) return;
  if (kind === "T" && target === s.cursorCol) return; // zero-motion T fails (nvim-verified)
  const [sl, sc, el, ec] = kind === "T"
    ? [s.cursorLine, target, s.cursorLine, s.cursorCol + 1]   // backward: includes cursor char
    : [s.cursorLine, s.cursorCol, s.cursorLine, target + 1];  // forward: f inclusive, t exclusive
  setYank(textBetweenLocal(s, sl, sc, el, ec), "char");
  if (op === "yank") return;
  deleteRange(s, sl, sc, el, ec);
}

function textBetweenLocal(s: EdState, sl: number, sc: number, el: number, ec: number): string {
  return (s.lines[sl] ?? "").slice(sc, ec); // find/till are line-local
}

export function hasNvim(): boolean {
  try { execFileSync("nvim", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

export interface NvimResult { i: number; lines: string[]; line: number; col: number }

/** Run every case through one headless nvim; returns results indexed by case. */
export function runNvim(cases: Case[]): NvimResult[] {
  const dir = mkdtempSync(join(tmpdir(), "pi-vim-parity-"));
  const outfile = join(dir, "results.json");
  const script: string[] = ["set startofline", "let res = []"]; // vim defaults: G/gg land on first non-blank
  cases.forEach((c, i) => {
    const lines = JSON.stringify(c.buffer); // JSON list == vim literal list for ASCII strings
    script.push("%delete _"); // clear the previous case buffer
    script.push(`call setline(1, ${lines})`);
    script.push(`call cursor(${c.cursor[0] + 1}, ${c.cursor[1] + 1})`);
    script.push(`execute 'normal! ${c.keys}'`);
    script.push(`call add(res, json_encode({"i": ${i}, "lines": getline(1, "$"), "line": line("."), "col": col(".")}))`);
  });
  script.push(`call writefile([json_encode(res)], '${outfile}')`);
  script.push("qa!");
  const scriptFile = join(dir, "parity.vim");
  writeFileSync(scriptFile, script.join("\n"));
  execFileSync("nvim", ["--headless", "-u", "NONE", "-i", "NONE", "-S", scriptFile], { stdio: "ignore" });
  // each entry was json_encoded individually, then the whole list again
  const entries = JSON.parse(readFileSync(outfile, "utf8")) as unknown[];
  return entries
    .map((entry) => JSON.parse(entry as string) as NvimResult)
    .sort((a, b) => a.i - b.i);
}
