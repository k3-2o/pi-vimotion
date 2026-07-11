# pi-vim

Modal vim editing for [pi](https://pi.dev)'s prompt box.

Two modes, operators that compose with motions and text objects, find/till,
and buffer jumps. Vim mode is **off by default** — toggle it with `/vim`.

Press `K` in normal mode to see the full keybinding reference.

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

| What               | How                              |
|--------------------|----------------------------------|
| Turn vim on/off    | `/vim` (persists across sessions)|
| Enter normal mode  | `escape`                         |
| Enter insert mode  | `i` / `a` / `I` / `A` / `o` / `O`|
| Show keybindings   | `K` in normal mode               |
| Undo               | `u`                              |
| Abort streaming    | double-tap `escape` from insert  |

## Design

pi-vim is deliberately minimal. It mirrors the vim model used in
OpenAI Codex's composer: two modes (Normal + Insert), no visual mode,
no dot-repeat, no registers. Selection-style editing is handled by
operators + text objects instead.

The implementation layers on top of pi's built-in editor wherever
possible — many motions and single-stroke edits delegate to pi's own
commands. Only the genuinely vim-specific parts (operators composing
with motions, text objects, find/till, the yank register) are custom.

## Features

### Motions

| Keys | Action |
|------|--------|
| `h` `j` `k` `l` | Left / Down / Up / Right |
| `w` `b` `e` | Word forward / backward / word end |
| `0` `$` | Line start / line end |
| `f` `F` | Find next / previous char (`f(` → next paren) |
| `t` `T` | Till before next / after previous char |
| `;` `,` | Repeat last find / repeat reversed |
| `gg` `G` | First line / last line |

### Operators

| Keys | Action |
|------|--------|
| `d` + motion | Delete (e.g. `dw`, `d$`, `df,`) |
| `y` + motion | Yank (e.g. `yw`, `y$`) |
| `c` + motion | Change — delete + insert (e.g. `cw`) |
| `dd` `yy` `cc` | Delete / yank / change whole line |
| `dj` `dk` | Delete current + next / previous line (linewise) |
| `dG` `dgg` | Delete to end / start of buffer (linewise) |
| `D` `C` `Y` | Delete / change / yank to end of line |
| `p` | Paste after cursor (linewise or charwise depending on yank) |

### Text Objects

The power feature. After `d` / `y` / `c`, type `i` (inner) or `a` (around)
then a target:

| Keys | Action |
|------|--------|
| `iw` `aw` | Inner word / a word (with trailing space) |
| `i(` `a(` | Inside / around parentheses |
| `i[` `a[` | Inside / around brackets |
| `i{` `a{` | Inside / around braces |
| `i"` `a"` | Inside / around double quotes |
| `i'` `a'` | Inside / around single quotes |
| `` i` `` `` a` `` | Inside / around backticks |

Examples: `di(` deletes the contents of a function call, `ci"` changes
a quoted string, `da{` deletes a brace block and the braces.

### Single-Stroke Edits

| Keys | Action |
|------|--------|
| `x` | Delete char under cursor |
| `s` | Delete char, enter insert |
| `D` `C` `Y` | Delete / change / yank to end of line |
| `p` | Paste after cursor |
| `u` | Undo |

### Insert Mode

All standard pi keybindings work in insert mode (`ctrl+w` delete word,
`ctrl+k` kill line, `ctrl+y` paste, etc.).

| Keys | Action |
|------|--------|
| `i` `a` | Insert before / after cursor |
| `I` `A` | Insert at first non-blank / append at line end |
| `o` `O` | Open new line below / above |
| `escape` | Back to normal mode |

### Other

| Keys | Action |
|------|--------|
| `K` | Show keybinding reference overlay |
| `escape` | Cancel pending operator / leave insert |
| double `escape` | Abort streaming (from insert mode) |

## Status Indicator

Pi-vim shows the current mode in the footer:

| Mode | Indicator |
|------|-----------|
| Normal | `Vim: Normal` (accent) |
| Insert | `Vim: Insert` (success) |

## What's Not Included (and why)

- **Visual mode** — replaced by operators + text objects; avoids custom
  rendering that conflicted with pi's line layout.
- **Count prefixes (`3w`, `d2w`)** — rarely useful in a prompt-sized buffer.
- **Dot-repeat (`.`)** — high complexity for a feature that earns its keep
  in long source files, not input boxes.
- **Registers / named registers** — pi's built-in kill ring covers the
  common paste cases.
- **Redo (`ctrl+r`)** — pi's base editor has no redo primitive.

## Files

```
pi-vim/
├── index.ts            — Extension entry: /vim command, persistence, wiring
├── README.md
├── package.json
└── src/
    ├── editor.ts       — PiVimEditor: modes, key dispatch, operator state machine
    ├── keybindings.ts  — Keybinding reference + markdown overlay component
    ├── motions.ts      — Char classification + word-end helper
    ├── ops.ts          — Text operations: delete/yank/paste, text object ranges
    └── types.ts        — Shared types (VimMode, VimOperator, VimPending, ...)
```

## License

MIT
