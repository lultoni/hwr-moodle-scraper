# Tech Stack — HWR Moodle Scraper

- **Decision date**: 2026-03-26
- **Status**: DECIDED

---

## Runtime & Language

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20 LTS | LTS stability, first-class streams, native macOS support |
| Language | TypeScript 5 | Type safety for Moodle API response parsing, catches shape errors at compile time |
| Package manager | npm | Standard, no additional tooling required |

---

## Key Dependencies

| Purpose | Package | Notes |
|---------|---------|-------|
| macOS Keychain | `keytar` | Native binding, no repeated Keychain access dialogs on unsigned CLIs |
| HTTP client | `undici` | Modern, streams-native, no extra abstraction needed |
| CLI framework | `commander` | Typed subcommands and flags, well-maintained |
| Progress bars | `cli-progress` | Per-file bars + overall summary |
| Concurrency pool | `p-limit` | Simple semaphore, well-tested |
| HTML → Markdown | `turndown` | Reliable, extensible |
| Config file | `conf` or plain `fs` + JSON | Lightweight; `~/.config/moodle-scraper/config.json` |

---

## Testing

| Purpose | Package | Notes |
|---------|---------|-------|
| Test runner | `vitest` | Fake timers built-in (critical for rate-limiter/retry tests), fast, TypeScript-native |
| Assertions | `vitest` (built-in) | No separate assertion library needed |
| HTTP mocking | `msw` (or `undici` mock agent) | Intercepts at the fetch/undici level; no real network in tests |
| Filesystem mocking | `memfs` | In-memory filesystem for fs tests |

---

## Build & Distribution

| Purpose | Tool | Notes |
|---------|------|-------|
| Compile | `tsc` | Type-check only; no emit needed in dev |
| Bundle | `tsup` | Single-file CJS/ESM output for distribution |
| Binary | `package.json` `bin` field + `npm link` | `moodle-scraper` and `msc` aliases |

---

## Constraints Enforced by Tech Choices

- `keytar` requires `node-gyp` (native build). First-time setup: `npm install` will compile it. Requires Xcode Command Line Tools on macOS.
- All HTTP goes through the `undici`-based wrapper in STEP-004 — no bare `fetch` calls anywhere.
- TypeScript strict mode (`"strict": true`) is mandatory.
- Node.js 20+ is required (for `ReadableStream`, `crypto.subtle`, `fs/promises` stability).
