/**
 * Keybinding reference data for pi-vim.
 * Exported as a markdown string rendered into chat via sendMessage + messageRenderer.
 */

export function buildKeybindingsMarkdown(): string {
  return `### pi-vim Keybindings

**Motions**
| Key | Action |
|-----|--------|
| \`h\` / \`j\` / \`k\` / \`l\` | Left / Down / Up / Right |
| \`w\` / \`b\` / \`e\` | Word fwd / bwd / word end |
| \`0\` / \`$\` / \`^\` / \`g_\` | Line start / end / first non-blank / last non-blank |
| \`gg\` / \`G\` / \`{N}G\` | First line / last line / go to line N |
| \`{\` / \`}\` | Paragraph backward / forward |

**Operators** (prepend before motion, e.g. \`dw\`, \`y$\`)
| Key | Action |
|-----|--------|
| \`d\` + motion | Delete from cursor through motion |
| \`y\` + motion | Yank (copy) from cursor through motion |
| \`c\` + motion | Change (delete + insert mode) through motion |

**Line Operations**
| Key | Action |
|-----|--------|
| \`dd\` / \`yy\` / \`cc\` | Delete / yank / change whole line |
| \`D\` / \`C\` / \`Y\` | Delete / change / yank to line end |
| \`p\` / \`P\` | Paste after / before cursor |

**Insert Mode**
| Key | Action |
|-----|--------|
| \`i\` / \`a\` | Enter insert mode at cursor / after cursor |
| \`I\` / \`A\` | Insert at line start / append at line end |
| \`o\` / \`O\` | Open new line below / above |
| \`s\` / \`S\` | Substitute char / substitute line |

**Visual Mode**
| Key | Action |
|-----|--------|
| \`v\` / \`V\` | Visual char mode / visual line mode |
| \`d\` / \`x\` / \`y\` / \`c\` | Delete / cut / yank / change selection |

**Editing**
| Key | Action |
|-----|--------|
| \`x\` / \`X\` | Delete char forward / backward |
| \`u\` | Undo |
| \`.\` | Repeat last operation |
| \`g\` prefix | \`gg\` (goto top), \`g_\` (last non-blank), \`ge\` (word end bwd) |
| \`Esc\` | Back to normal mode / cancel operation |

Tip: Prefix any motion with a number, e.g. \`3j\` = move down 3 lines, \`d2w\` = delete 2 words.`;
}
