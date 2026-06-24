/**
 * Pure motion helpers — no editor state dependency.
 * These operate on raw strings and arrays.
 */

/** Words chars include alphanumeric and underscore */
export function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined || ch === "") return false;
  return /[a-zA-Z0-9_]/.test(ch);
}

/** Find end of current word from col. Skips whitespace then word chars. */
export function findWordEnd(line: string, fromCol: number): number {
  let col = fromCol;
  while (col < line.length && !isWordChar(line[col])) col++;
  while (col < line.length && isWordChar(line[col])) col++;
  return Math.max(fromCol, col);
}

/** Find the line index of the previous paragraph (blank-line boundary). */
export function findPrevParagraph(lines: string[], fromLine: number): number {
  let line = Math.max(0, fromLine - 1);
  while (line > 0) {
    if ((lines[line] ?? "").trim() === "" && line < fromLine - 1) break;
    if ((lines[line - 1] ?? "").trim() === "") break;
    line--;
  }
  return Math.max(0, line);
}

/** Find the line index of the next paragraph (blank-line boundary). */
export function findNextParagraph(lines: string[], fromLine: number): number {
  let line = fromLine + 1;
  const max = lines.length - 1;
  while (line <= max) {
    if ((lines[line] ?? "").trim() === "") break;
    line++;
  }
  return Math.min(max, line);
}

/** Column of first non-whitespace on line. Returns 0 if none. */
export function firstNonBlankCol(line: string): number {
  const col = line.search(/\S/);
  return col >= 0 ? col : 0;
}

/** Column of last non-whitespace on line. Returns line length if none. */
export function lastNonBlankCol(line: string): number {
  const col = line.search(/\S\s*$/);
  return col >= 0 ? col + 1 : line.length;
}
