import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SECTIONS } from "./content.ts";
import { drawOverlay, FALLBACK_ROWS } from "./layout.ts";

/** What a keystroke means to the overlay. Parsing is pure and owns the
 *  whole key grammar; effects (mutate, dismiss, re-render) live in the
 *  component. */
type Command =
  | { type: "close" }
  | { type: "cycle"; delta: 1 | -1 }
  | { type: "select"; index: number }
  | { type: "ignore" };

export function parseCommand(data: string, sectionCount: number): Command {
  // Dismiss set shared with session-breakdown's overlay: q, Esc, Ctrl+C.
  if (
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.ctrl("c")) ||
    data.toLowerCase() === "q"
  ) {
    return { type: "close" };
  }
  const key = data.toLowerCase();
  if (matchesKey(data, Key.left) || key === "h" || key === "k") return { type: "cycle", delta: -1 };
  if (matchesKey(data, Key.right) || key === "l" || key === "j") return { type: "cycle", delta: 1 };
  // Single-stroke digits only: multi-char escape sequences must never
  // parse as section jumps. NaN comparisons fail the range check for us.
  if (key.length === 1) {
    const n = Number(key);
    if (n >= 1 && n <= sectionCount) return { type: "select", index: n - 1 };
  }
  return { type: "ignore" };
}

interface CacheKey {
  width: number;
  rows: number;
  section: number;
  theme: Theme;
}

/**
 * Interactive pi-vim keybinding reference. Owns input until dismissed,
 * re-renders on every keystroke, and colors from the live Theme. Its only
 * state is the selected section; drawing lives in layout.ts, content in
 * content.ts.
 */
export class KeybindingsComponent implements Component {
  private section = 0;
  private cache?: { key: CacheKey; lines: string[] };

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: (value: null) => void;

  constructor(tui: TUI, theme: Theme, done: (value: null) => void) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  handleInput(data: string): void {
    const command = parseCommand(data, SECTIONS.length);
    if (command.type === "close") {
      this.done(null);
      return;
    }
    if (command.type === "ignore") return;
    if (command.type === "cycle") {
      const n = SECTIONS.length;
      this.setSection((this.section + command.delta + n) % n);
      return;
    }
    this.setSection(command.index);
  }

  /** The single mutation point: section stays in range by construction,
   *  no-op selections don't re-render, and the cache dies with the state. */
  private setSection(index: number): void {
    if (index === this.section) return;
    this.section = index;
    this.cache = undefined;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const rows = this.tui.terminal?.rows || FALLBACK_ROWS;
    const key: CacheKey = { width, rows, section: this.section, theme: this.theme };
    const { cache } = this;
    if (
      cache &&
      cache.key.width === key.width &&
      cache.key.rows === key.rows &&
      cache.key.section === key.section &&
      cache.key.theme === key.theme
    ) {
      return cache.lines;
    }
    const lines = drawOverlay({
      width,
      termRows: rows,
      sections: SECTIONS,
      selected: this.section,
      palette: this.theme,
    });
    this.cache = { key, lines };
    return lines;
  }
}
