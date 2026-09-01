import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { BindingRow, ReferenceSection } from "./content.ts";

/**
 * Pure layout for the keybinding overlay: inputs in, styled lines out.
 * Palette is a structural type rather than pi's Theme so this module —
 * the testable core — stays free of framework imports; the real Theme
 * satisfies it as-is.
 */
type PaletteColor = "accent" | "border" | "muted" | "warning";

export interface Palette {
  fg(color: PaletteColor, text: string): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
  italic(text: string): string;
}

/** Frame lines around the table: 8 above (rule…divider) + 3 below
 *  (blank, footer help, rule). Section notes budget separately. */
export const CHROME_LINES = 11;

/** tui.terminal.rows reads 0 on some non-TTYs; render something sane there. */
export const FALLBACK_ROWS = 24;

export interface OverlayInput {
  width: number;
  termRows: number;
  sections: readonly ReferenceSection[];
  /** Index into sections — the overlay clamps it before calling. */
  selected: number;
  palette: Palette;
}

/** How many table rows fit, and how many get cut. The hint line reserves
 *  one row of budget, so "hidden" is total minus shown — it is what the
 *  "…N more rows" hint prints and must account for every cut row. */
export function paginate(
  totalRows: number,
  availableRows: number,
): { rowsShown: number; hidden: number } {
  const rowsShown = totalRows > availableRows ? Math.max(0, availableRows - 1) : totalRows;
  return { rowsShown, hidden: totalRows - rowsShown };
}

function tabStrip(sections: readonly ReferenceSection[], selected: number, th: Palette): string {
  return sections
    .map((sec, i) =>
      i === selected
        ? th.bg("selectedBg", th.fg("accent", ` ${i + 1} ${sec.title} `))
        : th.fg("muted", ` ${i + 1} ${sec.title} `),
    )
    .join(" ");
}

function tableHeader(keysCol: number, th: Palette): string {
  return ` ${th.fg("muted", "keys".padEnd(keysCol))}  ${th.fg("border", "│")}  ${th.fg("muted", "action")}`;
}

function dividerLine(keysCol: number, width: number, th: Palette): string {
  // space + key column + ── + ┼ + ── lands the ┼ under the │ separator
  return th.fg("border", ` ${"─".repeat(keysCol)}──┼──${"─".repeat(Math.max(0, width - keysCol - 6))}`);
}

function tableRow(row: BindingRow, keysCol: number, th: Palette): string {
  return ` ${th.fg("accent", row.keys.padEnd(keysCol))}  ${th.fg("border", "│")}  ${row.action}`;
}

function footerLine(th: Palette): string {
  return (
    ` ${th.fg("accent", "j/k")}${th.fg("muted", " or arrows browse  ·  ")}` +
    `${th.fg("accent", "1–6")}${th.fg("muted", " jump  ·  ")}` +
    `${th.fg("accent", "q")}${th.fg("muted", " / ")}${th.fg("accent", "Esc")}${th.fg("muted", " close")}`
  );
}

export function drawOverlay(input: OverlayInput): string[] {
  const { width, palette: th } = input;
  const s = input.sections[input.selected]!;
  const notes = s.notes ?? [];
  const keysCol = Math.max(0, ...s.rows.map((r) => r.keys.length));

  const availRows = Math.max(0, input.termRows - CHROME_LINES - notes.length);
  const { rowsShown, hidden } = paginate(s.rows.length, availRows);

  const rule = th.fg("border", "─".repeat(Math.max(1, width)));
  const lines: string[] = [];
  lines.push(rule);
  lines.push("");
  lines.push(truncateToWidth(th.bold(th.fg("accent", "pi-vim keybindings")), width));
  lines.push(truncateToWidth(tabStrip(input.sections, input.selected, th), width));
  lines.push(truncateToWidth(th.italic(th.fg("muted", s.description)), width));
  lines.push("");
  lines.push(truncateToWidth(tableHeader(keysCol, th), width));
  lines.push(truncateToWidth(dividerLine(keysCol, width, th), width));

  for (const row of s.rows.slice(0, rowsShown)) {
    lines.push(truncateToWidth(tableRow(row, keysCol, th), width));
  }
  if (hidden > 0) {
    lines.push(truncateToWidth(th.fg("warning", ` …${hidden} more rows`), width));
  }
  for (const note of notes) {
    lines.push(truncateToWidth(th.fg("muted", ` ${note}`), width));
  }

  lines.push("");
  lines.push(truncateToWidth(footerLine(th), width));
  lines.push(rule);

  // Last-pass width fit: composed ANSI lines can still overshoot.
  return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l));
}
