#!/usr/bin/env node
// REQ-CLI-001, REQ-CLI-013, REQ-CLI-014
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "./exit-codes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8")
) as { version: string; name: string };

const program = new Command();

program
  .name("moodle-scraper")
  .description("Download all content from HWR Berlin Moodle LMS")
  .version(`moodle-scraper ${pkg.version}`, "-V, --version", "Print version and exit")
  .addHelpCommand(false);

// Subcommand stubs — wired up in later steps
program
  .command("scrape")
  .description("Download / sync Moodle content to local folder")
  .action(() => { console.error("Not yet implemented"); process.exit(EXIT_CODES.ERROR); });

program
  .command("auth")
  .description("Manage Moodle credentials")
  .action(() => { console.error("Not yet implemented"); process.exit(EXIT_CODES.ERROR); });

program
  .command("config")
  .description("View and set configuration values")
  .action(() => { console.error("Not yet implemented"); process.exit(EXIT_CODES.ERROR); });

program
  .command("status")
  .description("Show last sync summary")
  .action(() => { console.error("Not yet implemented"); process.exit(EXIT_CODES.ERROR); });

// Unknown command handler — REQ-CLI-011
program.on("command:*", (args: string[]) => {
  process.stderr.write(
    `Unknown command: ${args[0]}. Run moodle-scraper --help for usage.\n`
  );
  process.exit(EXIT_CODES.USAGE_ERROR);
});

program.parse(process.argv);
