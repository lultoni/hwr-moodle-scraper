#!/usr/bin/env node
// build-persona-findings.js
// Reads intermediate persona sweep files, deduplicates tickets,
// writes docs/persona-findings.md, then strips ## Feature Requests & Findings
// sections from all persona-NN-*.md files.
//
// Usage: node scripts/build-persona-findings.js
//
// Inputs (must exist):
//   /tmp/wave2a-part1.txt  — tickets + coverage rows for personas 01-07
//   /tmp/wave2a-part2.txt  — tickets + coverage rows for personas 08-14
//   /tmp/wave2b-coverage.txt — MATRIX_ROW and SCORE_ROW lines
//   /tmp/wave2b-workflows.txt — WORKFLOW lines
//
// Outputs:
//   docs/persona-findings.md — regenerated fully
//   agents/personas/persona-NN-*.md — ## Feature Requests & Findings removed

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Read all intermediate files
// ---------------------------------------------------------------------------
function read(path) {
  return readFileSync(path, 'utf8');
}

const part1 = read('/tmp/wave2a-part1.txt');
const part2 = read('/tmp/wave2a-part2.txt');
const coverageTxt = read('/tmp/wave2b-coverage.txt');
const workflowsTxt = read('/tmp/wave2b-workflows.txt');

// ---------------------------------------------------------------------------
// 2. Parse tickets from part1 + part2
// ---------------------------------------------------------------------------

/**
 * Parse ticket blocks from text.
 * Each block starts with TICKET_RAW and is followed by TITLE:, DESCRIPTION:, FIX: lines.
 * Returns array of { persona, type, severity, command, title, description, fix }
 */
function parseTickets(text) {
  const tickets = [];
  // Split on TICKET_RAW lines
  const lines = text.split('\n');
  let current = null;

  for (const line of lines) {
    if (line.startsWith('TICKET_RAW |')) {
      if (current) tickets.push(current);
      // Parse: TICKET_RAW | [persona NN Name] | [type] | [severity] | [command]
      const parts = line.split(' | ').map(s => s.trim());
      const persona = parts[1].replace(/^\[|\]$/g, '').replace(/^persona\s+/i, '').trim();
      const type = parts[2].replace(/^\[|\]$/g, '').toLowerCase()
        .replace('feature gap', 'feature').replace('ux improvement', 'ux')
        .replace('ux / data safety', 'ux').replace('documentation / ux', 'docs')
        .replace('documentation bug', 'docs').replace('documentation', 'docs')
        .replace('safety', 'ux').replace('bug / reliability', 'bug');
      const severity = parts[3].replace(/^\[|\]$/g, '').toLowerCase()
        .replace('critical', 'high'); // treat critical as high
      const command = parts[4].replace(/^\[|\]$/g, '').trim();
      current = { persona, type, severity, command, title: '', description: '', fix: '' };
    } else if (current && line.startsWith('TITLE:')) {
      current.title = line.slice(6).trim();
    } else if (current && line.startsWith('DESCRIPTION:')) {
      current.description = line.slice(12).trim();
    } else if (current && line.startsWith('FIX:')) {
      current.fix = line.slice(4).trim();
    }
  }
  if (current) tickets.push(current);
  return tickets;
}

const allTickets = [...parseTickets(part1), ...parseTickets(part2)];
console.log(`Parsed ${allTickets.length} raw tickets`);

// ---------------------------------------------------------------------------
// 3. Deduplicate tickets
// ---------------------------------------------------------------------------

/**
 * Normalise a string for comparison: lowercase, strip punctuation/spaces.
 */
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Two tickets are the same if their normalised titles overlap significantly
 * OR they share the same root keyword cluster.
 *
 * Cluster map: keyword → canonical group name
 */
const CLUSTERS = [
  { key: ['md file', 'markdown', 'raw text', 'textedit', 'rawmarkdown', 'mdfile'], group: 'md-raw-text' },
  { key: ['urltxt', 'url.txt', 'webloc', 'doubleclick', 'doubleclickurl'], group: 'url-txt-open' },
  { key: ['readme', 'outputfolder', 'outputroot', 'aboutmd', 'howtoopen'], group: 'output-readme' },
  { key: ['sidecar', 'jargon', 'done summary', 'skipped'], group: 'sidecar-jargon' },
  { key: ['progress', 'eta', 'stall', 'slowcourse', 'estimatedtime'], group: 'scrape-progress' },
  { key: ['legend', 'changesymbol', 'changeprefix', 'plusminus', 'tildesymbol'], group: 'change-legend' },
  { key: ['tuiconfig', 'configscreen', 'configkeys', 'rawkeys'], group: 'tui-config-keys' },
  { key: ['linuxcredential', 'keytarnotavailable', 'keytarunavailable', 'nokeytar', 'linuxkeytar', 'windowskeytar', 'credentialpersist'], group: 'credential-persist' },
  { key: ['authset', 'silentfail', 'authsetfail', 'keytarsilent'], group: 'auth-set-silent' },
  { key: ['authstatus', 'misleading', 'authstatusmisleading'], group: 'auth-status-mislead' },
  { key: ['noninteractive', 'non-interactive', 'noninteractivefail'], group: 'non-interactive' },
  { key: ['orphancleanup', 'orphanprune', 'dismissorphan', 'pruneorphan', 'targetedorphan', 'orphantargeted', 'bulkdismiss', 'dismissorphans', 'archiveorphan'], group: 'orphan-cleanup' },
  { key: ['orphanlabel', 'orphanterm', 'orphanjargon', 'orphanexplain', 'unexplainedorphan'], group: 'orphan-jargon' },
  { key: ['orphancount', 'orphanguidance', 'orphanaction', 'orphannoaction'], group: 'orphan-count-guidance' },
  { key: ['orphantree', 'orphangrouping', 'orphanscale', 'issuestree', 'summaryapproach', 'flatlist', 'summaryirst'], group: 'orphan-tree-ux' },
  { key: ['resetconfirm', 'resetdangerous', 'resetprompt', 'resetpermanent', 'resetscope'], group: 'reset-safety' },
  { key: ['statereset', 'stateonlyreset', 'resetstate', 'resetnofiles'], group: 'reset-state-only' },
  { key: ['helptopic', 'inlinehelp', 'mschelp', 'helpcommand', 'concepthelp'], group: 'help-topic' },
  { key: ['quietupdate', 'quietstderr', 'updatechecker', 'updatequiet'], group: 'quiet-update-leak' },
  { key: ['jsonoutput', 'machinereadable', 'structuredoutput', 'jsonmode'], group: 'json-output' },
  { key: ['quietchange', 'changesupp', 'changereport', 'changerepport'], group: 'quiet-change-report' },
  { key: ['configdesc', 'configlist', 'configdescription', 'keysdesc'], group: 'config-list-desc' },
  { key: ['postscrape', 'postscrapehook', 'webhook', 'hook'], group: 'post-scrape-hook' },
  { key: ['userfiles', '_user-files', 'userfilesprot', 'protectedfolder'], group: 'user-files-protect' },
  { key: ['cleanpanic', 'cleandelete', 'cleanlanguage', 'dryrundeletion'], group: 'clean-panic' },
  { key: ['cleanhelp', 'cleanhelptext', 'cleanmislead'], group: 'clean-help-text' },
  { key: ['cleanmove', 'movewarn', 'obsidianlink', 'movebreak'], group: 'clean-move-warn' },
  { key: ['userstatus', 'statusbreakdown', 'protectedcount'], group: 'status-user-breakdown' },
  { key: ['userfolder', 'userfolderconfig', 'customfolder'], group: 'user-folder-config' },
  { key: ['coursematch', 'hyphen', 'coursefilter', 'matchingbug'], group: 'courses-hyphen' },
  { key: ['archivesemester', 'semesterarchive', 'archivecourse'], group: 'archive-semester' },
  { key: ['orphanstale', 'stalorphan', 'partialorphan', 'partialstale'], group: 'orphan-stale-partial' },
  { key: ['lastsync', '_lastsync', 'lastsyncmd', 'changelogfile'], group: 'last-sync-md' },
  { key: ['statuschanged', 'msclog', 'changedlog', 'changedcommand'], group: 'status-changed' },
  { key: ['applenotes', 'markdownformat', 'plaintextformat', 'plaintextoutput'], group: 'apple-notes-md' },
  { key: ['changegrouping', 'changecourse', 'changereportgroup'], group: 'change-grouping' },
  { key: ['goodnotes', 'goodnoteswarn', 'annotationwarn', 'pdfoverwrite'], group: 'goodnotes-overwrite' },
  { key: ['nodescription', 'nodesc', 'skipdesc', 'suppressdesc', 'descriptionflag'], group: 'no-descriptions-flag' },
  { key: ['sidecarheader', 'sidecarorigin', 'sidecarattribution'], group: 'sidecar-header' },
  { key: ['longfilename', 'filenamelength', 'filetruncate'], group: 'long-filename' },
  { key: ['windowsinstall', 'npmregistr', 'npm404', 'registryerror'], group: 'windows-install-docs' },
  { key: ['windowssudo', 'windowspermission', 'sudowindows'], group: 'windows-sudo-docs' },
  { key: ['windowspathdisplay', 'pathformat', 'posixpath', 'unixpath'], group: 'path-display' },
  { key: ['tuiwindows', 'tuirendering', 'cmdrendering', 'legacycmd'], group: 'tui-windows' },
  { key: ['eperm', 'onedrive', 'cloudlock', 'atomicwritefail'], group: 'cloud-lock' },
  { key: ['pathremap', 'remappath', 'statemigrate', 'pathchange'], group: 'path-remap' },
  { key: ['orphanreason', 'orphandiff', 'orphancause', 'everdownloaded'], group: 'orphan-reason' },
  { key: ['germanerror', 'germanerrormsg', 'untranslated'], group: 'german-error' },
  { key: ['germanfilename', 'generatedfn', 'generatedfname'], group: 'german-filename' },
  { key: ['wsldocs', 'wsl2readme', 'wslguide'], group: 'wsl-docs' },
  { key: ['spacesinpath', 'spacepath', 'outputdirspace'], group: 'spaces-in-path' },
  { key: ['statusjargon', 'plainmode', 'statusplain', 'statusterms'], group: 'status-jargon' },
  { key: ['fastflag', 'performancepreset', 'requestdelayflag'], group: 'fast-flag' },
];

function getCluster(ticket) {
  const haystack = norm(ticket.title + ' ' + ticket.description + ' ' + ticket.command);
  for (const { key, group } of CLUSTERS) {
    if (key.some(k => haystack.includes(norm(k)))) return group;
  }
  // Fallback: use first 40 chars of normalised title
  return norm(ticket.title).slice(0, 40);
}

// Group tickets by cluster
const byCluster = new Map();
for (const t of allTickets) {
  const g = getCluster(t);
  if (!byCluster.has(g)) byCluster.set(g, []);
  byCluster.get(g).push(t);
}

// For each cluster: merge into one canonical ticket
const SEVERITY_ORDER = ['high', 'medium', 'low'];
function worstSeverity(tickets) {
  for (const s of SEVERITY_ORDER) {
    if (tickets.some(t => t.severity === s)) return s;
  }
  return 'low';
}

function longestStr(...strs) {
  return strs.filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
}

function normalisePersonaName(raw) {
  // "persona 01 Lea" -> "persona-01-lea"
  return raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/^persona-?/, 'persona-');
}

const unified = [];
for (const [, tickets] of byCluster) {
  const personas = [...new Set(tickets.map(t => normalisePersonaName(t.persona)))].join(', ');
  const severity = worstSeverity(tickets);
  const type = tickets[0].type;
  const command = longestStr(...tickets.map(t => t.command));
  const title = longestStr(...tickets.map(t => t.title));
  const description = longestStr(...tickets.map(t => t.description));
  const fix = longestStr(...tickets.map(t => t.fix));
  unified.push({ personas, severity, type, command, title, description, fix });
}

// Sort: high first, then medium, then low
unified.sort((a, b) => {
  const si = s => SEVERITY_ORDER.indexOf(s);
  return si(a.severity) - si(b.severity);
});

// Number them
unified.forEach((t, i) => { t.id = i + 1; });

console.log(`Deduplicated to ${unified.length} unique tickets (from ${allTickets.length} raw)`);

// ---------------------------------------------------------------------------
// 4. Parse coverage matrix and score table
// ---------------------------------------------------------------------------

const FEATURES = [
  'install','wizard','auth-set','auth-clear','auth-status','scrape-first-run',
  'scrape-incremental','scrape-force','scrape-dry-run','scrape-courses-filter',
  'scrape-quiet','config-list','config-set','status','status-issues','status-changed',
  'status-dismiss-orphans','clean','reset','reset-full','tui','output-binary',
  'output-page-md','output-info-md','output-url-txt','output-description-md',
  'env-var-credentials','post-scrape-hook','persistent-change-log','last-sync-md',
  'user-files-protection','cross-platform-paths','goodnotes-annotation',
  'tui-rendering','config-list-descriptions','archive',
];

const PERSONAS_SHORT = [
  '01 Lea','02 Tobias','03 Amara','04 Felix','05 Jana','06 David',
  '07 Sophie','08 Kenji','09 Mira','10 Luca','11 Nele','12 Rafael',
  '13 Hannah','14 Ben',
];

// Parse MATRIX_ROW lines
const matrixRows = new Map(); // persona -> [36 scores]
for (const line of coverageTxt.split('\n')) {
  if (!line.startsWith('MATRIX_ROW |')) continue;
  const parts = line.split(' | ');
  // parts[0] = "MATRIX_ROW", parts[1] = "NN Name", parts[2..37] = scores
  const persona = parts[1].trim();
  const scores = parts.slice(2).map(s => s.trim().replace(/\s*\|?\s*$/, ''));
  matrixRows.set(persona, scores);
}

// Parse SCORE_ROW lines
const scoreRows = new Map(); // feature -> [14 scores + worst]
for (const line of coverageTxt.split('\n')) {
  if (!line.startsWith('SCORE_ROW |')) continue;
  const parts = line.split(' | ');
  const feature = parts[1].trim();
  const scores = parts.slice(2).map(s => s.trim().replace(/\s*\|?\s*$/, ''));
  scoreRows.set(feature, scores);
}

// Parse WORKFLOW lines
const workflows = new Map(); // "NN Name" -> summary
for (const line of workflowsTxt.split('\n')) {
  if (!line.startsWith('WORKFLOW |')) continue;
  const idx = line.indexOf(' | ');
  const idx2 = line.indexOf(' | ', idx + 3);
  const persona = line.slice(idx + 3, idx2).trim();
  const summary = line.slice(idx2 + 3).trim();
  workflows.set(persona, summary);
}

// ---------------------------------------------------------------------------
// 5. Build docs/persona-findings.md
// ---------------------------------------------------------------------------

function padRow(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

function section2() {
  const header = padRow(['Feature', ...PERSONAS_SHORT, 'Worst']);
  const sep = padRow([':-------', ...PERSONAS_SHORT.map(() => ':---:'), ':---:']);
  const rows = [];
  for (const feat of FEATURES) {
    if (!scoreRows.has(feat)) continue;
    const scores = scoreRows.get(feat); // [14 persona scores + worst]
    rows.push(padRow([feat, ...scores]));
  }
  if (rows.length === 0) return '## Section 1: Feature Score Table\n\n*(no features exercised)*';
  return ['## Section 1: Feature Score Table', '', header, sep, ...rows].join('\n');
}

function section3() {
  const lines = ['## Section 2: Unified Ticket List', ''];
  if (unified.length === 0) {
    lines.push('*No tickets found.*');
    return lines.join('\n');
  }
  for (const t of unified) {
    lines.push(`### TICKET-${t.id}: ${t.title}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Type | ${t.type} |`);
    lines.push(`| Severity | ${t.severity} |`);
    lines.push(`| Affected command | ${t.command} |`);
    lines.push(`| Persona(s) | ${t.personas} |`);
    lines.push('');
    lines.push(`**Description:** ${t.description}`);
    lines.push('');
    lines.push(`**Proposed fix:** ${t.fix}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

function section4() {
  const lines = ['## Section 3: Condensed Workflow Traces', ''];
  for (const p of PERSONAS_SHORT) {
    const summary = workflows.get(p) || '*(summary not available)*';
    lines.push(`**${p}:** ${summary}`);
    lines.push('');
  }
  return lines.join('\n');
}

const doc = [
  '# Persona Findings',
  '',
  'Generated: 2026-04-15',
  'Personas evaluated: 14',
  `Total tickets (pre-dedup): ${allTickets.length}`,
  `Unique tickets (post-dedup): ${unified.length}`,
  '',
  '---',
  '',
  section2(),
  '',
  '---',
  '',
  section3(),
  '---',
  '',
  section4(),
].join('\n');

const findingsPath = join(ROOT, 'docs', 'persona-findings.md');
writeFileSync(findingsPath, doc, 'utf8');
console.log(`Written: ${findingsPath}`);

// ---------------------------------------------------------------------------
// 6. Strip ## Feature Requests & Findings from persona files
// ---------------------------------------------------------------------------

const personaDir = join(ROOT, 'agents', 'personas');
const personaFiles = readdirSync(personaDir)
  .filter(f => /^persona-\d{2}-/.test(f) && f.endsWith('.md'));

let stripped = 0;
for (const file of personaFiles) {
  const path = join(personaDir, file);
  const content = readFileSync(path, 'utf8');

  // Find the ## Feature Requests & Findings heading
  const marker = '\n## Feature Requests & Findings';
  const idx = content.indexOf(marker);
  if (idx === -1) {
    console.log(`  ${file}: no findings section found, skipping`);
    continue;
  }

  const trimmed = content.slice(0, idx).trimEnd() + '\n';
  writeFileSync(path, trimmed, 'utf8');
  console.log(`  ${file}: stripped findings section`);
  stripped++;
}

console.log(`\nDone. ${unified.length} unique tickets, ${stripped}/${personaFiles.length} persona files stripped.`);
