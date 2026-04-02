// TUI entry-point for `msc tui`
import { ConfigManager } from "../config.js";
import { runMenu } from "../tui/menu.js";
import { statusScreen } from "../tui/screens/status-screen.js";
import { configScreen } from "../tui/screens/config-screen.js";
import { authScreen } from "../tui/screens/auth-screen.js";
import { resetScreen } from "../tui/screens/reset-screen.js";
import { scrapeScreen } from "../tui/screens/scrape-screen.js";
import type { PromptFn } from "../auth/prompt.js";

export async function runTui(opts: { promptFn: PromptFn; version: string }): Promise<void> {
  const { promptFn, version } = opts;
  const config = new ConfigManager();
  const outputDir = (await config.get("outputDir")) as string | undefined ?? "";

  await runMenu({
    title: "HWR Moodle Scraper",
    version: `v${version}`,
    promptFn,
    items: [
      {
        label: "Scrape",
        action: () => scrapeScreen(outputDir, promptFn),
      },
      {
        label: "Status",
        action: () => statusScreen(outputDir, promptFn),
      },
      {
        label: "Reset",
        action: () => resetScreen(outputDir, promptFn),
      },
      {
        label: "Auth",
        action: () => authScreen(promptFn),
      },
      {
        label: "Config",
        action: () => configScreen(promptFn),
      },
      {
        label: "Quit",
        action: async () => { process.stdout.write("Moodle-Scraper - See you soon!\n"); process.exit(0); },
      },
    ],
  });
}
