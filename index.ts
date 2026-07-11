/**
 * pi-vim — Modal vim editing for pi's prompt box.
 *
 * Vim mode is OFF by default. Use /vim to toggle it on/off.
 * Two modes only: Normal and Insert. Reload with /reload to activate.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { PiVimEditor } from "./src/editor.ts";
import type { VimMode } from "./src/types.ts";
import { resetState } from "./src/ops.ts";
import { createKeybindingsComponent } from "./src/keybindings.ts";

export default function (pi: ExtensionAPI) {
  let vimActive = false;

  const updateStatus = (ctx: ExtensionContext, theme: any, mode: VimMode) => {
    const label = mode === "normal" ? "Vim: Normal" : "Vim: Insert";
    const color = mode === "normal" ? "accent" : "success";
    ctx.ui.setStatus("pi-vim", theme.fg(color, label));
  };

  const clearStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus("pi-vim", undefined);
  };

  const activateVim = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      const editor = new PiVimEditor(tui, editorTheme, keybindings);
      const origHandle = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        const prevMode = editor.mode;
        origHandle(data);
        if (editor.mode !== prevMode) {
          updateStatus(ctx, theme, editor.mode);
        }
      };
      // K in normal mode shows keybinding reference (blocks during streaming)
      editor.onKeybindingsRequest = () => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Stream busy — try again in a sec", "warning");
          return;
        }
        ctx.ui.custom<null>(
          (tui2, _theme, _kb, done) =>
            createKeybindingsComponent(getMarkdownTheme(), done, () => tui2.requestRender()),
        );
      };
      return editor;
    });

    updateStatus(ctx, theme, "insert");
    ctx.ui.notify("Vim mode on — Esc for Normal mode", "info");
  };

  const deactivateVim = (ctx: ExtensionContext) => {
    ctx.ui.setEditorComponent(undefined);
    clearStatus(ctx);
    ctx.ui.notify("Vim mode off", "info");
  };

  pi.registerCommand("vim", {
    description: "Toggle vim mode on/off",
    handler: async (_args, ctx) => {
      if (vimActive) {
        vimActive = false;
        deactivateVim(ctx);
      } else {
        vimActive = true;
        activateVim(ctx);
      }
    },
  });

  // Clear vim state on session shutdown so it resets on new session
  pi.on("session_shutdown", () => {
    vimActive = false;
    resetState();
  });
}
