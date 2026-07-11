/**
 * Keybinding reference for pi-vim.
 * Renders as a Markdown component wrapped in a dismissable overlay.
 */

import { Markdown, matchesKey, type Component } from "@earendil-works/pi-tui";

export function buildKeybindingsMarkdown(): string {
  return `### pi-vim Keybindings

**Motions**
| Key | Action |
|-----|--------|
| \`h\` \`j\` \`k\` \`l\` | Left / Down / Up / Right |
| \`w\` \`b\` \`e\` | Next word start / prev word start / word end |
| \`0\` \`$\` | Line start / line end |

**Operators** (type operator, then a motion or text object)
| Key | Action |
|-----|--------|
| \`d\` + motion | Delete (e.g. \`dw\`, \`d$\`) |
| \`y\` + motion | Yank (e.g. \`yw\`, \`y$\`) |
| \`c\` + motion | Change — delete + insert (e.g. \`cw\`) |
| \`dd\` \`yy\` \`cc\` | Delete / yank / change whole line |

**Text objects** (after \`d\`/\`y\`/\`c\`, type \`i\` or \`a\` then a char)
| Key | Action |
|-----|--------|
| \`iw\` \`aw\` | Inner word / a word (with trailing space) |
| \`i(\` \`a(\` | Inside / around parentheses |
| \`i[\` \`a[\` | Inside / around brackets |
| \`i{\` \`a{\` | Inside / around braces |
| \`i"\` \`a"\` | Inside / around double quotes |
| \`i'\` \`a'\` | Inside / around single quotes |
| \`i\\\`\` \`a\\\`\` | Inside / around backticks |

**Single-stroke edits**
| Key | Action |
|-----|--------|
| \`x\` | Delete char under cursor |
| \`s\` | Delete char, enter insert |
| \`D\` | Delete to end of line |
| \`C\` | Change to end of line |
| \`Y\` | Yank line |
| \`p\` | Paste after cursor |

**Insert mode**
| Key | Action |
|-----|--------|
| \`i\` \`a\` | Insert before / after cursor |
| \`I\` \`A\` | Insert at first non-blank / append at line end |
| \`o\` \`O\` | Open line below / above |
| \`Esc\` | Back to normal mode |

**Other**
| Key | Action |
|-----|--------|
| \`K\` | Show this reference |
| \`Esc\` | Cancel pending operator |

_Yanked text stays in the vim register for \`p\`._`;
}

/**
 * Create a component that renders the keybinding markdown and handles keyboard.
 */
export function createKeybindingsComponent(
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
      // Any other key dismisses
      done(null);
    },
  };
}
