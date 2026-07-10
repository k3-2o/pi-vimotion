/**
 * PiVimEditor — modal vim editing for pi's prompt box.
 *
 * Extends CustomEditor with normal/insert/visual mode handling,
 * vim motions, operators, and dot-repeat.
 */

import { CustomEditor, copyToClipboard } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, truncateToWidth, CURSOR_MARKER } from "@earendil-works/pi-tui";
import type { VimMode, VisualType, OperatorType, PrefixType } from "./types.ts";
import { findWordEnd, findPrevParagraph, findNextParagraph, firstNonBlankCol, lastNonBlankCol } from "./motions.ts";
import {
  type EdState, setYank, recordOp, getLastOp,
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
  visualPendingGPrefix = false;

  /** Callback to show keybinding reference (triggered by K in normal mode) */
  onKeybindingsRequest?: () => void;

  // Expose state for ops.ts functions
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

  // ---- Base editor internals access ----
  private get st() {
    return (this as any).state as { lines: string[]; cursorLine: number; cursorCol: number };
  }

  private em(name: string, ...args: unknown[]) {
    (this as any)[name](...args);
  }

  // ---- Motion wrappers ----
  applyMotion(motion: string, count: number): void {
    const s = this.st;
    switch (motion) {
      case "h": this.repeat(() => this.em("moveCursor", 0, -1), count); break;
      case "j": this.em("moveCursor", count, 0); break;
      case "k": this.em("moveCursor", -count, 0); break;
      case "l": this.repeat(() => this.em("moveCursor", 0, 1), count); break;
      case "w": this.repeat(() => this.em("moveWordForwards"), count); break;
      case "b": this.repeat(() => this.em("moveWordBackwards"), count); break;
      case "e": this.repeat(() => {
        const line = s.lines[s.cursorLine] ?? "";
        const col = findWordEnd(line, s.cursorCol);
        s.cursorCol = col;
      }, count); break;
      case "ge": this.repeat(() => {
        this.em("moveWordBackwards");
        const line = s.lines[s.cursorLine] ?? "";
        s.cursorCol = findWordEnd(line, s.cursorCol);
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
        this.countBuffer = "";
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
    if (matchesKey(data, "ctrl+r")) return;

    if (/^[1-9]$/.test(data)) { this.countBuffer += data; return; }
    if (data === "0" && this.countBuffer.length > 0) { this.countBuffer += data; return; }

    const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
    this.countBuffer = "";

    if (this.pendingOp) {
      if (this.pendingOp.type === "g") {
        this.handleGPrefix(data, count);
        return;
      }
      this.handlePendingOperator(data, count);
      return;
    }

    const s = this.st;
    switch (data) {
      case "h": case "j": case "k": case "l":
      case "w": case "b": case "e":
      case "0": case "$": case "^":
      case "{": case "}":
        this.applyMotion(data, data === "0" || data === "$" || data === "^" || data === "{" || data === "}" ? 1 : count);
        break;
      case "G": this.applyMotion("G", count); break;

      case "g": this.pendingOp = { type: "g", count }; return;
      case "d": case "y": case "c":
        this.pendingOp = { type: data as OperatorType, count }; return;

      case "x": {
        const line = s.lines[s.cursorLine] ?? "";
        const del = s.cursorCol < line.length ? line[s.cursorCol] : "\n";
        for (let i = 0; i < count; i++) this.em("handleForwardDelete");
        setYank(del.repeat(count), "char");
        recordOp({ kind: "delete-char", count });
        break;
      }
      case "X": {
        const col = s.cursorCol;
        const deleted = col > 0 ? (s.lines[s.cursorLine] ?? "").slice(Math.max(0, col - count), col) : "";
        for (let i = 0; i < count; i++) this.em("handleBackspace");
        if (deleted) setYank(deleted, "char");
        recordOp({ kind: "delete-char", count });
        break;
      }
      case "K": {
        this.onKeybindingsRequest?.();
        break;
      }
      case "s": {
        const line = s.lines[s.cursorLine] ?? "";
        const del = s.cursorCol < line.length ? line[s.cursorCol] : "";
        this.em("handleForwardDelete");
        setYank(del, "char");
        recordOp({ kind: "delete-char", count: 1 });
        this.mode = "insert";
        break;
      }
      case "S": {
        const text = deleteLines(this.edState, 1);
        setYank(text, "line");
        recordOp({ kind: "change-line", count: 1 });
        this.mode = "insert";
        break;
      }
      case "D": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        if (count > 1) {
          const end = Math.min(s.cursorLine + count, s.lines.length);
          const extra = s.lines.slice(s.cursorLine + 1, end).join("\n");
          setYank(extra ? deleted + "\n" + extra : deleted, "char");
          s.lines.splice(s.cursorLine + 1, end - s.cursorLine - 1);
          this.edState.pushUndoSnapshot?.();
          this.edState.onChange?.(s.lines.join("\n"));
          recordOp({ kind: "delete-motion", motion: "j", count: count - 1, text: extra });
        } else {
          setYank(deleted, "char");
          recordOp({ kind: "delete-motion", motion: "$", count: 1, text: deleted });
        }
        break;
      }
      case "C": {
        const line = s.lines[s.cursorLine] ?? "";
        const deleted = line.slice(s.cursorCol);
        this.em("deleteToEndOfLine");
        if (count > 1) {
          const end = Math.min(s.cursorLine + count, s.lines.length);
          const extra = s.lines.slice(s.cursorLine + 1, end).join("\n");
          setYank(extra ? deleted + "\n" + extra : deleted, "char");
          s.lines.splice(s.cursorLine + 1, end - s.cursorLine - 1);
          this.edState.pushUndoSnapshot?.();
          this.edState.onChange?.(s.lines.join("\n"));
        } else {
          setYank(deleted, "char");
        }
        recordOp({ kind: "change-motion", motion: "$", count, text: deleted });
        this.mode = "insert";
        break;
      }
      case "Y": {
        const end = Math.min(s.cursorLine + count, s.lines.length);
        const text = s.lines.slice(s.cursorLine, end).join("\n");
        setYank(text, "line");
        recordOp({ kind: "yank-line", count });
        break;
      }
      case "p": { pasteAfter(this.edState, count); recordOp({ kind: "paste", count }); break; }
      case "P": { pasteBefore(this.edState, count); recordOp({ kind: "paste-before", count }); break; }
      case "u": this.em("undo"); break;
      case ".": {
        const result = replayLastOp(this.edState, { applyMotion: (m, c) => this.applyMotion(m, c), st: this.st });
        if (result === "insert") this.mode = "insert";
        if (result === "inplace") {
          const op = getLastOp();
          for (let i = 0; i < (op?.count ?? 1); i++) this.em("handleForwardDelete");
        }
        break;
      }

      case "i": this.mode = "insert"; break;
      case "a": { this.em("moveCursor", 0, 1); this.mode = "insert"; break; }
      case "I": { s.cursorCol = firstNonBlankCol(s.lines[s.cursorLine] ?? ""); this.mode = "insert"; break; }
      case "A": { this.em("moveToLineEnd"); this.mode = "insert"; break; }
      case "o": { this.em("moveToLineEnd"); this.em("addNewLine"); this.mode = "insert"; break; }
      case "O": {
        if (s.cursorLine > 0) {
          s.cursorCol = 0; this.em("addNewLine"); s.cursorLine = s.cursorLine - 1;
        } else {
          s.cursorCol = 0; this.em("addNewLine"); s.cursorLine = 0;
        }
        this.mode = "insert";
        break;
      }

      case "v": {
        this.visualStart = { line: s.cursorLine, col: s.cursorCol };
        this.visualType = "char"; this.mode = "visual"; break;
      }
      case "V": {
        this.visualStart = { line: s.cursorLine, col: 0 };
        this.visualType = "line"; this.mode = "visual"; break;
      }

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

  // ---- Operator pending handler ----
  private handlePendingOperator(data: string, count: number) {
    const op = this.pendingOp!.type as OperatorType;
    const opCount = this.pendingOp!.count * count;
    const s = this.st;

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

    const motions = ["h","j","k","l","w","b","e","0","$","^","gg","G","{","}","g_"];
    if (!motions.includes(data)) {
      this.pendingOp = null;
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }

    this.pendingOp = null;
    const range = motionRange(data, opCount, s.cursorLine, s.cursorCol, { applyMotion: (m, c) => this.applyMotion(m, c), st: this.st });
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
    if (this.visualPendingGPrefix) {
      this.visualPendingGPrefix = false;
      if (data === "g") { this.applyMotion("gg", 1); this.countBuffer = ""; return; }
      if (data === "_") { this.applyMotion("g_", 1); this.countBuffer = ""; return; }
      if (data === "e") { this.applyMotion("ge", 1); this.countBuffer = ""; return; }
      this.countBuffer = "";
    }
    if (data === "g") { this.visualPendingGPrefix = true; return; }

    const motions = ["h","j","k","l","w","b","e","0","$","^","G","{","}"];
    if (motions.includes(data)) {
      this.applyMotion(data, this.countBuffer ? parseInt(this.countBuffer, 10) : 1);
      this.countBuffer = "";
      return;
    }

    if (/^[1-9]$/.test(data)) { this.countBuffer += data; return; }
    if (data === "0" && this.countBuffer.length > 0) { this.countBuffer += data; return; }
    this.countBuffer = "";

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

    const deleteVisualSelection = (insertMode = false) => {
      const text = selText();
      setYank(text, this.visualType);
      copyToClipboard(text).catch(() => {});
      const opKind = insertMode ? "change-visual" : "delete-visual";
      recordOp({ kind: opKind, visualType: this.visualType, text });

      if (this.visualType === "line") {
        const [ls, le] = sL <= eL ? [sL, eL] : [eL, sL];
        const nl = [...this.st.lines.slice(0, ls), ...this.st.lines.slice(le + 1)];
        this.st.lines = nl.length === 0 ? [""] : nl;
        this.st.cursorLine = Math.min(ls, this.st.lines.length - 1);
        this.st.cursorCol = 0;
        this.edState.pushUndoSnapshot?.();
        this.edState.onChange?.(this.st.lines.join("\n"));
      } else {
        const [sl, sc, el, ec] = sL <= eL ? [sL, sC, eL, eC] : [eL, eC, sL, sC];
        deleteRange(this.edState, sl, sc, el, ec);
      }
      this.mode = insertMode ? "insert" : "normal";
      this.visualStart = null;
    };

    switch (data) {
      case "d": case "x": deleteVisualSelection(); break;
      case "y": {
        const text = selText();
        setYank(text, this.visualType);
        copyToClipboard(text).catch(() => {});
        recordOp({ kind: "yank-visual", visualType: this.visualType, text });
        this.mode = "normal";
        this.visualStart = null;
        break;
      }
      case "c": deleteVisualSelection(true); break;
      case "v": this.visualType = "char"; break;
      case "V": this.visualType = "line"; break;
      default:
        if (data.length === 1 && data.charCodeAt(0) >= 32) return;
        super.handleInput(data);
    }
  }

  // ---- Render override for visual selection highlighting ----
  render(width: number): string[] {
    if (this.mode !== "visual" || !this.visualStart) {
      return super.render(width);
    }

    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min((this as any).paddingX, maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    (this as any).lastWidth = layoutWidth;

    const horizontal = this.borderColor("─");
    const layoutLines: any[] = (this as any).layoutText(layoutWidth);

    // Compute visual selection ranges per logical line
    const s = this.st;
    const selA = { line: this.visualStart.line, col: this.visualStart.col };
    const selB = { line: s.cursorLine, col: s.cursorCol };
    const isForward = selA.line < selB.line || (selA.line === selB.line && selA.col <= selB.col);
    const selStartLine = isForward ? selA.line : selB.line;
    const selStartCol = isForward ? selA.col : selB.col;
    const selEndLine = isForward ? selB.line : selA.line;
    const selEndCol = isForward ? selB.col : selA.col;

    // Track byte offset into each logical line to map layout chunks → selection position
    let logicalIdx = 0;
    let byteOffset = 0;

    for (let li = 0; li < layoutLines.length; li++) {
      const ll = layoutLines[li];
      if (!ll || !ll.text) continue;

      const logicalLen = s.lines[logicalIdx]?.length ?? 0;
      const chunkText = ll.text;
      const chunkLen = chunkText.length;

      // Does this logical line overlap the selection?
      if (logicalIdx >= selStartLine && logicalIdx <= selEndLine) {
        const lineSelStart = logicalIdx === selStartLine ? selStartCol : 0;
        const lineSelEnd = logicalIdx === selEndLine ? selEndCol : logicalLen;

        // Where does this layout chunk overlap the selection?
        const chunkStart = byteOffset;
        const chunkEnd = byteOffset + chunkLen;
        const overlapStart = Math.max(lineSelStart, chunkStart);
        const overlapEnd = Math.min(lineSelEnd, chunkEnd);

        if (overlapStart < overlapEnd && overlapStart < chunkEnd) {
          const localStart = Math.max(0, overlapStart - chunkStart);
          const localEnd = Math.min(chunkLen, overlapEnd - chunkStart);

          if (localStart < localEnd && localStart < chunkLen) {
            const before = chunkText.slice(0, localStart);
            const selected = chunkText.slice(localStart, localEnd);
            const after = chunkText.slice(localEnd);
            ll.text = `${before}\x1b[7m${selected}\x1b[0m${after}`;

            // Adjust cursor position for added ANSI bytes
            if (ll.hasCursor && ll.cursorPos !== undefined && ll.cursorPos > localStart) {
              ll.cursorPos += "\x1b[7m".length + "\x1b[0m".length;
            }
          }
        }
      }

      byteOffset += chunkLen;
      // Move to next logical line when we've consumed all its bytes
      if (byteOffset >= logicalLen && li + 1 < layoutLines.length) {
        logicalIdx++;
        byteOffset = 0;
      }
    }

    // ---- Scroll offset (same as base Editor) ----
    const terminalRows = this.tui.terminal.rows;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    let cursorLineIndex = layoutLines.findIndex((l: any) => l.hasCursor);
    if (cursorLineIndex === -1) cursorLineIndex = 0;

    if (cursorLineIndex < (this as any).scrollOffset) {
      (this as any).scrollOffset = cursorLineIndex;
    } else if (cursorLineIndex >= (this as any).scrollOffset + maxVisibleLines) {
      (this as any).scrollOffset = cursorLineIndex - maxVisibleLines + 1;
    }
    const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
    (this as any).scrollOffset = Math.max(0, Math.min((this as any).scrollOffset, maxScrollOffset));

    const visibleLines = layoutLines.slice((this as any).scrollOffset, (this as any).scrollOffset + maxVisibleLines);
    const result: string[] = [];
    const leftPadding = " ".repeat(paddingX);
    const rightPadding = leftPadding;

    // ---- Top border ----
    if ((this as any).scrollOffset > 0) {
      const indicator = `─── ↑ ${(this as any).scrollOffset} more `;
      const remaining = width - visibleWidth(indicator);
      if (remaining >= 0) {
        result.push(truncateToWidth(this.borderColor(indicator + "─".repeat(remaining)), width));
      } else {
        result.push(truncateToWidth(this.borderColor(indicator), width));
      }
    } else {
      result.push(truncateToWidth(horizontal.repeat(width), width));
    }

    // ---- Text lines with cursor ----
    const emitCursorMarker = this.focused;
    for (const layoutLine of visibleLines) {
      let displayText = layoutLine.text;
      let lineVisibleWidth = visibleWidth(layoutLine.text);
      let cursorInPadding = false;

      if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
        const before = displayText.slice(0, layoutLine.cursorPos);
        const after = displayText.slice(layoutLine.cursorPos);
        const marker = emitCursorMarker ? CURSOR_MARKER : "";
        if (after.length > 0) {
          const afterGraphemes = [...(this as any).segment(after, "grapheme")];
          const firstGrapheme = afterGraphemes[0]?.segment || "";
          const restAfter = after.slice(firstGrapheme.length);
          const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
          displayText = before + marker + cursor + restAfter;
        } else {
          const cursor = "\x1b[7m \x1b[0m";
          displayText = before + marker + cursor;
          lineVisibleWidth = lineVisibleWidth + 1;
          if (lineVisibleWidth > contentWidth && paddingX > 0) {
            cursorInPadding = true;
          }
        }
      }

      const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));
      const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;
      result.push(truncateToWidth(`${leftPadding}${displayText}${padding}${lineRightPadding}`, width));
    }

    // ---- Bottom border ----
    const linesBelow = layoutLines.length - ((this as any).scrollOffset + visibleLines.length);
    if (linesBelow > 0) {
      const indicator = `─── ↓ ${linesBelow} more `;
      const remaining = width - visibleWidth(indicator);
      result.push(truncateToWidth(this.borderColor(indicator + "─".repeat(Math.max(0, remaining))), width));
    } else {
      result.push(truncateToWidth(horizontal.repeat(width), width));
    }

    // ---- Autocomplete ----
    if ((this as any).autocompleteState && (this as any).autocompleteList) {
      const autocompleteResult = (this as any).autocompleteList.render(contentWidth);
      for (const line of autocompleteResult) {
        const lineWidth = visibleWidth(line);
        const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));
        result.push(truncateToWidth(`${leftPadding}${line}${linePadding}${rightPadding}`, width));
      }
    }

    return result;
  }
}
