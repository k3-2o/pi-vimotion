/**
 * Type definitions for pi-vim.
 *
 * Two modes only: Normal and Insert. No visual mode.
 * Operators compose with motions and text objects.
 */

/** Editor mode. Insert is the home/entry mode; Normal routes keys to motions/operators. */
export type VimMode = "normal" | "insert";

/** Operator-pending verbs. */
export type VimOperator = "delete" | "yank" | "change";

/** Text object scope: inner (i) excludes delimiters, around (a) includes them. */
export type TextObjectScope = "inner" | "around";

/** Find/till char direction. f/F land on the char; t/T land adjacent to it. */
export type FindKind = "f" | "t" | "F" | "T";

/** The operator state machine. */
export type VimPending =
  | { type: "none" }
  | { type: "operator"; operator: VimOperator }
  | { type: "textobject"; operator: VimOperator; scope: TextObjectScope }
  | { type: "find"; find: FindKind; operator?: VimOperator }
  | { type: "gpending"; operator?: VimOperator };

/** Text object targets selectable after i/a in operator-pending state. */
export type VimTextObject =
  | "word"        // iw / aw — small word (alphanumeric + underscore)
  | "bigWord"     // iW / aW — WORD (non-whitespace run)
  | "parens"      // i( / a( — ( ... )
  | "brackets"    // i[ / a[ — [ ... ]
  | "braces"      // i{ / a{ — { ... }
  | "doubleQuote" // i" / a"
  | "singleQuote" // i' / a'
  | "backtick";   // i` / a`

/** Yanked text with register type (char vs linewise) controlling paste direction. */
/** Last find motion, for ; and , to repeat/reverse. */
export type LastFind = { find: FindKind; char: string };

export type YankedText = {
  text: string;
  type: "char" | "line";
};
