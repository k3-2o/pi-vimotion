/**
 * The keybinding reference content — single source of truth for what the
 * overlay shows. Deliberately data-only: presentation lives in layout.ts.
 */
export interface BindingRow {
  readonly keys: string;
  readonly action: string;
}

export interface ReferenceSection {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly BindingRow[];
  readonly notes?: readonly string[];
}

export const SECTIONS: readonly ReferenceSection[] = [
  {
    title: "Motions",
    description: "Cursor movement and jumps",
    rows: [
      { keys: "h j k l", action: "Left / Down / Up / Right" },
      { keys: "w b e", action: "Next word start / prev word start / word end" },
      { keys: "0 $", action: "Line start / line end" },
      { keys: "^", action: "First non-blank char" },
      { keys: "f F", action: "Find next / prev char (e.g. f()" },
      { keys: "t T", action: "Till before next / after prev char" },
      { keys: "; ,", action: "Repeat last find / repeat reversed" },
      { keys: "gg G", action: "First line / last line" },
    ],
  },
  {
    title: "Operators",
    description: "d / y / c then a motion, text object, find or jump",
    rows: [
      { keys: "d + motion", action: "Delete (e.g. dw, d$)" },
      { keys: "y + motion", action: "Yank (e.g. yw, y$)" },
      { keys: "c + motion", action: "Change — delete + insert (e.g. cw)" },
      { keys: "dd yy cc", action: "Delete / yank / change whole line" },
      { keys: "d + text object", action: "Delete inside/around (di(, ciw, daw)" },
      { keys: "d + find", action: "Delete up to a char (df,, ct()" },
      { keys: "d + jump", action: "Buffer-wide (dG, ygg)" },
    ],
    notes: ["Yanks (y, Y, yy) also copy to the system clipboard. Deletes stay internal."],
  },
  {
    title: "Text objects",
    description: "After an operator, i (inner) or a (around) then a symbol",
    rows: [
      { keys: "iw aw", action: "Inner word / a word (with trailing space)" },
      { keys: "i( a(", action: "Inside / around parentheses" },
      { keys: "i[ a[", action: "Inside / around brackets" },
      { keys: "i{ a{", action: "Inside / around braces" },
      { keys: "i\" a\"", action: "Inside / around double quotes" },
      { keys: "i\' a\'", action: "Inside / around single quotes" },
      { keys: "i` a`", action: "Inside / around backticks" },
    ],
    notes: ["Paired delimiters search the whole buffer; quotes are line-local."],
  },
  {
    title: "Edits",
    description: "Single-stroke edits, paste and undo",
    rows: [
      { keys: "x", action: "Delete char under cursor" },
      { keys: "X", action: "Delete char before cursor" },
      { keys: "s", action: "Delete char, enter insert" },
      { keys: "r{char}", action: "Replace char under cursor" },
      { keys: "D", action: "Delete to end of line" },
      { keys: "C", action: "Change to end of line" },
      { keys: "S", action: "Change whole line" },
      { keys: "Y", action: "Yank line" },
      { keys: "p P", action: "Paste after / before cursor" },
      { keys: "J", action: "Join next line" },
      { keys: "u", action: "Undo" },
    ],
  },
  {
    title: "Insert mode",
    description: "Enter insert mode from normal",
    rows: [
      { keys: "i a", action: "Insert before / after cursor" },
      { keys: "I A", action: "Insert at first non-blank / append at line end" },
      { keys: "o O", action: "Open line below / above" },
      { keys: "Esc", action: "Back to normal mode" },
      { keys: "Esc Esc", action: "Abort streaming from insert" },
    ],
  },
  {
    title: "Other",
    description: "Mode-level behavior",
    rows: [
      { keys: "K", action: "Show this reference" },
      { keys: "Esc", action: "Cancel pending operator" },
      { keys: "/vim", action: "Toggle vim mode off" },
    ],
    notes: ["Double Esc in insert aborts streaming; /vim or ctrl+; toggles the whole mode."],
  },
];
