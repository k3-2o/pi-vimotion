# pi-vim

Modal vim editing for [pi](https://pi.dev)'s prompt box.

## Install

```bash
git clone https://github.com/k3-2o/pi-vim.git ~/.pi/agent/extensions/pi-vim
```

Then `/reload` in pi.

## What You Get

| Mode   | How          | What                                     |
|--------|--------------|------------------------------------------|
| INSERT | Type normally | All pi keybindings work (ctrl+w, ctrl+k, etc.) |
| NORMAL | `escape`     | Vim motions & operators. `escape` again aborts. |
| VISUAL | `v` / `V`    | Select with motions, then `d`/`y`/`c`.  |

### Motions

`h`/`j`/`k`/`l` — cursor · `w`/`b`/`e` — words · `0`/`$` — line start/end  
`^`/`g_` — first/last non-whitespace · `gg`/`G` — buffer top/bottom  
`{`/`}` — paragraph jump · `N` prefix for count (`5j`, `3w`)

### Operators

`d` + motion — delete · `c` + motion — change (delete + insert)  
`y` + motion — yank · `dd`/`yy`/`cc` — line ops · `D`/`C`/`Y` — to end of line

### Other

`x`/`X` — delete char · `s`/`S` — substitute · `p`/`P` — paste  
`u` — undo · `.` — repeat · `i`/`a`/`I`/`A` — enter insert  
`o`/`O` — new line below/above · `v`/`V` — visual mode

Mode shows in the footer and auto-hides after 3s.

## Files

```
pi-vim/
├── index.ts    — extension entry
├── README.md
├── package.json
└── src/
    ├── editor.ts   — PiVimEditor class
    ├── motions.ts  — motion helpers
    ├── ops.ts      — text operations
    └── types.ts    — shared types
```
