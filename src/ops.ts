import { isWordChar, isNonWhitespace } from "./motions.ts";
import type { YankedText, VimTextObject, TextObjectScope } from "./types.ts";

export interface EdState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  onChange?: (text: string) => void;
  pushUndoSnapshot?: () => void;
}

function getCursor(s: EdState) {
  return { line: s.cursorLine, col: s.cursorCol };
}

export function setCursorPos(s: EdState, line: number, col: number) {
  s.cursorLine = Math.max(0, Math.min(line, s.lines.length - 1));
  const maxCol = s.lines[s.cursorLine]?.length ?? 0;
  s.cursorCol = Math.max(0, Math.min(col, maxCol));
}

function notifyChanged(s: EdState) {
  s.onChange?.(s.lines.join("\n"));
}

// Yank buffer (module-level, cleared on session shutdown)
let yankBuffer: YankedText | null = null;

function getYank(): YankedText | null {
  return yankBuffer;
}

export function setYank(text: string, type: "char" | "line") {
  yankBuffer = { text, type };
}

/** Reset session-scoped mutable state. Call on session shutdown. */
export function resetState() {
  yankBuffer = null;
}

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
  opts: { inclusiveEnd?: boolean } = {},
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

  // Inclusive motions (e lands ON a character) extend the exclusive range
  // by one; past-end destinations (pi's `$` convention) already cover it.
  const endColX = endCol + (opts.inclusiveEnd ? 1 : 0);

  // Normalize direction so start <= end, then capture the covered text.
  const forward = startLine < endLine || (startLine === endLine && startCol <= endColX);
  const [aLine, aCol, bLine, bCol] = forward
    ? [startLine, startCol, endLine, endColX]
    : [endLine, endColX, startLine, startCol];
  return {
    startLine: aLine, startCol: aCol, endLine: bLine, endCol: bCol,
    text: textBetween(ed.st.lines, aLine, aCol, bLine, bCol),
  };
}

/** Delete a text range. Normalizes order so start <= end. Returns deleted text. */
export function deleteRange(s: EdState, sl: number, sc: number, el: number, ec: number): string {
  // Normalize so start <= end (up front, so the undo snapshot is taken once).
  if (sl > el || (sl === el && sc > ec)) {
    [sl, sc, el, ec] = [el, ec, sl, sc];
  }
  if (sl === el && sc === ec) return ""; // empty range — nothing to do, no undo entry

  s.pushUndoSnapshot?.(); // snapshot pre-change state so `u` restores it
  const lines = [...s.lines];
  let deletedText: string;

  if (sl === el) {
    deletedText = lines[sl].slice(sc, ec);
    lines[sl] = lines[sl].slice(0, sc) + lines[sl].slice(ec);
    s.lines = lines;
    setCursorPos(s, sl, sc);
  } else {
    deletedText = lines[sl].slice(sc) + "\n";
    for (let i = sl + 1; i < el; i++) deletedText += lines[i] + "\n";
    deletedText += lines[el].slice(0, ec);
    lines[sl] = lines[sl].slice(0, sc) + lines[el].slice(ec);
    s.lines = [...lines.slice(0, sl + 1), ...lines.slice(el + 1)];
    setCursorPos(s, sl, sc);
  }

  notifyChanged(s);
  return deletedText;
}

/** Delete `count` lines starting at cursor. Returns deleted text. */
export function deleteLines(s: EdState, count: number): string {
  const start = s.cursorLine;
  const end = Math.min(start + count, s.lines.length);
  if (end <= start) return "";
  s.pushUndoSnapshot?.(); // snapshot pre-change state so `u` restores it
  const deleted = s.lines.slice(start, end).join("\n");
  const newLines = [...s.lines.slice(0, start), ...s.lines.slice(end)];
  s.lines = newLines.length === 0 ? [""] : newLines;
  setCursorPos(s, Math.min(start, s.lines.length - 1), 0);
  notifyChanged(s);
  return deleted;
}

/** Paste yanked text after cursor. Linewise → new line below; charwise → after col. */
export function pasteAfter(s: EdState) {
  pasteImpl(s, true);
}

/** Paste yanked text at/before cursor. Linewise → new line above; charwise → at col. */
export function pasteBefore(s: EdState) {
  pasteImpl(s, false);
}

function pasteImpl(s: EdState, after: boolean) {
  const buf = getYank();
  if (!buf) return;
  if (buf.type === "char" && buf.text === "") return;
  const cursor = getCursor(s);
  s.pushUndoSnapshot?.(); // snapshot pre-change state so `u` restores it

  if (buf.type === "line") {
    const insertLines = buf.text.split("\n");
    const at = after ? cursor.line + 1 : cursor.line;
    s.lines = [...s.lines.slice(0, at), ...insertLines, ...s.lines.slice(at)];
    setCursorPos(s, at, 0);
  } else {
    const line = s.lines[cursor.line] ?? "";
    const insertAt = Math.min(cursor.col + (after ? 1 : 0), line.length);
    const parts = buf.text.split("\n");
    if (parts.length === 1) {
      s.lines[cursor.line] = line.slice(0, insertAt) + buf.text + line.slice(insertAt);
      setCursorPos(s, cursor.line, insertAt + buf.text.length - 1);
    } else {
      // Multi-line charwise yank (e.g. from di( on a multi-line block):
      // first part joins the line head, last part joins the tail.
      const head = line.slice(0, insertAt);
      const tail = line.slice(insertAt);
      const last = parts.length - 1;
      const inserted = [head + parts[0], ...parts.slice(1, last), parts[last] + tail];
      s.lines = [...s.lines.slice(0, cursor.line), ...inserted, ...s.lines.slice(cursor.line + 1)];
      setCursorPos(s, cursor.line + last, Math.max(0, parts[last].length - 1));
    }
  }
  notifyChanged(s);
}

/** Join the next line into the current one (vim `J`): one separating space,
 *  stripping trailing/leading whitespace, except no space before `)`.
 *  Cursor lands on the join point. No register effect. */
export function joinLines(s: EdState): void {
  if (s.cursorLine >= s.lines.length - 1) return; // no next line
  s.pushUndoSnapshot?.();
  const cur = (s.lines[s.cursorLine] ?? "").replace(/\s+$/, "");
  const next = (s.lines[s.cursorLine + 1] ?? "").replace(/^\s+/, "");
  const sep = cur === "" || next === "" || next.startsWith(")") ? "" : " ";
  s.lines[s.cursorLine] = cur + sep + next;
  s.lines = [...s.lines.slice(0, s.cursorLine + 1), ...s.lines.slice(s.cursorLine + 2)];
  setCursorPos(s, s.cursorLine, cur.length);
  notifyChanged(s);
}

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

function wordObjectRange(s: EdState, scope: TextObjectScope, bigWord: boolean): ObjRange | null {
  const line = s.lines[s.cursorLine] ?? "";
  const col = s.cursorCol;
  const isBound = bigWord ? isNonWhitespace : isWordChar;

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
      // innermost: among enclosing pairs, keep the smallest span (outer
      // pairs close last in the left-to-right scan and would overwrite).
      if (openIdx <= cursorOffset && cursorOffset <= i) {
        const span = i - openIdx;
        if (best === null || span < best.close - best.open) {
          best = { open: openIdx, close: i };
        }
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

/**
 * The grapheme at (line, col) - matches what the editor deletes in one
 * forward-delete, which is grapheme-based, not code-unit-based.
 * Returns "" when col is past the end of the line.
 */
export function graphemeAt(line: string, col: number): string {
  if (col < 0 || col >= line.length) return "";
  for (const segment of new Intl.Segmenter().segment(line)) {
    if (segment.index === col) return segment.segment;
    if (segment.index > col) return ""; // col landed mid-grapheme: nothing starts there
  }
  return "";
}

/** The grapheme immediately before col (the one handleBackspace removes).
 *  Returns "" when col is 0 or past the end. */
export function graphemeBefore(line: string, col: number): string {
  if (col <= 0 || col > line.length) return "";
  let last = "";
  for (const segment of new Intl.Segmenter().segment(line)) {
    if (segment.index >= col) break;
    last = segment.segment;
  }
  return last;
}

/** Extract the text between two positions, joining lines with newlines. */
export function textBetween(lines: string[], sl: number, sc: number, el: number, ec: number): string {
  if (sl === el) return (lines[sl] ?? "").slice(sc, ec);
  const parts = [(lines[sl] ?? "").slice(sc)];
  for (let i = sl + 1; i < el; i++) parts.push(lines[i] ?? "");
  parts.push((lines[el] ?? "").slice(0, ec));
  return parts.join("\n");
}
