/**
 * Keybinding reference for pi-vim.
 * Renders as a Markdown component wrapped in a scrollable/dismissable overlay.
 */

import { Markdown, matchesKey, type Component } from "@earendil-works/pi-tui";

export function buildKeybindingsMarkdown(): string {
  return `### pi-vim Keybindings

**Motions**
| Key | Action |
|-----|--------|
| \`h\` / \`j\` / \`k\` / \`l\` | Left / Down / Up / Right |
| \`w\` / \`b\` / \`e\` / \`ge\` | Word fwd / bwd / word end / word end bwd |
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
| \`D\` / \`C\` / \`Y\` | Delete / change / yank to end of line(s) |
| \`p\` / \`P\` | Paste after / before cursor |

**Insert Mode**
| Key | Action |
|-----|--------|
| \`i\` / \`a\` | Insert before / after cursor |
| \`I\` / \`A\` | Insert at start / append at end of line |
| \`o\` / \`O\` | Open line below / above |
| \`s\` / \`S\` | Substitute char / substitute line |

**Visual Mode**
| Key | Action |
|-----|--------|
| \`v\` / \`V\` | Visual char mode / visual line mode |
| \`v\` / \`V\` (toggle) | Switch between char and line selection |
| \`d\` / \`x\` / \`y\` / \`c\` | Delete / cut / yank / change selection |
| \`Esc\` | Cancel visual selection |

**Editing**
| Key | Action |
|-----|--------|
| \`x\` / \`X\` | Delete char forward / backward |
| \`u\` | Undo |
| \`.\` | Repeat last operation |
| \`g\` prefix | \`gg\` (goto top), \`g_\` (last non-blank), \`ge\` (word end bwd) |
| \`K\` | Show this keybinding reference |
| \`Esc\` | Back to normal mode / cancel operation |

**Tips**
• Prefix with a number to repeat, e.g. \`3j\` = down 3 lines, \`d2w\` = delete 2 words
• \`3Y\` yanks 3 lines, \`3D\` / \`3C\` deletes / changes 3 lines down
• Operators + motion work in visual mode motions too
• Yanked text is copied to your system clipboard
• \`V\` + \`j\`/\`k\` selects whole lines; \`d\` deletes them, \`y\` yanks them`;
}

/**
 * Create a component that renders the keybinding markdown and handles keyboard.
 */
export function createKeybindingsComponent(
  theme: any,
  mdTheme: any,
  done: (value: null) => void,
  requestRender: () => void,
): Component {
  const md = new Markdown(buildKeybindingsMarkdown(), 1, 1, mdTheme);

  return {
    render(width: number): string[] {
      return md.render(width);
    },
    invalidate(): void {
      md.invalidate();
    },
    handleInput(data: string): void {
      if (matchesKey(data, "escape") || data === "q") {
        done(null);
        return;
      }
      if (data === "j" || matchesKey(data, "down") || matchesKey(data, "pageDown")) {
        // Let the Markdown component scroll if it supports it, or just dismiss
        done(null);
        return;
      }
      if (data === "k" || matchesKey(data, "up") || matchesKey(data, "pageUp")) {
        done(null);
        return;
      }
      // Any other key dismisses
      done(null);
    },
  };
}
