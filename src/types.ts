/** Vim mode indicator */
export type VimMode = "normal" | "insert" | "visual";

/** Visual selection granularity */
export type VisualType = "char" | "line";

/** Pending operator type */
export type OperatorType = "d" | "y" | "c" | null;

/** Pending prefix type */
export type PrefixType = "g" | null;

/** Yanked text with mode info */
export type YankedText = {
  text: string;
  type: "char" | "line";
};

/** Replayable operation for dot-repeat */
export type ReplayOp = {
  kind: string;
  count?: number;
  motion?: string;
  text?: string;
  visualType?: VisualType;
};
