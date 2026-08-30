import { CustomEditor, copyToClipboard } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import type { VimMode, VimOperator, VimPending, VimTextObject, TextObjectScope, FindKind } from "./types.ts";
import { firstNonBlankCol, findWordEnd, findCharOnLine, reverseFind } from "./motions.ts";
import {
  type EdState, textBetween,
  setYank, motionRange, deleteRange, deleteLines, pasteAfter, textObjectRange,
} from "./ops.ts";

// Motions that operators can target (also used standalone in normal mode)
const MOTIONS = ["h", "j", "k", "l", "w", "b", "e", "0", "$"] as const;
type Motion = (typeof MOTIONS)[number];

function isMotion(key: string): key is Motion {
  return (MOTIONS as readonly string[]).includes(key);
}

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

const FIND_KEYS = new Set(["f", "t", "F", "T"]);

export class PiVimEditor extends CustomEditor {
  mode: VimMode = "normal"; // enter in Normal; i/a/o… to start typing
  pending: VimPending = { type: "none" };
  lastFind: { find: FindKind; char: string } | null = null;

  onKeybindingsRequest?: () => void;

  /** The base editor's private state bag (pi doesn't expose it typed). */
  private get st() {
    return (this as any).state as { lines: string[]; cursorLine: number; cursorCol: number };
  }

  private em(name: string, ...args: unknown[]) {
    (this as any)[name](...args);
  }

/** EdState view over the base editor's state — ops.ts mutations land live in pi. */
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
      super.handleInput(data);
      return;
    }
    if (this.mode === "insert") { super.handleInput(data); return; }
    this.handleNormal(data);
  }

  private handleNormal(data: string): void {
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

    switch (data) {
      case "i": this.mode = "insert"; return;
      case "a":
        if (this.st.cursorCol < (this.st.lines[this.st.cursorLine] ?? "").length) this.em("moveCursor", 0, 1);
        this.mode = "insert";
        return;
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

    if (isMotion(data)) { this.applyMotion(data); return; }

    if (FIND_KEYS.has(data)) {
      this.pending = { type: "find", find: data as FindKind };
      return;
    }
    if (data === ";" || data === ",") { this.repeatFind(data === ","); return; }

    if (data === "G") { this.jumpLine(this.st.lines.length - 1, undefined); return; }
    if (data === "g") { this.pending = { type: "gpending" }; return; }

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
        this.recordYank(s.lines[s.cursorLine] ?? "", "line", "yank");
        return;
      }
      case "p": {
        pasteAfter(this.edState);
        return;
      }
    }

    if (data === "d" || data === "y" || data === "c") {
      this.pending = { type: "operator", operator: operatorOf(data) };
      return;
    }

    if (data === "K") { this.onKeybindingsRequest?.(); return; }
    if (data === "u") { this.em("undo"); return; }

    // Unrecognized printable: ignore; control keys fall through
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  private handleOperatorPending(op: VimOperator, data: string): void {
    // Repeat operator = whole line (dd, yy, cc)
    if (data === operatorKey(op)) {
      this.pending = { type: "none" };
      this.applyOperatorToLine(op);
      return;
    }
    // Cancel on anything that isn't a motion, i/a prefix, find/till, ;/, repeat, or g/G
    // (Esc never reaches here — handleInput clears pending state first)
    if (!isMotion(data) && data !== "i" && data !== "a" && !FIND_KEYS.has(data) && data !== ";" && data !== "," && data !== "g" && data !== "G") {
      this.pending = { type: "none" };
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }
    if (FIND_KEYS.has(data)) {
      this.pending = { type: "find", find: data as FindKind, operator: op };
      return;
    }
    if (data === ";" || data === ",") {
      this.pending = { type: "none" };
      if (this.lastFind) {
        const kind = data === "," ? reverseFind(this.lastFind.find) : this.lastFind.find;
        this.resolveFind(kind, this.lastFind.char, op);
      }
      return;
    }
    if (data === "G") {
      this.pending = { type: "none" };
      this.jumpLine(this.st.lines.length - 1, op);
      return;
    }
    if (data === "g") {
      this.pending = { type: "gpending", operator: op };
      return;
    }
    if (data === "i" || data === "a") {
      this.pending = { type: "textobject", operator: op, scope: data === "i" ? "inner" : "around" };
      return;
    }
    this.pending = { type: "none" };
    this.applyOperatorToMotion(op, data);
  }

  private handleFindPending(find: FindKind, op: VimOperator | undefined, data: string): void {
    this.pending = { type: "none" };
    if (data.length !== 1 || data.charCodeAt(0) < 32) {
      super.handleInput(data);
      return;
    }
    this.resolveFind(find, data, op);
  }

  private repeatFind(reverse: boolean) {
    if (!this.lastFind) return;
    const kind = reverse ? reverseFind(this.lastFind.find) : this.lastFind.find;
    this.resolveFind(kind, this.lastFind.char, undefined);
  }

  private resolveFind(find: FindKind, ch: string, op: VimOperator | undefined) {
    const s = this.st;
    const line = s.lines[s.cursorLine] ?? "";
    const target = findCharOnLine(line, s.cursorCol, ch, find);
    if (target < 0) return;
    // Zero-motion t/T (target char adjacent to the cursor) fails in vim:
    // abort instead of deleting/yanking the char under the cursor.
    if (target === s.cursorCol) return;
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

  private handleGpending(op: VimOperator | undefined, data: string): void {
    this.pending = { type: "none" };
    if (data === "g") {
      this.jumpLine(0, op);
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  private jumpLine(targetLine: number, op: VimOperator | undefined) {
    const s = this.st;
    const clamped = Math.max(0, Math.min(targetLine, s.lines.length - 1));

    if (op === undefined) {
      s.cursorLine = clamped;
      s.cursorCol = firstNonBlankCol(s.lines[clamped] ?? "");
      return;
    }

    const lo = Math.min(s.cursorLine, clamped);
    const count = Math.abs(clamped - s.cursorLine) + 1;
    this.recordYank(s.lines.slice(lo, lo + count).join("\n"), "line", op);
    if (op === "yank") return;
    s.cursorLine = lo;
    deleteLines(this.edState, count);
    if (op === "change") this.mode = "insert";
  }

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

  /** Record text in the vim register. Explicit yanks (`y`, `Y`) also mirror
   *  to the system clipboard; deletes stay internal so they don't clobber it. */
  private recordYank(text: string, type: "char" | "line", op: VimOperator) {
    setYank(text, type);
    if (op === "yank") void copyToClipboard(text).catch(() => {});
  }

  private applyOperatorToLine(op: VimOperator) {
    if (op === "yank") {
      this.recordYank(this.st.lines[this.st.cursorLine] ?? "", "line", op);
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
      if (target === s.cursorLine) return; // at buffer edge — no adjacent line, abort
      const lo = Math.min(s.cursorLine, target);
      const count = Math.abs(target - s.cursorLine) + 1;
      this.recordYank(s.lines.slice(lo, lo + count).join("\n"), "line", op);
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
    if (range.text === "") return; // motion didn't move — vim aborts the operator
    this.recordYank(range.text, "char", op);
    if (op === "yank") return;
    deleteRange(this.edState, range.startLine, range.startCol, range.endLine, range.endCol);
    if (op === "change") this.mode = "insert";
  }

  private applyOperatorToRange(op: VimOperator, sl: number, sc: number, el: number, ec: number) {
    const s = this.st;
    const range = sl === el && sc === ec
      ? { text: s.lines[sl]?.slice(sc, ec) ?? "" }
      : { text: textBetween(s.lines, sl, sc, el, ec) };
    this.recordYank(range.text, "char", op);
    if (op === "yank") return;
    deleteRange(this.edState, sl, sc, el, ec);
    if (op === "change") this.mode = "insert";
  }

  private applyMotion(motion: string, _count = 1): void {
    const s = this.st;
    switch (motion) {
      case "h": if (s.cursorCol > 0) this.em("moveCursor", 0, -1); break;
      case "j": this.em("moveCursor", 1, 0); break;
      case "k": this.em("moveCursor", -1, 0); break;
      case "l": if (s.cursorCol < (s.lines[s.cursorLine] ?? "").length) this.em("moveCursor", 0, 1); break;
      case "w": this.em("moveWordForwards"); break;
      case "b": this.em("moveWordBackwards"); break;
      case "e": {
        const line = s.lines[s.cursorLine] ?? "";
        const target = findWordEnd(line, s.cursorCol + 1);
        if (target >= 0) s.cursorCol = target; // -1 = no word end ahead: stay put
        break;
      }
      case "0": s.cursorCol = 0; break;
      case "$": this.em("moveToLineEnd"); break;
    }
  }
}

function operatorOf(key: string): VimOperator {
  return key === "d" ? "delete" : key === "y" ? "yank" : "change";
}

function operatorKey(op: VimOperator): string {
  return op === "delete" ? "d" : op === "yank" ? "y" : "c";
}
