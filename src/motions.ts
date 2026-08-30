import type { FindKind } from "./types.ts";

export function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined || ch === "") return false;
  return /[a-zA-Z0-9_]/.test(ch);
}

export function isNonWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && !/\s/.test(ch);
}

/** Find position of the last char of the word at or after fromCol.
 *  Returns -1 if there is no word end at or after fromCol.
 *  For vim `e`: pass cursorCol + 1 so the cursor advances. */
export function findWordEnd(line: string, fromCol: number): number {
  let col = fromCol;
  while (col < line.length && !isWordChar(line[col])) col++;
  if (col >= line.length) return -1; // no word end — caller keeps the cursor put
  while (col < line.length && isWordChar(line[col])) col++;
  return col - 1;
}

/** Returns 0 if the line is all whitespace. */
export function firstNonBlankCol(line: string): number {
  const col = line.search(/\S/);
  return col >= 0 ? col : 0;
}

/** Find target column for f/t/F/T. Returns -1 if not found on line. */
export function findCharOnLine(line: string, fromCol: number, ch: string, kind: FindKind): number {
  switch (kind) {
    case "f": // next occurrence of ch after cursor
      for (let i = fromCol + 1; i < line.length; i++) if (line[i] === ch) return i;
      return -1;
    case "F": // previous occurrence of ch before cursor
      for (let i = fromCol - 1; i >= 0; i--) if (line[i] === ch) return i;
      return -1;
    case "t": // position just before next ch
      for (let i = fromCol + 1; i < line.length; i++) if (line[i] === ch) return i - 1;
      return -1;
    case "T": // position just after previous ch
      for (let i = fromCol - 1; i >= 0; i--) if (line[i] === ch) return i + 1;
      return -1;
  }
}

export function reverseFind(kind: FindKind): FindKind {
  return kind === "f" ? "F" : kind === "F" ? "f" : kind === "t" ? "T" : "t";
}
