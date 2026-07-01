/**
 * pi-vim — Modal vim editing for pi's prompt box.
 *
 * Reload with /reload to activate.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { PiVimEditor } from "./src/editor.ts";
import type { VimMode, VisualType } from "./src/types.ts";
import { createKeybindingsComponent } from "./src/keybindings.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const theme = ctx.ui.theme;

    const updateStatus = (mode: VimMode, vt: VisualType) => {
      let label: string;
      let color: string;
      if (mode === "normal") {
        label = "Vim: Normal";
        color = "customMessageLabel";
      } else if (mode === "visual") {
        label = vt === "line" ? "Vim: v-line" : "Vim: Visual";
        color = "warning";
      } else {
        label = "Vim: Insert";
        color = "success";
      }
      ctx.ui.setStatus("pi-vim", theme.fg(color, label));
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
      // K in normal mode shows keybinding reference
      editor.onKeybindingsRequest = () => {
        ctx.ui.custom<null>(
          (tui2, theme, _kb, done) =>
            createKeybindingsComponent(theme, getMarkdownTheme(), done, () => tui2.requestRender()),
        );
      };
      return editor;
    });

    updateStatus("insert", "char");
  });

  // Register /keybindings command — shows markdown reference, escape to close
  pi.registerCommand("keybindings", {
    description: "Show pi-vim keybindings",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("keybindings requires interactive mode", "error");
        return;
      }
      await ctx.ui.custom<null>(
        (tui, theme, _keybindings, done) =>
          createKeybindingsComponent(theme, getMarkdownTheme(), done, () => tui.requestRender()),
      );
    },
  });
}
