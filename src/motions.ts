/**
 * Pure motion helpers — no editor state dependency.
 */

/** Word characters: alphanumeric and underscore. */
export function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined || ch === "") return false;
  return /[a-zA-Z0-9_]/.test(ch);
}

/** Non-whitespace check (for WORD objects). */
export function isNonWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && !/\s/.test(ch);
}

/** Find position of the last char of the word at or after fromCol.
 *  For vim `e`: pass cursorCol + 1 so the cursor advances. */
export function findWordEnd(line: string, fromCol: number): number {
  let col = fromCol;
  while (col < line.length && !isWordChar(line[col])) col++;
  if (col >= line.length) return fromCol; // no word end — stay put
  while (col < line.length && isWordChar(line[col])) col++;
  return col - 1;
}

/** Column of first non-whitespace on line. Returns 0 if all blank. */
export function firstNonBlankCol(line: string): number {
  const col = line.search(/\S/);
  return col >= 0 ? col : 0;
}
