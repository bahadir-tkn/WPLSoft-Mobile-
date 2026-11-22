# Security Summary

This document summarizes the security audit and hardening applied across the WPLSoft Web — Delta DVP PLC client application and desktop Electron wrapper.

## Reviewed Files

- **Core Parsers & Storage**: `src/core/storage.ts`, `src/core/ilParser.ts`, `src/core/quickCommand.ts`, `src/core/addressing.ts`, `src/core/scanner.ts`, `src/core/clipboard.ts`
- **UI & File Import/Export**: `src/components/modals/ProjectIoModal.tsx`, `src/components/ladder/CellEditModal.tsx`, `src/components/ladder/LadderCell.tsx`, `src/components/layout/OnlineSimBar.tsx`
- **Build, Environment & Desktop Runtime**: `electron/main.cjs`, `electron/package.json`, `vite.config.ts`, `index.html`, `package.json`, `.env.example`, `.github/workflows/deploy-pages.yml`, `.github/workflows/release-desktop.yml`

## Issues Resolved

| Area | Issue & Hardening Applied | Status |
| :--- | :--- | :--- |
| JSON Import (`src/core/storage.ts`) | Added strict key allowlisting (`__proto__`, `constructor`, `prototype` rejected + device address regex `/^[XYMTCD]\d{1,5}$/`) and `Object.defineProperty` assignment for `deviceComments`, plus field length and count caps (`MAX_DEVICE_COMMENTS`, `MAX_SAVED_ITEMS`). | Verified |
| IL Import (`src/core/ilParser.ts`, `src/components/modals/ProjectIoModal.tsx`) | Added UTF-8 byte cap (`512 KB`) and line count cap (`5000` lines) on IL text parsing and file uploads to prevent browser tab freezes from oversized inputs. | Verified |
| Electron Desktop Window (`electron/main.cjs`) | Enabled `webSecurity: true` and `allowRunningInsecureContent: false`, denied all device/browser permission requests via `setPermissionRequestHandler`, and blocked unexpected in-window `will-navigate` redirects outside `web-dist`. | Verified |
| Secrets & API Keys (`vite.config.ts`, `src/`, `.env.example`) | Audited all source files and build configuration; confirmed zero hardcoded API keys, tokens, or `process.env` secret leaks in the client bundle (`.env.example` contains only a non-secret placeholder). | Verified |
| Dev Dependency Audit (`package.json`) | Checked lockfile/audit; 2 moderate transitive advisories exist only in build-time `vite-plugin-pwa > workbox-build > glob/minimatch`, not shipped in the runtime browser bundle. | Documented |

## Safeguards Verified

- **Safe DOM & Template Rendering**: Zero usages of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write`, `eval`, or `new Function` across `src/`, `electron/`, and `index.html`.
- **Validated File Downloads**: Exported `.json`, `.il`, and `.txt` filenames pass through `sanitizeFileSlug()` stripping path separators and special characters.
- **Strict JSON Schema Validation**: `parseProgramJson()` enforces version `"1.0"`, allowed PLC models, bounded rung/row counts, column integrity, and valid Delta device address ranges before importing any project or reading from `localStorage`.

## PoC Verification

1. **JSON Prototype-Pollution Key Rejection (`src/core/storage.ts`)**:
   - **Malicious Input**: Raw JSON string containing `"deviceComments": {"__proto__": "polluted", "X0": "Start"}` or `{"constructor": "bad"}` or `{"<script>": "xss"}` passed to `parseProgramJson()`.
   - **Trace**: `parseProgramJson()` iterates `Object.entries(obj.deviceComments)`, tests each key against `FORBIDDEN_RECORD_KEYS` and `VALID_COMMENT_KEY_RE` (`/^[XYMTCD]\d{1,5}$/`), rejects `"__proto__"`, `"constructor"`, and `"<script>"` before any object property assignment occurs, and returns `{ success: false }`.
   - **Verified By**: Automated unit test `Security hardening: parseProgramJson rejects prototype-pollution keys and malformed deviceComments` in `src/core/core.test.ts` (passing).

2. **Oversized IL Payload Protection (`src/core/ilParser.ts`, `src/components/modals/ProjectIoModal.tsx`)**:
   - **Malicious Input**: File upload > `512 KB` in `handleLoadIlFile()` or multi-thousand-line string (> `5000` lines) passed to `parseIlToLadder()`.
   - **Trace**: `handleLoadIlFile()` checks `file.size > MAX_IL_INPUT_BYTES` before reading the file stream; `parseIlToLadder()` checks both UTF-8 byte length and line count before iterating instructions and immediately returns `{ success: false }`.
   - **Verified By**: Automated unit test `Security hardening: parseIlToLadder enforces MAX_IL_LINES bound` in `src/core/core.test.ts` (passing).
