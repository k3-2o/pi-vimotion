/** Editor mode. Vim starts in Normal; i/a/o… enter Insert, Esc returns. */
export type VimMode = "normal" | "insert";

export type VimOperator = "delete" | "yank" | "change";

/** Text object scope: inner (i) excludes delimiters, around (a) includes them. */
export type TextObjectScope = "inner" | "around";

/** Find/till char direction. f/F land on the char; t/T land adjacent to it. */
export type FindKind = "f" | "t" | "F" | "T";

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

/** Last find motion, for ; and , to repeat/reverse. */
export type LastFind = { find: FindKind; char: string };

/** Yanked text with register type (char vs linewise) controlling paste direction. */
export type YankedText = {
  text: string;
  type: "char" | "line";
};
