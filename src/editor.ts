/**
 * PiVimEditor — modal vim editing for pi's prompt box.
 *
 * Modelled on Codex's composer vim mode: Normal + Insert only.
 * No visual mode, no counts, no dot-repeat. Operators (d/y/c) compose
 * with motions and text objects (di(, ciw, da").
 */

import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import type { VimMode, VimOperator, VimPending, VimTextObject, TextObjectScope, FindKind } from "./types.ts";
import { firstNonBlankCol, findWordEnd } from "./motions.ts";
import {
  type EdState,
  setYank, motionRange, deleteRange, deleteLines, pasteAfter, textObjectRange,
} from "./ops.ts";

// Motions that operators can target (also used standalone in normal mode)
const MOTIONS = ["h", "j", "k", "l", "w", "b", "e", "0", "$"] as const;
type Motion = (typeof MOTIONS)[number];

function isMotion(key: string): key is Motion {
  return (MOTIONS as readonly string[]).includes(key);
}

// Text object trigger keys → object type
const TEXT_OBJECTS: Record<string, VimTextObject> = {
  w: "word",
  W: "bigWord",
  "(": "parens", ")": "parens",
  "[": "brackets", "]": "brackets",
  "{": "braces", "}": "braces",
  '"': "doubleQuote",
  "'": "singleQuote",
  "`": "backtick",
};

// Find/till char trigger keys
const FIND_KEYS = new Set(["f", "t", "F", "T"]);

// ====================================================================
// PiVimEditor
// ====================================================================
export class PiVimEditor extends CustomEditor {
  mode: VimMode = "insert"; // entry mode — seamless until first Esc
  pending: VimPending = { type: "none" };
  /** Last find motion, for ; and , to repeat/reverse. */
  lastFind: { find: FindKind; char: string } | null = null;

  /** Callback to show keybinding reference (triggered by K in normal mode) */
  onKeybindingsRequest?: () => void;

  // ---- Base editor internals access ----
  private get st() {
    return (this as any).state as { lines: string[]; cursorLine: number; cursorCol: number };
  }

  private em(name: string, ...args: unknown[]) {
    (this as any)[name](...args);
  }

  get edState(): EdState {
    const s = this.st;
    return {
      get lines() { return s.lines; },
      set lines(v: string[]) { s.lines = v; },
      get cursorLine() { return s.cursorLine; },
      set cursorLine(v: number) { s.cursorLine = v; },
      get cursorCol() { return s.cursorCol; },
      set cursorCol(v: number) { s.cursorCol = v; },
      onChange: (text) => { if ((this as any).onChange) (this as any).onChange(text); },
      pushUndoSnapshot: () => { (this as any).pushUndoSnapshot(); },
    };
  }

  // ---- Main input handler ----
  // Esc priority: cancel pending op → leave Insert → pass through to pi (abort).
  // The last one is why double-tap Esc aborts streaming from Insert mode.
  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.pending.type !== "none") {
        this.pending = { type: "none" };
        return;
      }
      if (this.mode === "insert") {
        this.mode = "normal";
        return;
      }
      // Normal + no pending: let pi handle it (aborts streaming).
      super.handleInput(data);
      return;
    }
    if (this.mode === "insert") { super.handleInput(data); return; }
    this.handleNormal(data);
  }

  // ====================================================================
  // Normal mode
  // ====================================================================
  private handleNormal(data: string): void {
    // Resolve any pending operator / text-object / find state first
    if (this.pending.type === "operator") {
      this.handleOperatorPending(this.pending.operator, data);
      return;
    }
    if (this.pending.type === "textobject") {
      this.handleTextObjectPending(this.pending.operator, this.pending.scope, data);
      return;
    }
    if (this.pending.type === "find") {
      this.handleFindPending(this.pending.find, this.pending.operator, data);
      return;
    }
    if (this.pending.type === "gpending") {
      this.handleGpending(this.pending.operator, data);
      return;
    }

    // ---- Insert transitions ----
    switch (data) {
      case "i": this.mode = "insert"; return;
      case "a": this.em("moveCursor", 0, 1); this.mode = "insert"; return;
      case "I": this.st.cursorCol = firstNonBlankCol(this.st.lines[this.st.cursorLine] ?? ""); this.mode = "insert"; return;
      case "A": this.em("moveToLineEnd"); this.mode = "insert"; return;
      case "o": this.em("moveToLineEnd"); this.em("addNewLine"); this.mode = "insert"; return;
      case "O":
        this.em("moveCursor", -1, 0);
        this.em("moveToLineEnd");
        this.em("addNewLine");
        this.mode = "insert";
        return;
    }

    // ---- Motions ----
    if (isMotion(data)) { this.applyMotion(data); return; }

    // ---- Find / till char (standalone) ----
    if (FIND_KEYS.has(data)) {
      this.pending = { type: "find", find: data as FindKind };
      return;
    }
    if (data === ";" || data === ",") { this.repeatFind(data === ","); return; }

    // ---- Buffer jumps ----
    if (data === "G") { this.jumpLine(this.st.lines.length - 1, undefined); return; }
    if (data === "g") { this.pending = { type: "gpending" }; return; }

    // ---- Single-stroke edits ----
    const s = this.st;
    switch (data) {
      case "x": {
        const line = s.lines[s.cursorLine] ?? "";
        if (s.cursorCol < line.length) {
          const del = line[s.cursorCol];
          this.em("handleForwardDelete");
          setYank(del, "char");
        }
        return;
      }
      case "s": {
        const line = s.lines[s.cursorLine] ?? "";
        if (s.cursorCol < line.length) {
          setYank(line[s.cursorCol], "char");
          this.em("handleForwardDelete");
        }
        this.mode = "insert";
        return;
      }
      case "D": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        setYank(deleted, "char");
        return;
      }
      case "C": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        setYank(deleted, "char");
        this.mode = "insert";
        return;
      }
      case "Y": {
        setYank(s.lines[s.cursorLine] ?? "", "line");
        return;
      }
      case "p": {
        pasteAfter(this.edState);
        return;
      }
    }

    // ---- Start operators ----
    if (data === "d" || data === "y" || data === "c") {
      this.pending = { type: "operator", operator: operatorOf(data) };
      return;
    }

    // ---- Misc ----
    if (data === "K") { this.onKeybindingsRequest?.(); return; }
    if (data === "u") { this.em("undo"); return; }

    // Unrecognized printable: ignore; control keys fall through
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  // ====================================================================
  // Operator-pending (after d/y/c, before motion or text object)
  // ====================================================================
  private handleOperatorPending(op: VimOperator, data: string): void {
    // Repeat operator = whole line (dd, yy, cc)
    if (data === operatorKey(op)) {
      this.pending = { type: "none" };
      this.applyOperatorToLine(op);
      return;
    }
    // Esc / cancel — anything that isn't a motion, i/a prefix, find, or g/G cancels
    if (!isMotion(data) && data !== "i" && data !== "a" && !FIND_KEYS.has(data) && data !== ";" && data !== "," && data !== "g" && data !== "G") {
      this.pending = { type: "none" };
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }
    // Find/till under operator (df{ch}, dt{ch}, ...)
    if (FIND_KEYS.has(data)) {
      this.pending = { type: "find", find: data as FindKind, operator: op };
      return;
    }
    // ; / , under operator: apply to last find target
    if (data === ";" || data === ",") {
      this.pending = { type: "none" };
      if (this.lastFind) {
        const kind = data === "," ? reverseFind(this.lastFind.find) : this.lastFind.find;
        this.resolveFind(kind, this.lastFind.char, op);
      }
      return;
    }
    // G under operator: linewise to last line (dG, yG, cG)
    if (data === "G") {
      this.pending = { type: "none" };
      this.jumpLine(this.st.lines.length - 1, op);
      return;
    }
    // g under operator: wait for second g (dgg, ygg, cgg)
    if (data === "g") {
      this.pending = { type: "gpending", operator: op };
      return;
    }
    // Text object scope prefix
    if (data === "i" || data === "a") {
      this.pending = { type: "textobject", operator: op, scope: data === "i" ? "inner" : "around" };
      return;
    }
    // Motion
    this.pending = { type: "none" };
    this.applyOperatorToMotion(op, data);
  }

  // ====================================================================
  // Find/till char (f t F T)
  // ====================================================================
  private handleFindPending(find: FindKind, op: VimOperator | undefined, data: string): void {
    this.pending = { type: "none" };
    // Esc or non-printable cancels; pass control keys through
    if (data.length !== 1 || data.charCodeAt(0) < 32) {
      super.handleInput(data);
      return;
    }
    this.resolveFind(find, data, op);
  }

  /** Repeat last find. reverse=true flips direction (,). */
  private repeatFind(reverse: boolean) {
    if (!this.lastFind) return;
    const kind = reverse ? reverseFind(this.lastFind.find) : this.lastFind.find;
    this.resolveFind(kind, this.lastFind.char, undefined);
  }

  /** Apply a find motion, optionally as an operator target. */
  private resolveFind(find: FindKind, ch: string, op: VimOperator | undefined) {
    const s = this.st;
    const line = s.lines[s.cursorLine] ?? "";
    const target = findCharOnLine(line, s.cursorCol, ch, find);
    if (target < 0) return; // char not found on line — no-op
    this.lastFind = { find, char: ch };

    if (op === undefined) {
      s.cursorCol = target;
      return;
    }

    const isBackward = find === "F" || find === "T";
    // f/F include the found char; t/T land adjacent so +1 excludes it.
    // Backward motions include the cursor's char (endCol = cursor + 1).
    if (isBackward) {
      this.applyOperatorToRange(op, s.cursorLine, target, s.cursorLine, s.cursorCol + 1);
    } else {
      this.applyOperatorToRange(op, s.cursorLine, s.cursorCol, s.cursorLine, target + 1);
    }
  }

  // ====================================================================
  // Buffer jumps (gg / G)
  // ====================================================================
  private handleGpending(op: VimOperator | undefined, data: string): void {
    this.pending = { type: "none" };
    if (data === "g") {
      this.jumpLine(0, op);
      return;
    }
    // Any other key cancels; pass control keys through.
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  /** Jump to a line (0-indexed), optionally as a linewise operator target. */
  private jumpLine(targetLine: number, op: VimOperator | undefined) {
    const s = this.st;
    const clamped = Math.max(0, Math.min(targetLine, s.lines.length - 1));

    if (op === undefined) {
      s.cursorLine = clamped;
      s.cursorCol = firstNonBlankCol(s.lines[clamped] ?? "");
      return;
    }

    // Linewise: like dj/dk but to a buffer boundary.
    const lo = Math.min(s.cursorLine, clamped);
    const count = Math.abs(clamped - s.cursorLine) + 1;
    setYank(s.lines.slice(lo, lo + count).join("\n"), "line");
    if (op === "yank") return; // yank doesn't move cursor
    s.cursorLine = lo;
    deleteLines(this.edState, count);
    if (op === "change") this.mode = "insert";
  }

  // ====================================================================
  // Text-object-pending (after d/y/c + i/a)
  // ====================================================================
  private handleTextObjectPending(op: VimOperator, scope: TextObjectScope, data: string): void {
    this.pending = { type: "none" };
    const object = TEXT_OBJECTS[data];
    if (!object) {
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }
    const range = textObjectRange(this.edState, object, scope);
    if (!range) return;
    this.applyOperatorToRange(op, range.startLine, range.startCol, range.endLine, range.endCol);
  }

  // ====================================================================
  // Operator application
  // ====================================================================

  private applyOperatorToLine(op: VimOperator) {
    if (op === "yank") {
      setYank(this.st.lines[this.st.cursorLine] ?? "", "line");
      return;
    }
    const text = deleteLines(this.edState, 1);
    setYank(text, "line");
    if (op === "change") this.mode = "insert";
  }

  private applyOperatorToMotion(op: VimOperator, motion: string) {
    const s = this.st;

    // Vertical motions (j/k) are linewise: dj = delete current + next line
    if (motion === "j" || motion === "k") {
      const dir = motion === "j" ? 1 : -1;
      const target = Math.max(0, Math.min(s.cursorLine + dir, s.lines.length - 1));
      const lo = Math.min(s.cursorLine, target);
      const count = Math.abs(target - s.cursorLine) + 1;
      setYank(s.lines.slice(lo, lo + count).join("\n"), "line");
      if (op === "yank") return;
      s.cursorLine = lo;
      deleteLines(this.edState, count);
      if (op === "change") this.mode = "insert";
      return;
    }

    const range = motionRange(motion, 1, s.cursorLine, s.cursorCol, {
      applyMotion: (m, c) => this.applyMotion(m, c),
      st: this.st,
    });
    setYank(range.text, "char");
    if (op === "yank") return;
    deleteRange(this.edState, range.startLine, range.startCol, range.endLine, range.endCol);
    if (op === "change") this.mode = "insert";
  }

  private applyOperatorToRange(op: VimOperator, sl: number, sc: number, el: number, ec: number) {
    const s = this.st;
    const range = sl === el && sc === ec
      ? { text: s.lines[sl]?.slice(sc, ec) ?? "" }
      : { text: textBetween(s.lines, sl, sc, el, ec) };
    setYank(range.text, "char");
    if (op === "yank") return;
    deleteRange(this.edState, sl, sc, el, ec);
    if (op === "change") this.mode = "insert";
  }

  // ====================================================================
  // Motions (standalone)
  // ====================================================================
  private applyMotion(motion: string, _count = 1): void {
    const s = this.st;
    switch (motion) {
      case "h": this.em("moveCursor", 0, -1); break;
      case "j": this.em("moveCursor", 1, 0); break;
      case "k": this.em("moveCursor", -1, 0); break;
      case "l": this.em("moveCursor", 0, 1); break;
      case "w": this.em("moveWordForwards"); break;
      case "b": this.em("moveWordBackwards"); break;
      case "e": {
        const line = s.lines[s.cursorLine] ?? "";
        s.cursorCol = findWordEnd(line, s.cursorCol + 1);
        break;
      }
      case "0": s.cursorCol = 0; break;
      case "$": this.em("moveToLineEnd"); break;
    }
  }
}

// ====================================================================
// Helpers
// ====================================================================

function operatorOf(key: string): VimOperator {
  return key === "d" ? "delete" : key === "y" ? "yank" : "change";
}

function operatorKey(op: VimOperator): string {
  return op === "delete" ? "d" : op === "yank" ? "y" : "c";
}

/** Find target column for f/t/F/T. Returns -1 if not found on line. */
function findCharOnLine(line: string, fromCol: number, ch: string, kind: FindKind): number {
  switch (kind) {
    case "f": // next occurrence of ch after cursor
      for (let i = fromCol + 1; i < line.length; i++) if (line[i] === ch) return i;
      return -1;
    case "F": // previous occurrence of ch before cursor
      for (let i = fromCol - 1; i >= 0; i--) if (line[i] === ch) return i;
      return -1;
    case "t": // position just before next ch
      for (let i = fromCol + 1; i < line.length; i++) if (line[i] === ch) return i - 1;
      return -1;
    case "T": // position just after previous ch
      for (let i = fromCol - 1; i >= 0; i--) if (line[i] === ch) return i + 1;
      return -1;
  }
}

/** Reverse a find direction for ,. f<->F, t<->T. */
function reverseFind(kind: FindKind): FindKind {
  return kind === "f" ? "F" : kind === "F" ? "f" : kind === "t" ? "T" : "t";
}

/** Extract text between two positions for yank. */
function textBetween(lines: string[], sl: number, sc: number, el: number, ec: number): string {
  if (sl === el) return (lines[sl] ?? "").slice(sc, ec);
  const parts = [(lines[sl] ?? "").slice(sc)];
  for (let i = sl + 1; i < el; i++) parts.push(lines[i] ?? "");
  parts.push((lines[el] ?? "").slice(0, ec));
  return parts.join("\n");
}
