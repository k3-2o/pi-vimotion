# pi-vim

Modal vim editing for [pi](https://pi.dev)'s prompt box.

Turn your pi input into a vim editor — motions, operators, visual mode,
dot-repeat, count prefixes, and system clipboard integration. Press `K` in normal mode to see all available keys.

https://github.com/k3-2o/pi-vim

## Install

### Manual (clone into extensions)

```bash
git clone https://github.com/k3-2o/pi-vim.git ~/.pi/agent/extensions/pi-vim
```

Then `/reload` in pi.

### Via pi package manager

```bash
pi install pi-vim
```

(Requires the package to be published — coming soon.)

## Quick Start

| What               | How                                    |
|--------------------|----------------------------------------|
| Enter normal mode  | `escape`                               |
| Enter insert mode  | `i` / `a` / `I` / `A` / `o` / `O` / `s` / `S` |
| Enter visual mode  | `v` (character) or `V` (line)          |
| Back to normal     | `escape` (from insert or visual)       |
| Show keybindings   | `K` in normal mode                       |
| Repeat last op     | `.`                                    |
| Undo               | `u`                                    |

## Features

### Motions

| Keys | Action |
|------|--------|
| `h` / `j` / `k` / `l` | Left / Down / Up / Right |
| `w` / `b` / `e` / `ge` | Word forward / backward / word end / word end backward |
| `0` / `$` / `^` / `g_` | Line start / line end / first non-blank / last non-blank |
| `gg` / `G` / `{N}G` | First line / last line / go to line N |
| `{` / `}` | Paragraph backward / forward |

Prefix any motion with a number to repeat, e.g. `3j` = down 3 lines, `d2w` = delete 2 words.

### Operators

| Keys | Action |
|------|--------|
| `d` + motion | Delete from cursor through motion |
| `y` + motion | Yank (copy) from cursor through motion |
| `c` + motion | Change (delete + insert mode) through motion |
| `dd` / `yy` / `cc` | Delete / yank / change whole line |
| `D` / `C` / `Y` | Delete / change / yank to end of line(s) |
| `p` / `P` | Paste after / before cursor |

Operators respect count: `3Y` yanks 3 lines, `3D` / `3C` deletes / changes 3 lines down.

### Visual Mode

| Keys | Action |
|------|--------|
| `v` | Visual character mode — select individual characters |
| `V` (Shift+v) | Visual line mode — select whole lines |
| `v` / `V` (toggle) | Switch between char and line selection while in visual mode |
| `d` / `x` | Delete (cut) the selection |
| `y` | Yank (copy) the selection — also goes to system clipboard |
| `c` | Change (delete + enter insert mode) |
| `escape` | Cancel visual selection |

### Insert Mode

All standard pi keybindings work in insert mode (`ctrl+w` delete word,
`ctrl+k` kill line, etc.).

| Keys | Action |
|------|--------|
| `i` / `a` | Insert before / after cursor |
| `I` / `A` | Insert at line start / append at line end |
| `o` / `O` | Open new line below / above |
| `s` / `S` | Substitute character / substitute line |

### Editing

| Keys | Action |
|------|--------|
| `x` / `X` | Delete character forward / backward |
| `u` | Undo |
| `.` | Repeat last operation |
| `g` prefix | `gg` (goto top), `g_` (last non-blank), `ge` (word end backward) |
| `K` | Show this keybinding reference overlay |
| `escape` | Back to normal mode / cancel operation |

## Tips

- **Count prefix** — type a number before any motion or operator: `3j` (down 3),
  `d2w` (delete 2 words), `5yy` (yank 5 lines)
- **`Y`/`D`/`C` respect counts** — `3Y` yanks 3 lines, `3D` deletes 3 lines down
- **Visual line mode** — `V` then `j`/`k` selects whole lines; `d` deletes them,
  `y` yanks them to clipboard
- **System clipboard** — yanked text is copied to your system clipboard. Paste
  outside pi with `ctrl+v` / `cmd+v`.
- **Operators in visual mode** — after selecting with `v`/`V`, use `d`/`y`/`c`
  to operate on the selection. Motions like `w`/`b`/`$` work too.

## Status Indicator

Pi-vim shows your current mode in the footer:

| Mode | Indicator |
|------|-----------|
| Normal | `vim: normal` (accent color) |
| Visual (char) | `vim: visual` (warning color) |
| Visual (line) | `vim: V-LINE` (warning color) |
| Insert | `vim: insert` (success color) |

## Files

```
pi-vim/
├── index.ts            — Extension entry point, wires everything together
├── README.md
├── package.json
└── src/
    ├── editor.ts       — PiVimEditor: handles key dispatch, modes, visual ops
    ├── keybindings.ts  — Keybinding reference data + markdown overlay component
    ├── motions.ts      — Cursor motion helpers (word, paragraph, etc.)
    ├── ops.ts          — Text operations (delete, yank, change, paste, undo, repeat)
    └── types.ts        — Shared types (VimMode, VisualType, ReplayOp)
```

## License

MIT
