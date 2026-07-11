/**
 * Text operations — work on a mutable editor state bag.
 * No dependency on PiVimEditor class.
 *
 * Supports: operator+motion ranges, line delete/yank, char/line paste,
 * and text object range computation (word, WORD, paired, quoted).
 */

import { isWordChar, isNonWhitespace } from "./motions.ts";
import type { YankedText, VimTextObject, TextObjectScope } from "./types.ts";

// ====================================================================
// Editor state shape
// ====================================================================
export interface EdState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  onChange?: (text: string) => void;
  pushUndoSnapshot?: () => void;
}

export function getCursor(s: EdState) {
  return { line: s.cursorLine, col: s.cursorCol };
}

export function setCursorPos(s: EdState, line: number, col: number) {
  s.cursorLine = Math.max(0, Math.min(line, s.lines.length - 1));
  const maxCol = s.lines[s.cursorLine]?.length ?? 0;
  s.cursorCol = Math.max(0, Math.min(col, maxCol));
}

function notifyChanged(s: EdState) {
  s.pushUndoSnapshot?.();
  s.onChange?.(s.lines.join("\n"));
}

// ====================================================================
// Yank buffer (module-level, cleared on session shutdown)
// ====================================================================
let yankBuffer: YankedText | null = null;

export function getYank(): YankedText | null {
  return yankBuffer;
}

export function setYank(text: string, type: "char" | "line") {
  yankBuffer = { text, type };
}

/** Reset session-scoped mutable state. Call on session shutdown. */
export function resetState() {
  yankBuffer = null;
}

// ====================================================================
// Motion range computation (for operator + motion)
// ====================================================================
export interface TextRange {
  startLine: number; startCol: number;
  endLine: number; endCol: number;
  text: string;
}

export interface MotionCtx {
  applyMotion(m: string, c: number): void;
  st: { lines: string[]; cursorLine: number; cursorCol: number };
}

/**
 * Compute the text range covered by a motion from (startLine, startCol).
 * Uses applyMotion to find the destination, then captures everything between.
 */
export function motionRange(
  motion: string, count: number,
  startLine: number, startCol: number,
  ed: MotionCtx,
): TextRange {
  const savedLine = ed.st.cursorLine;
  const savedCol = ed.st.cursorCol;
  ed.st.cursorLine = startLine;
  ed.st.cursorCol = startCol;
  ed.applyMotion(motion, count);
  const endLine = ed.st.cursorLine;
  const endCol = ed.st.cursorCol;
  ed.st.cursorLine = savedLine;
  ed.st.cursorCol = savedCol;

  const lines = ed.st.lines;
  if (startLine === endLine) {
    const [start, end] = startCol <= endCol ? [startCol, endCol] : [endCol, startCol];
    return { startLine, startCol: start, endLine, endCol: end, text: lines[startLine].slice(start, end) };
  }

  const parts: string[] = [];
  if (startLine < endLine) {
    parts.push(lines[startLine].slice(startCol));
    for (let i = startLine + 1; i < endLine; i++) parts.push(lines[i]);
    parts.push(lines[endLine].slice(0, endCol));
    return { startLine, startCol, endLine, endCol, text: parts.join("\n") };
  }
  parts.push(lines[endLine].slice(endCol));
  for (let i = endLine + 1; i < startLine; i++) parts.push(lines[i]);
  parts.push(lines[startLine].slice(0, startCol));
  return { startLine: endLine, startCol: endCol, endLine: startLine, endCol: startCol, text: parts.join("\n") };
}

// ====================================================================
// Delete operations
// ====================================================================

/** Delete a text range. Normalizes order so start <= end. Returns deleted text. */
export function deleteRange(s: EdState, sl: number, sc: number, el: number, ec: number): string {
  const lines = [...s.lines];
  let deletedText: string;

  if (sl === el) {
    const [a, b] = sc <= ec ? [sc, ec] : [ec, sc];
    deletedText = lines[sl].slice(a, b);
    lines[sl] = lines[sl].slice(0, a) + lines[sl].slice(b);
    s.lines = lines;
    setCursorPos(s, sl, a);
  } else if (sl < el) {
    deletedText = lines[sl].slice(sc) + "\n";
    for (let i = sl + 1; i < el; i++) deletedText += lines[i] + "\n";
    deletedText += lines[el].slice(0, ec);
    lines[sl] = lines[sl].slice(0, sc) + lines[el].slice(ec);
    s.lines = [...lines.slice(0, sl + 1), ...lines.slice(el + 1)];
    setCursorPos(s, sl, sc);
  } else {
    return deleteRange(s, el, ec, sl, sc);
  }

  notifyChanged(s);
  return deletedText;
}

/** Delete `count` lines starting at cursor. Returns deleted text. */
export function deleteLines(s: EdState, count: number): string {
  const start = s.cursorLine;
  const end = Math.min(start + count, s.lines.length);
  const deleted = s.lines.slice(start, end).join("\n");
  const newLines = [...s.lines.slice(0, start), ...s.lines.slice(end)];
  s.lines = newLines.length === 0 ? [""] : newLines;
  setCursorPos(s, Math.min(start, s.lines.length - 1), 0);
  notifyChanged(s);
  return deleted;
}

// ====================================================================
// Paste
// ====================================================================

/** Paste yanked text after cursor. Linewise → new line below; charwise → after col. */
export function pasteAfter(s: EdState) {
  const buf = getYank();
  if (!buf) return;
  const cursor = getCursor(s);

  if (buf.type === "line") {
    const insertLines = buf.text.split("\n");
    s.lines = [...s.lines.slice(0, cursor.line + 1), ...insertLines, ...s.lines.slice(cursor.line + 1)];
    setCursorPos(s, cursor.line + 1, 0);
  } else {
    const line = s.lines[cursor.line] ?? "";
    const insertAt = Math.min(cursor.col + 1, line.length);
    s.lines[cursor.line] = line.slice(0, insertAt) + buf.text + line.slice(insertAt);
    setCursorPos(s, cursor.line, insertAt + buf.text.length - 1);
  }
  notifyChanged(s);
}

// ====================================================================
// Text object ranges
// ====================================================================

export interface ObjRange {
  startLine: number; startCol: number;
  endLine: number; endCol: number;
}

/**
 * Compute the byte range of a text object at the cursor.
 * Returns null if the object is not found at the cursor position.
 *
 * Word/WORD operate on the cursor line.
 * Paired delimiters search across the whole buffer.
 * Quoted strings operate on the cursor line.
 */
export function textObjectRange(
  s: EdState,
  object: VimTextObject,
  scope: TextObjectScope,
): ObjRange | null {
  switch (object) {
    case "word": return wordObjectRange(s, scope, false);
    case "bigWord": return wordObjectRange(s, scope, true);
    case "parens": return pairedObjectRange(s, scope, "(", ")");
    case "brackets": return pairedObjectRange(s, scope, "[", "]");
    case "braces": return pairedObjectRange(s, scope, "{", "}");
    case "doubleQuote": return quotedObjectRange(s, scope, '"');
    case "singleQuote": return quotedObjectRange(s, scope, "'");
    case "backtick": return quotedObjectRange(s, scope, "`");
  }
}

/** iw/aw or iW/aW — word or WORD on the current line. */
function wordObjectRange(s: EdState, scope: TextObjectScope, bigWord: boolean): ObjRange | null {
  const line = s.lines[s.cursorLine] ?? "";
  const col = s.cursorCol;
  const isBound = bigWord ? isNonWhitespace : isWordChar;

  // If cursor is on a non-boundary char, find the run containing it
  if (col < line.length && isBound(line[col])) {
    let start = col;
    while (start > 0 && isBound(line[start - 1])) start--;
    let end = col;
    while (end < line.length && isBound(line[end])) end++;
    return scope === "around"
      ? expandWordAround(line, start, end, s.cursorLine)
      : { startLine: s.cursorLine, startCol: start, endLine: s.cursorLine, endCol: end };
  }

  // Cursor on whitespace/punctuation: around targets the following word
  if (scope === "around") {
    let start = col;
    while (start < line.length && !isBound(line[start])) start++;
    if (start >= line.length) return null;
    let end = start;
    while (end < line.length && isBound(line[end])) end++;
    return { startLine: s.cursorLine, startCol: col, endLine: s.cursorLine, endCol: end };
  }
  return null;
}

/** For aw: include trailing whitespace, or leading if no trailing. */
function expandWordAround(line: string, start: number, end: number, cursorLine: number): ObjRange {
  let s = start, e = end;
  while (e < line.length && /\s/.test(line[e])) e++;
  if (e === end) {
    while (s > 0 && /\s/.test(line[s - 1])) s--;
  }
  return { startLine: cursorLine, startCol: s, endLine: cursorLine, endCol: e };
}

/**
 * i( / a( — find innermost matching pair surrounding cursor.
 * Searches across the whole buffer (delimiters may span lines).
 */
function pairedObjectRange(
  s: EdState,
  scope: TextObjectScope,
  open: string,
  close: string,
): ObjRange | null {
  const flat = s.lines.join("\n");
  const cursorOffset = flatOffset(s.lines, s.cursorLine, s.cursorCol);

  const stack: number[] = [];
  let best: { open: number; close: number } | null = null;

  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === open) {
      stack.push(i);
    } else if (ch === close) {
      const openIdx = stack.pop();
      if (openIdx === undefined) continue;
      if (openIdx <= cursorOffset && cursorOffset <= i) {
        best = { open: openIdx, close: i };
      }
    }
  }
  if (!best) return null;

  const innerStart = best.open + 1;
  const innerEnd = best.close;
  const a = scope === "around" ? best.open : innerStart;
  const b = scope === "around" ? best.close + 1 : innerEnd;
  const start = flatToLineCol(s.lines, a);
  const end = flatToLineCol(s.lines, b);
  return { startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col };
}

/** i" / a" — quoted string on the current line. */
function quotedObjectRange(
  s: EdState,
  scope: TextObjectScope,
  quote: string,
): ObjRange | null {
  const line = s.lines[s.cursorLine] ?? "";
  let open: number | null = null;
  let best: { open: number; close: number } | null = null;

  for (let i = 0; i < line.length; i++) {
    if (line[i] !== quote) continue;
    if (open === null) {
      open = i;
    } else {
      if (open <= s.cursorCol && s.cursorCol <= i) {
        best = { open, close: i };
      }
      open = null;
    }
  }
  if (!best) return null;

  const a = scope === "around" ? best.open : best.open + 1;
  const b = scope === "around" ? best.close + 1 : best.close;
  return { startLine: s.cursorLine, startCol: a, endLine: s.cursorLine, endCol: b };
}

// ---- flat-string offset helpers (for paired delimiters spanning lines) ----

function flatOffset(lines: string[], line: number, col: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1; // +1 for \n
  return offset + col;
}

function flatToLineCol(lines: string[], offset: number): { line: number; col: number } {
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length;
    if (pos + len >= offset) return { line: i, col: offset - pos };
    pos += len + 1;
  }
  return { line: lines.length - 1, col: lines[lines.length - 1]?.length ?? 0 };
}
