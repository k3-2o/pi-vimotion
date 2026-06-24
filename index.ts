/**
 * pi-vim — Modal vim editing for pi's prompt box.
 *
 * Reload with /reload to activate.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { PiVimEditor } from "./src/editor.ts";
import type { VimMode, VisualType } from "./src/types.ts";
import { buildKeybindingsMarkdown } from "./src/keybindings.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const theme = ctx.ui.theme;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const updateStatus = (mode: VimMode, vt: VisualType) => {
      if (hideTimer) clearTimeout(hideTimer);

      let label: string;
      let color: string;
      if (mode === "normal") {
        label = "NORMAL";
        color = "accent";
      } else if (mode === "visual") {
        label = vt === "line" ? "V-LINE" : "VISUAL";
        color = "warning";
      } else {
        label = "INSERT";
        color = "success";
      }
      ctx.ui.setStatus("pi-vim", theme.fg(color, label));

      hideTimer = setTimeout(() => ctx.ui.setStatus("pi-vim", undefined), 3000);
    };

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      const editor = new PiVimEditor(tui, editorTheme, keybindings);
      const origHandle = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        const prevMode = (editor as any).mode as VimMode;
        const prevVt = (editor as any).visualType as VisualType;
        origHandle(data);
        const newMode = (editor as any).mode as VimMode;
        if (newMode !== prevMode) {
          updateStatus(newMode, (editor as any).visualType as VisualType);
        }
      };
      return editor;
    });

    updateStatus("insert", "char");
  });

  // Register message renderer for /keybindings popup
  pi.registerMessageRenderer("vim-keybindings", (message, _options, theme) => {
    const content = typeof message.content === "string"
      ? message.content
      : message.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    return new Markdown(content, 1, 1, getMarkdownTheme());
  });

  // Register /keybindings command
  pi.registerCommand("keybindings", {
    description: "Show all pi-vim keybindings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("keybindings requires interactive mode", "error");
        return;
      }
      pi.sendMessage({
        customType: "vim-keybindings",
        content: buildKeybindingsMarkdown(),
        display: true,
      }, { triggerTurn: false });
    },
  });
}
