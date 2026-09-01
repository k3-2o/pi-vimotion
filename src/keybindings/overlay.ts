import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SECTIONS } from "./content.ts";
import { drawOverlay, FALLBACK_ROWS } from "./layout.ts";

/**
 * Interactive pi-vim keybinding reference. Owns input until dismissed
 * (q / Esc / Ctrl+C), re-renders on every keystroke, and colors from the
 * live Theme. State is just the selected section; drawing lives in
 * layout.ts, content in content.ts.
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
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data.toLowerCase() === "q"
    ) {
      this.done(null);
      return;
    }

    const key = data.toLowerCase();
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

    if (matchesKey(data, Key.left) || key === "h" || key === "k") prev();
    if (matchesKey(data, Key.right) || key === "l" || key === "j") next();

    const n = Number(key);
    if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length) {
      this.section = n - 1;
      this.invalidate();
      this.tui.requestRender();
    }

    // Unknown keys are ignored — the overlay keeps owning the screen until
    // one of the close keys is pressed.
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

    const lines = drawOverlay({
      width,
      termRows,
      sections: SECTIONS,
      selected: this.section,
      palette: this.theme,
    });

    this.cachedWidth = width;
    this.cachedRows = termRows;
    this.cachedSection = this.section;
    this.cachedTheme = this.theme;
    this.cachedLines = lines;
    return lines;
  }
}
