/**
 * pi-vim — Modal vim editing for pi's prompt box.
 *
 * Vim mode is OFF by default. Use /vim to toggle it on/off.
 * The preference persists across sessions and reloads via ~/.pi/vim-enabled.
 * Two modes only: Normal and Insert.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PiVimEditor } from "./src/editor.ts";
import type { VimMode } from "./src/types.ts";
import { resetState } from "./src/ops.ts";
import { createKeybindingsComponent } from "./src/keybindings.ts";

const VIM_PREF_FILE = join(getAgentDir(), "vim-enabled");

/** Read the persisted vim preference. Presence of file = enabled. */
function readVimPref(): boolean {
  try {
    return existsSync(VIM_PREF_FILE);
  } catch {
    return false;
  }
}

/** Persist (or clear) the vim preference. */
function writeVimPref(enabled: boolean) {
  try {
    if (enabled) writeFileSync(VIM_PREF_FILE, "");
    else if (existsSync(VIM_PREF_FILE)) unlinkSync(VIM_PREF_FILE);
  } catch {
    // Non-fatal: in-memory state still works for the session.
  }
}

export default function (pi: ExtensionAPI) {
  // Seed from persisted preference so /reload preserves the on/off state.
  let vimActive = readVimPref();

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
        writeVimPref(false);
        deactivateVim(ctx);
      } else {
        vimActive = true;
        writeVimPref(true);
        activateVim(ctx);
      }
    },
  });

  pi.registerShortcut("ctrl+;", {
    description: "Toggle vim mode",
    handler: async (ctx) => {
      if (vimActive) {
        vimActive = false;
        writeVimPref(false);
        deactivateVim(ctx);
      } else {
        vimActive = true;
        writeVimPref(true);
        activateVim(ctx);
      }
    },
  });

  // Re-activate vim on session start if the preference says it should be on.
  // Covers startup, /reload, /new, /resume, /fork — all fire session_start.
  pi.on("session_start", async (_event, ctx) => {
    if (vimActive) activateVim(ctx);
  });

  // Clear vim yank buffer on session shutdown; keep the preference itself.
  pi.on("session_shutdown", () => {
    resetState();
  });
}
