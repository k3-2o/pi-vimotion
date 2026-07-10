/**
 * pi-vim — Modal vim editing for pi's prompt box.
 *
 * Vim mode is OFF by default. Use /vim to toggle it on/off.
 * Reload with /reload to activate.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { PiVimEditor } from "./src/editor.ts";
import type { VimMode, VisualType } from "./src/types.ts";
import { resetState } from "./src/ops.ts";
import { createKeybindingsComponent } from "./src/keybindings.ts";

export default function (pi: ExtensionAPI) {
  let vimActive = false;

  const updateStatus = (ctx: ExtensionContext, theme: any, mode: VimMode, vt: VisualType) => {
    let label: string;
    let color: string;
    if (mode === "normal") {
      label = "Vim: Normal";
      color = "accent";
    } else if (mode === "visual") {
      label = vt === "line" ? "Vim: v-line" : "Vim: Visual";
      color = "warning";
    } else {
      label = "Vim: Insert";
      color = "success";
    }
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
        const prevMode = (editor as any).mode as VimMode;
        const prevVt = (editor as any).visualType as VisualType;
        origHandle(data);
        const newMode = (editor as any).mode as VimMode;
        const newVt = (editor as any).visualType as VisualType;
        if (newMode !== prevMode || (newMode === "visual" && newVt !== prevVt)) {
          updateStatus(ctx, theme, newMode, newVt);
        }
      };
      // K in normal mode shows keybinding reference (blocks during streaming)
      editor.onKeybindingsRequest = () => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Stream busy — try again in a sec", "warning");
          return;
        }
        ctx.ui.custom<null>(
          (tui2, theme, _kb, done) =>
            createKeybindingsComponent(theme, getMarkdownTheme(), done, () => tui2.requestRender()),
        );
      };
      return editor;
    });

    updateStatus(ctx, theme, "insert", "char");
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
