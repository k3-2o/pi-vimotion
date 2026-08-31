# pi-vim

Modal vim editing for [pi](https://pi.dev)'s prompt box.

Normal + Insert modes, operators (`d`/`y`/`c`) that compose with motions and
text objects (`di(`, `ciw`, `daw`), find/till (`f`/`t`, repeat with `;`/`,`),
and buffer jumps (`gg`/`G`). Off by default — toggle with `/vim`.
Press `K` in normal mode for the full keybinding reference.

## Install

```bash
pi install npm:pi-vimotion
```

Then restart pi (or `/reload`) and run `/vim`.

## Usage

| What | How |
|------|-----|
| Toggle vim | `/vim` or `ctrl+;` (persists across sessions) |
| Enter normal mode | `escape` |
| Start typing | `i` `a` `I` `A` `o` `O` |
| Full keybindings | `K` in normal mode |
| Abort streaming | double `escape` from insert |

Vim starts in **Normal mode** when toggled on. Yanks also copy to the system
clipboard (inside tmux, enable `set -s set-clipboard on`).

## License

MIT
