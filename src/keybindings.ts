import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

interface BindingRow {
  keys: string;
  action: string;
}

interface Section {
  title: string;
  description: string;
  rows: BindingRow[];
  notes?: string[];
}

const SECTIONS: Section[] = [
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

const FALLBACK_ROWS = 24; // tui.terminal.rows is 0 on non-TTY; keep something sane

/**
 * Interactive pi-vim keybinding reference. A stateful component that owns
 * input until done(), re-renders on every keystroke, and colors everything
 * from the live Theme so it matches the rest of pi.
 */
export class KeybindingsComponent implements Component {
  private section = 0;
  private cachedWidth?: number;
  private cachedRows?: number;
  private cachedSection?: number;
  private cachedTheme?: Theme;
  private cachedLines?: string[];

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: (value: null) => void;

  constructor(tui: TUI, theme: Theme, done: (value: null) => void) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedRows = undefined;
    this.cachedSection = undefined;
    this.cachedTheme = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    // Close: q / Esc / Ctrl+C — the same dismiss set session-breakdown uses.
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data.toLowerCase() === "q"
    ) {
      this.done(null);
      return;
    }

    const ls = data.toLowerCase();
    const prev = () => {
      this.section = (this.section + SECTIONS.length - 1) % SECTIONS.length;
      this.invalidate();
      this.tui.requestRender();
    };
    const next = () => {
      this.section = (this.section + 1) % SECTIONS.length;
      this.invalidate();
      this.tui.requestRender();
    };

    if (matchesKey(data, Key.left) || ls === "h" || ls === "k") prev();
    if (matchesKey(data, Key.right) || ls === "l" || ls === "j") next();

    const n = Number(ls);
    if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length) {
      this.section = n - 1;
      this.invalidate();
      this.tui.requestRender();
    }

    // Unknown keys are ignored — the reference keeps owning the screen
    // until one of the close keys is pressed.
  }

  render(width: number): string[] {
    const termRows = this.tui.terminal?.rows || FALLBACK_ROWS;
    if (
      this.cachedWidth === width &&
      this.cachedRows === termRows &&
      this.cachedSection === this.section &&
      this.cachedTheme === this.theme &&
      this.cachedLines
    ) {
      return this.cachedLines;
    }

    const th = this.theme;
    const s = SECTIONS[this.section] ?? SECTIONS[0]!;
    const keysCol = Math.max(0, ...s.rows.map((r) => r.keys.length));
    const tableRow = (r: BindingRow) =>
      truncateToWidth(
        ` ${th.fg("accent", r.keys.padEnd(keysCol))}  ${th.fg("border", "│")}  ${r.action}`,
        width,
      );

    // Fixed chrome around the table: top rule, blank, title, tabs,
    // description, blank, column header, divider (8 above) + blank,
    // footer, bottom rule (3 below). Section notes count extra.
    const fixed = 11;
    const notes = s.notes ?? [];
    const availRows = Math.max(0, termRows - fixed - notes.length);
    const hidden = Math.max(0, s.rows.length - availRows);
    // Reserve one row for the "…N more" hint when rows are cut off.
    const rowsShown = hidden > 0 ? Math.max(0, availRows - 1) : s.rows.length;

    const lines: string[] = [];
    const rule = th.fg("border", "─".repeat(Math.max(1, width)));
    lines.push(rule);
    lines.push("");
    lines.push(
      truncateToWidth(th.bold(th.fg("accent", "pi-vim keybindings")), width),
    );

    // Section tabs — selected one gets the select-list highlight chip.
    const tabs = SECTIONS.map((sec, i) =>
      i === this.section
        ? th.bg("selectedBg", th.fg("accent", ` ${i + 1} ${sec.title} `))
        : th.fg("muted", ` ${i + 1} ${sec.title} `),
    ).join(" ");
    lines.push(truncateToWidth(tabs, width));
    lines.push(truncateToWidth(th.italic(th.fg("muted", s.description)), width));
    lines.push("");

    lines.push(
      truncateToWidth(
        ` ${th.fg("muted", "keys".padEnd(keysCol))}  ${th.fg("border", "│")}  ${th.fg("muted", "action")}`,
        width,
      ),
    );
    lines.push(
      truncateToWidth(
        th.fg("border", ` ${"─".repeat(keysCol)}──┼──${"─".repeat(Math.max(0, width - keysCol - 6))}`),
        width,
      ),
    );
    for (const r of s.rows.slice(0, rowsShown)) lines.push(tableRow(r));
    if (hidden > 0) {
      lines.push(truncateToWidth(th.fg("warning", ` …${hidden} more rows`), width));
    }
    for (const note of notes) {
      lines.push(truncateToWidth(th.fg("muted", ` ${note}`), width));
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        ` ${th.fg("accent", "j/k")}${th.fg("muted", " or arrows browse  ·  ")}${th.fg("accent", "1–6")}${th.fg("muted", " jump  ·  ")}${th.fg("accent", "q")}${th.fg("muted", " / ")}${th.fg("accent", "Esc")}${th.fg("muted", " close")}`,
        width,
      ),
    );
    lines.push(rule);

    this.cachedWidth = width;
    this.cachedRows = termRows;
    this.cachedSection = this.section;
    this.cachedTheme = this.theme;
    this.cachedLines = lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l));
    return this.cachedLines;
  }
}
