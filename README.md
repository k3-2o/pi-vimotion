# pi-vim

Modal vim editing for pi's prompt box. Drop in `~/.pi/agent/extensions/`, `/reload`, done.

## What works

`escape` toggles between INSERT (type normally, all pi keys work) and NORMAL (vim stuff). `v`/`V` for VISUAL mode.

h/j/k/l — cursor · w/b/e — words · 0/$/^/g_ — line boundaries · gg/G — top/bottom · {/} — paragraph jumps. All with N prefix (3j, 5w).

d/c/y + any motion — delete/change/yank. dd/yy/cc — line ops. x/X/s/S — char ops. p/P — paste. u — undo. . — repeat.

i/a/I/A — insert/append. o/O — new line below/above.

Mode shows in the footer, hides after a few seconds.

## Files

```
index.ts    entry point
src/
  editor.ts   the editor class
  motions.ts  word/paragraph helpers
  ops.ts      delete, paste, repeat logic
  types.ts    shared types
```
