/**
 * Text operations — work on a mutable editor state bag.
 * No dependency on PiVimEditor class.
 */

import type { YankedText, ReplayOp } from "./types.ts";

// ---- Editor state shape we operate on ----
export interface EdState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  onChange?: (text: string) => void;
  pushUndoSnapshot?: () => void;
}

// ---- Cursor helpers ----
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

// ---- Yank buffer (module-level, shared across sessions) ----
let yankBuffer: YankedText | null = null;

export function getYank(): YankedText | null {
  return yankBuffer;
}

export function setYank(text: string, type: "char" | "line") {
  if (type === "line" && text.endsWith("\n")) text = text.slice(0, -1);
  yankBuffer = { text, type };
}

// ---- Dot repeat state ----
let lastOp: ReplayOp | null = null;

export function recordOp(op: ReplayOp) {
  lastOp = op;
}

export function getLastOp(): ReplayOp | null {
  return lastOp;
}

// ---- Motion range computation ----
export interface TextRange {
  startLine: number; startCol: number;
  endLine: number; endCol: number;
  text: string;
}

export function motionRange(
  motion: string, count: number,
  startLine: number, startCol: number,
  ed: {
    applyMotion(m: string, c: number): void;
    st: { lines: string[]; cursorLine: number; cursorCol: number };
  },
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

  // Multi-line
  const parts: string[] = [];
  if (startLine < endLine) {
    parts.push(lines[startLine].slice(startCol));
    for (let i = startLine + 1; i < endLine; i++) parts.push(lines[i]);
    parts.push(lines[endLine].slice(0, endCol));
    return { startLine, startCol, endLine, endCol, text: parts.join("\n") };
  } else {
    parts.push(lines[endLine].slice(endCol));
    for (let i = endLine + 1; i < startLine; i++) parts.push(lines[i]);
    parts.push(lines[startLine].slice(0, startCol));
    return { startLine: endLine, startCol: endCol, endLine: startLine, endCol: startCol, text: parts.join("\n") };
  }
}

// ---- Delete a text range ----
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

// ---- Delete current line(s) ----
export function deleteLines(s: EdState, count: number): string {
  const start = s.cursorLine;
  const end = Math.min(start + count, s.lines.length);
  const deleted = s.lines.slice(start, end).join("\n");
  const suffix = end < s.lines.length ? "\n" : "";
  const newLines = [...s.lines.slice(0, start), ...s.lines.slice(end)];
  s.lines = newLines.length === 0 ? [""] : newLines;
  setCursorPos(s, Math.min(start, s.lines.length - 1), 0);
  notifyChanged(s);
  return deleted + suffix;
}

// ---- Paste operations ----
export function pasteAfter(s: EdState, count: number) {
  const buf = getYank();
  if (!buf) return;
  const cursor = getCursor(s);

  if (buf.type === "line") {
    let text = "";
    for (let i = 0; i < count; i++) {
      text += buf.text;
      if (i < count - 1) text += "\n";
    }
    const insertLines = text.split("\n");
    s.lines = [...s.lines.slice(0, cursor.line + 1), ...insertLines, ...s.lines.slice(cursor.line + 1)];
    setCursorPos(s, cursor.line + insertLines.length, 0);
  } else {
    let text = buf.text;
    for (let i = 1; i < count; i++) text += buf.text;
    const line = s.lines[cursor.line] ?? "";
    s.lines[cursor.line] = line.slice(0, cursor.col) + text + line.slice(cursor.col);
    setCursorPos(s, cursor.line, cursor.col + text.length);
  }
  notifyChanged(s);
}

export function pasteBefore(s: EdState, count: number) {
  const buf = getYank();
  if (!buf) return;
  const cursor = getCursor(s);

  if (buf.type === "line") {
    let text = "";
    for (let i = 0; i < count; i++) {
      text += buf.text;
      if (i < count - 1) text += "\n";
    }
    const insertLines = text.split("\n");
    s.lines = [...s.lines.slice(0, cursor.line), ...insertLines, ...s.lines.slice(cursor.line)];
    setCursorPos(s, cursor.line, 0);
  } else {
    let text = buf.text;
    for (let i = 1; i < count; i++) text += buf.text;
    const line = s.lines[cursor.line] ?? "";
    s.lines[cursor.line] = line.slice(0, cursor.col) + text + line.slice(cursor.col);
    setCursorPos(s, cursor.line, cursor.col);
  }
  notifyChanged(s);
}

// ---- Replay last operation ----
/**
 * ed must be provided for motion-based replays.
 * ed has: { applyMotion(m, c): void; st: { lines; cursorLine; cursorCol } }
 */
export function replayLastOp(
  s: EdState,
  ed?: { applyMotion(m: string, c: number): void; st: { lines: string[]; cursorLine: number; cursorCol: number } },
): "insert" | "inplace" | null {
  const op = getLastOp();
  if (!op) return null;
  const count = op.count ?? 1;

  switch (op.kind) {
    case "delete-line":
      deleteLines(s, count);
      break;
    case "yank-line": {
      const start = s.cursorLine;
      const end = Math.min(start + count, s.lines.length);
      setYank(s.lines.slice(start, end).join("\n"), "line");
      break;
    }
    case "change-line":
      deleteLines(s, count);
      return "insert";
    case "delete-motion":
    case "change-motion": {
      if (!op.motion || !ed) break;
      const range = motionRange(op.motion, count, s.cursorLine, s.cursorCol, ed);
      deleteRange(s, range.startLine, range.startCol, range.endLine, range.endCol);
      setYank(range.text, "char");
      return op.kind === "change-motion" ? "insert" : null;
    }
    case "delete-char":
      // Handled inline in editor for ForwardDelete
      return "inplace";
    case "paste":
      pasteAfter(s, count);
      break;
    case "paste-before":
      pasteBefore(s, count);
      break;
  }
  return null;
}

// ---- Pending operator resolution ----
export function resolvePendingOp(
  s: EdState,
  motion: string,
  opCount: number,
  ed: { applyMotion(m: string, c: number): void; st: { lines: string[]; cursorLine: number; cursorCol: number } },
): "insert" | null {
  if (motion === "repeat") {
    return null; // handled by editor for line ops
  }

  const range = motionRange(motion, opCount, s.cursorLine, s.cursorCol, ed);
  deleteRange(s, range.startLine, range.startCol, range.endLine, range.endCol);
  setYank(range.text, "char");
  return null;
}
