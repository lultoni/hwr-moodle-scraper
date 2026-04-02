#!/usr/bin/env node
// scripts/file-checker.js
// Checks the moodle-scraper output directory for anomalous files.
// Usage: node scripts/file-checker.js [outputDir]
// Exit code: 0 = clean, 1 = anomalies found

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUSPICIOUS_NAME_PATTERNS = [
  /^error[_\s]*$/i,                 // only exact "Error" names
  /^login[_\s]*$/i,                 // only exact "Login" pages
  /^page\s*not\s*found[_\s]*$/i,   // only exact "Page not found"
  /^access\s*denied[_\s]*$/i,      // only exact "Access Denied"
  /^forbidden[_\s]*$/i,             // only exact "Forbidden"
];

// Well-known filenames that legitimately have no extension
const KNOWN_NO_EXT = new Set([
  "makefile", "dockerfile", "vagrantfile", "procfile", "gemfile", "rakefile",
  "sshd_config", "ssh_config", "hosts", "fstab", "crontab", "sudoers",
  "bashrc", "bash_profile", "zshrc", "profile",
]);

// ---------------------------------------------------------------------------
// Resolve output dir
// ---------------------------------------------------------------------------

let outputDir = process.argv[2];

if (!outputDir) {
  // Try to read from config
  const configFile = join(homedir(), ".config", "moodle-scraper", "config.json");
  if (existsSync(configFile)) {
    try {
      const cfg = JSON.parse(readFileSync(configFile, "utf8"));
      outputDir = cfg.outputDir;
    } catch {
      // ignore
    }
  }
}

if (!outputDir) {
  outputDir = join(homedir(), "moodle-scraper-output");
}

if (!existsSync(outputDir)) {
  console.log(`Output directory does not exist: ${outputDir}`);
  console.log("OK: nothing to check.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load state file to identify scraper-produced files vs user files
// ---------------------------------------------------------------------------

const stateFile = join(outputDir, ".moodle-scraper-state.json");
/** @type {Set<string>} */
const knownPaths = new Set();

if (existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    for (const course of Object.values(state.courses ?? {})) {
      for (const section of Object.values(course.sections ?? {})) {
        for (const file of Object.values(section.files ?? {})) {
          if (file.localPath) knownPaths.add(file.localPath);
          if (file.sidecarPath) knownPaths.add(file.sidecarPath);
          for (const sp of file.submissionPaths ?? []) knownPaths.add(sp);
        }
      }
    }
  } catch {
    console.warn("Warning: could not read state file — user-file detection disabled.");
  }
}

// ---------------------------------------------------------------------------
// Recursive scan
// ---------------------------------------------------------------------------

const anomalies = [];

function scan(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Skip the state file itself and sidecar .meta.json files
    if (entry.name === ".moodle-scraper-state.json") continue;

    if (entry.isDirectory()) {
      scan(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const isUserFile = knownPaths.size > 0 && !knownPaths.has(fullPath);
    const tag = isUserFile ? " [user-file]" : "";

    // 1. Orphaned .tmp files
    if (entry.name.endsWith(".tmp")) {
      anomalies.push({ type: "orphaned-tmp", path: fullPath, userFile: isUserFile });
      continue;
    }

    // Skip meta sidecars
    if (entry.name.endsWith(".meta.json")) continue;

    // 2. PHP files (download error — Moodle returned PHP source)
    if (entry.name.endsWith(".php")) {
      anomalies.push({ type: "php-file", path: fullPath, userFile: isUserFile });
      continue;
    }

    // 3. Files without extensions (only check files known to come from scraper, or all if state unavailable)
    const ext = extname(entry.name);
    if (!ext && (knownPaths.size === 0 || knownPaths.has(fullPath))) {
      // Skip known extensionless filenames (e.g. sshd_config, Makefile)
      if (!KNOWN_NO_EXT.has(entry.name.toLowerCase())) {
        anomalies.push({ type: "missing-extension", path: fullPath, userFile: false });
      }
      continue;
    }

    // 4. Suspicious names
    const base = basename(entry.name, ext);
    for (const pattern of SUSPICIOUS_NAME_PATTERNS) {
      if (pattern.test(base)) {
        anomalies.push({ type: "suspicious-name", path: fullPath, userFile: isUserFile });
        break;
      }
    }

    // 5. Empty files (only scraper-produced ones)
    if (!isUserFile) {
      try {
        const st = statSync(fullPath);
        if (st.size === 0) {
          anomalies.push({ type: "empty-file", path: fullPath, userFile: false });
        }
      } catch {
        // ignore stat errors
      }
    }
  }
}

scan(outputDir);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (anomalies.length === 0) {
  process.stdout.write(`Checked: ${outputDir}\nOK: 0 anomalies found.\n`);
  process.exit(0);
} else {
  const scraperAnomalies = anomalies.filter((a) => !a.userFile);
  const lines = [`Checked: ${outputDir}`, `Found ${anomalies.length} anomaly/anomalies:\n`];
  for (const a of anomalies) {
    const userTag = a.userFile ? "  [user-file — informational]" : "";
    lines.push(`ANOMALY: ${a.type.padEnd(20)} ${a.path}${userTag}`);
  }
  lines.push("");
  if (scraperAnomalies.length > 0) {
    lines.push(`${scraperAnomalies.length} scraper-produced anomaly/anomalies require fixing.`);
    // Write to stderr so Claude Code hook runner receives the feedback
    // Exit 2 = blocking Stop hook: Claude Code feeds stderr back to Claude
    // so it can fix the anomalies before the session ends.
    process.stderr.write(lines.join("\n") + "\n");
    process.exit(2);
  } else {
    lines.push("All anomalies are user-added files — no action required.");
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  }
}
