/**
 * PiVimEditor — modal vim editing for pi's prompt box.
 *
 * Extends CustomEditor with normal/insert/visual mode handling,
 * vim motions, operators, and dot-repeat.
 */

import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import type { VimMode, VisualType, OperatorType, PrefixType, ReplayOp } from "./types.ts";
import { findWordEnd, findPrevParagraph, findNextParagraph, firstNonBlankCol, lastNonBlankCol } from "./motions.ts";
import {
  type EdState, setYank, getYank, recordOp, getLastOp,
  motionRange, deleteRange, deleteLines, pasteAfter, pasteBefore, replayLastOp,
} from "./ops.ts";

// ====================================================================
// PiVimEditor
// ====================================================================
export class PiVimEditor extends CustomEditor {
  mode: VimMode = "insert";
  pendingOp: { type: OperatorType | PrefixType; count: number } | null = null;
  countBuffer = "";
  visualStart: { line: number; col: number } | null = null;
  visualType: VisualType = "char";
  lastReplayOp: ReplayOp | null = null;
  visualPendingGPrefix = false;

  // Expose state for ops.ts functions
  get edState(): EdState {
    const st = this.st;
    return {
      get lines() { return st.lines; },
      set lines(v: string[]) { st.lines = v; },
      get cursorLine() { return st.cursorLine; },
      set cursorLine(v: number) { st.cursorLine = v; },
      get cursorCol() { return st.cursorCol; },
      set cursorCol(v: number) { st.cursorCol = v; },
      onChange: (text) => { if ((this as any).onChange) (this as any).onChange(text); },
      pushUndoSnapshot: () => { (this as any).pushUndoSnapshot(); },
    };
  }

  // ---- Base editor internals access ----
  private get st() {
    return (this as any).state as { lines: string[]; cursorLine: number; cursorCol: number };
  }

  private em(name: string, ...args: unknown[]) {
    // Call directly on (this as any) to preserve 'this' binding in the base class method
    (this as any)[name](...args);
  }

  // ---- Motion wrappers (call editor internals then pure helpers) ----
  applyMotion(motion: string, count: number): void {
    const s = this.st;
    switch (motion) {
      case "h": this.repeat(() => this.em("moveCursor", 0, -1), count); break;
      case "j": this.repeat(() => this.em("moveCursor", 1, 0), count); break;
      case "k": this.repeat(() => this.em("moveCursor", -1, 0), count); break;
      case "l": this.repeat(() => this.em("moveCursor", 0, 1), count); break;
      case "w": this.repeat(() => this.em("moveWordForwards"), count); break;
      case "b": this.repeat(() => this.em("moveWordBackwards"), count); break;
      case "e": this.repeat(() => {
        const line = s.lines[s.cursorLine] ?? "";
        const col = findWordEnd(line, s.cursorCol);
        s.cursorCol = col;
      }, count); break;
      case "0": s.cursorCol = 0; break;
      case "$": this.em("moveToLineEnd"); break;
      case "^": {
        const line = s.lines[s.cursorLine] ?? "";
        s.cursorCol = firstNonBlankCol(line);
        break;
      }
      case "g_": {
        const line = s.lines[s.cursorLine] ?? "";
        s.cursorCol = lastNonBlankCol(line);
        break;
      }
      case "gg": this.goToLine(count === 1 ? 0 : count - 1); break;
      case "G": this.goToLine(count === 1 ? s.lines.length - 1 : count - 1); break;
      case "{": this.paragraphJump(-1); break;
      case "}": this.paragraphJump(1); break;
    }
  }

  private goToLine(target: number) {
    const s = this.st;
    s.cursorLine = Math.max(0, Math.min(target, s.lines.length - 1));
    s.cursorCol = 0;
  }

  private paragraphJump(dir: -1 | 1) {
    const s = this.st;
    const target = dir === -1
      ? findPrevParagraph(s.lines, s.cursorLine)
      : findNextParagraph(s.lines, s.cursorLine);
    s.cursorLine = target;
    s.cursorCol = 0;
  }

  private repeat(fn: () => void, count: number) {
    for (let i = 0; i < count; i++) fn();
  }

  // ---- Main input handler ----
  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.mode === "insert") {
        this.mode = "normal";
        this.pendingOp = null;
        this.countBuffer = "";
      } else if (this.mode === "visual") {
        this.mode = "normal";
        this.visualStart = null;
      } else {
        super.handleInput(data);
      }
      return;
    }
    if (this.mode === "insert") { super.handleInput(data); return; }
    if (this.mode === "visual") { this.handleVisual(data); return; }
    this.handleNormal(data);
  }

  // ---- Normal mode ----
  private handleNormal(data: string): void {
    // Ctrl+r — consume (no redo in base editor)
    if (matchesKey(data, "ctrl+r")) return;

    // Numbers: 1-9 start count, 0 continues existing count only
    if (/^[1-9]$/.test(data)) { this.countBuffer += data; return; }
    if (data === "0" && this.countBuffer.length > 0) { this.countBuffer += data; return; }

    const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
    this.countBuffer = "";

    // Pending operator/prefix
    if (this.pendingOp) {
      if (this.pendingOp.type === "g") {
        this.handleGPrefix(data, count);
        return;
      }
      this.handlePendingOperator(data, count);
      return;
    }

    // Single-key commands
    const s = this.st;
    switch (data) {
      // Motions
      case "h": case "j": case "k": case "l":
      case "w": case "b": case "e":
      case "0": case "$": case "^":
      case "{": case "}":
        this.applyMotion(data, data === "0" || data === "$" || data === "^" || data === "{" || data === "}" ? 1 : count);
        break;
      case "G": this.applyMotion("G", count); break;

      // Prefixes
      case "g": this.pendingOp = { type: "g", count }; return;
      case "d": case "y": case "c":
        this.pendingOp = { type: data as OperatorType, count }; return;

      // Edit commands
      case "x": {
        for (let i = 0; i < count; i++) this.em("handleForwardDelete");
        recordOp({ kind: "delete-char", count });
        break;
      }
      case "X": {
        for (let i = 0; i < count; i++) this.em("handleBackspace");
        break;
      }
      case "s": { this.em("handleForwardDelete"); this.mode = "insert"; break; }
      case "S": { deleteLines(this.edState, 1); this.mode = "insert"; break; }
      case "D": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        setYank(deleted, "char");
        recordOp({ kind: "delete-motion", motion: "$", count: 1, text: deleted });
        break;
      }
      case "C": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        setYank(deleted, "char");
        this.mode = "insert";
        break;
      }
      case "Y": {
        const line = s.lines[s.cursorLine] ?? "";
        setYank(line, "line");
        recordOp({ kind: "yank-line", count: 1 });
        break;
      }
      case "p": { pasteAfter(this.edState, count); recordOp({ kind: "paste", count }); break; }
      case "P": { pasteBefore(this.edState, count); recordOp({ kind: "paste-before", count }); break; }
      case "u": this.em("undo"); break;
      case ".": {
        const result = replayLastOp(this.edState, this);
        if (result === "insert") this.mode = "insert";
        if (result === "inplace") {
          // delete-char: repeat via ForwardDelete
          const op = getLastOp();
          for (let i = 0; i < (op?.count ?? 1); i++) this.em("handleForwardDelete");
        }
        break;
      }

      // Enter insert mode
      case "i": this.mode = "insert"; break;
      case "a": { this.em("moveCursor", 0, 1); this.mode = "insert"; break; }
      case "I": { this.em("moveToLineStart"); s.cursorCol = firstNonBlankCol(s.lines[s.cursorLine] ?? ""); this.mode = "insert"; break; }
      case "A": { this.em("moveToLineEnd"); this.mode = "insert"; break; }
      case "o": { this.em("moveToLineEnd"); this.em("addNewLine"); this.mode = "insert"; break; }
      case "O": {
        if (s.cursorLine > 0) {
          s.cursorCol = 0;
          this.em("addNewLine");
          s.cursorLine = s.cursorLine - 1;
        } else {
          s.cursorCol = 0;
          this.em("addNewLine");
          s.cursorLine = 0;
        }
        this.mode = "insert";
        break;
      }

      // Visual mode
      case "v": {
        this.visualStart = { line: s.cursorLine, col: s.cursorCol };
        this.visualType = "char"; this.mode = "visual"; break;
      }
      case "V": {
        this.visualStart = { line: s.cursorLine, col: 0 };
        this.visualType = "line"; this.mode = "visual"; break;
      }

      // Ignore printable chars
      default:
        if (data.length === 1 && data.charCodeAt(0) >= 32) return;
        super.handleInput(data);
    }
  }

  // ---- g prefix handler ----
  private handleGPrefix(data: string, count: number) {
    if (data === "g") this.goToLine(count === 1 ? 0 : count - 1);
    else if (data === "_") {
      const line = this.st.lines[this.st.cursorLine] ?? "";
      this.st.cursorCol = lastNonBlankCol(line);
    } else if (data === "e") {
      this.repeat(() => {
        this.em("moveWordBackwards");
        const line = this.st.lines[this.st.cursorLine] ?? "";
        this.st.cursorCol = findWordEnd(line, this.st.cursorCol);
      }, count);
    }
    this.pendingOp = null;
  }

  // ---- Operator pending handler (d, y, c) ----
  private handlePendingOperator(data: string, count: number) {
    const op = this.pendingOp!.type as OperatorType;
    const opCount = this.pendingOp!.count * count;
    const s = this.st;

    // Line operators (dd, yy, cc)
    if (data === op) {
      this.pendingOp = null;
      if (op === "d") {
        const text = deleteLines(this.edState, opCount);
        setYank(text, "line");
        recordOp({ kind: "delete-line", count: opCount });
      } else if (op === "y") {
        const end = Math.min(s.cursorLine + opCount, s.lines.length);
        const text = s.lines.slice(s.cursorLine, end).join("\n");
        setYank(text, "line");
        recordOp({ kind: "yank-line", count: opCount });
      } else if (op === "c") {
        const text = deleteLines(this.edState, opCount);
        setYank(text, "line");
        recordOp({ kind: "change-line", count: opCount });
        this.mode = "insert";
      }
      return;
    }

    // Operator + motion
    const motions = ["h","j","k","l","w","b","e","0","$","^","gg","G","{","}","g_"];
    if (!motions.includes(data)) {
      this.pendingOp = null;
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }

    this.pendingOp = null;
    const range = motionRange(data, opCount, s.cursorLine, s.cursorCol, this);
    setYank(range.text, "char");

    if (op === "d") {
      deleteRange(this.edState, range.startLine, range.startCol, range.endLine, range.endCol);
      recordOp({ kind: "delete-motion", motion: data, count: opCount, text: range.text });
    } else if (op === "y") {
      recordOp({ kind: "yank-motion", motion: data, count: opCount, text: range.text });
    } else if (op === "c") {
      deleteRange(this.edState, range.startLine, range.startCol, range.endLine, range.endCol);
      recordOp({ kind: "change-motion", motion: data, count: opCount, text: range.text });
      this.mode = "insert";
    }
  }

  // ---- Visual mode ----
  private handleVisual(data: string): void {
    // g prefix for gg/g_
    if (this.visualPendingGPrefix) {
      this.visualPendingGPrefix = false;
      if (data === "g") { this.applyMotion("gg", 1); this.countBuffer = ""; return; }
      if (data === "_") { this.applyMotion("g_", 1); this.countBuffer = ""; return; }
      this.countBuffer = "";
    }
    if (data === "g") { this.visualPendingGPrefix = true; return; }

    // Single-key motions extend selection
    const motions = ["h","j","k","l","w","b","e","0","$","^","G","{","}"];
    if (motions.includes(data)) {
      this.applyMotion(data, this.countBuffer ? parseInt(this.countBuffer, 10) : 1);
      this.countBuffer = "";
      return;
    }

    // Count numbers
    if (/^[1-9]$/.test(data)) { this.countBuffer += data; return; }
    if (data === "0" && this.countBuffer.length > 0) { this.countBuffer += data; return; }
    this.countBuffer = "";

    // Build selection range
    const cursor = { line: this.st.cursorLine, col: this.st.cursorCol };
    const start = this.visualStart!;
    const sL = start.line, sC = start.col, eL = cursor.line, eC = cursor.col;

    const selText = (): string => {
      if (this.visualType === "line") {
        const [ls, le] = sL <= eL ? [sL, eL] : [eL, sL];
        return this.st.lines.slice(ls, le + 1).join("\n");
      }
      if (sL === eL) {
        const [a, b] = sC <= eC ? [sC, eC] : [eC, sC];
        return this.st.lines[sL].slice(a, b);
      }
      const fL = sL <= eL ? sL : eL, fC = sL <= eL ? sC : eC;
      const tL = sL <= eL ? eL : sL, tC = sL <= eL ? eC : sC;
      const parts = [this.st.lines[fL].slice(fC)];
      for (let i = fL + 1; i < tL; i++) parts.push(this.st.lines[i]);
      parts.push(this.st.lines[tL].slice(0, tC));
      return parts.join("\n");
    };

    const delSelection = (insertMode = false) => {
      const text = selText();
      setYank(text, this.visualType);
      if (this.visualType === "line") {
        const [ls, le] = sL <= eL ? [sL, eL] : [eL, sL];
        const nl = [...this.st.lines.slice(0, ls), ...this.st.lines.slice(le + 1)];
        this.st.lines = nl.length === 0 ? [""] : nl;
        this.st.cursorLine = Math.min(ls, this.st.lines.length - 1);
        this.st.cursorCol = 0;
      } else {
        const [rS, rE] = sL <= eL ? [sL, eL] : [eL, sL];
        const [rC1, rC2] = sL <= eL ? [sC, eC] : [eC, sC];
        deleteRange(this.edState, rS, rC1, rE, rC2);
      }
      this.mode = insertMode ? "insert" : "normal";
      this.visualStart = null;
    };

    switch (data) {
      case "d": case "x": delSelection(); break;
      case "y": setYank(selText(), this.visualType); this.mode = "normal"; this.visualStart = null; break;
      case "c": delSelection(true); break;
      case "v": this.visualType = "char"; break;
      case "V": this.visualType = "line"; break;
      default:
        if (data.length === 1 && data.charCodeAt(0) >= 32) return;
        super.handleInput(data);
    }
  }
}
