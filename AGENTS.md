# Working on Prompt Gallery (for AI agents and contributors)

Read [`README.md`](README.md) for what the app does, then this file before changing anything.
Deeper references: [`docs/spec.md`](docs/spec.md) (data format, screens, safety rules) and
[`docs/agent-integration.md`](docs/agent-integration.md) (`pgallery` CLI, skill, plugins).

## What it is

A local macOS app (Tauri 2) that keeps image prompts, the photos they need and the
results they produced, linked together, in a **library folder the user picks** (e.g.
`~/Pictures/Prompt Library`). The repo holds only the app; user data never lives in it.
**macOS only** for now (sips thumbnails, AppKit clipboard, `open -R`); don't add Windows/Linux
code paths unless asked.

## Layout

| Path | What |
|---|---|
| `src/` | The UI: plain HTML/CSS/JS, no framework, no build step, no network requests. `app.js` (screens, dialogs, tag manager), `prompt-cards.js` (stacked cards, drop on card), `result-tools.js` (source picker, multi-select, display names) |
| `src-tauri/src/library.rs` | **The only code that writes the library.** IDs, atomic writes, imports, thumbnails, Trash, tag lock and tag operations, display names. Tests in `library/tests.rs` |
| `src-tauri/src/commands.rs` | Tauri commands the UI calls (thin wrappers over `library.rs`), app config |
| `src-tauri/src/asset.rs` | Serves images and bounded video byte ranges (GET/HEAD), only from inside the current library |
| `src-tauri/src/native.rs` | macOS pasteboard: Copy image writes file URL + PNG; Copy video writes file URL only |
| `src-tauri/src/watcher.rs` | Watches the library, emits `library-changed` for live refresh |
| `src-tauri/src/cli.rs`, `bin/pgallery.rs` | `pgallery` CLI for agents; tests in `src-tauri/tests/cli.rs` |
| `skills/prompt-gallery/SKILL.md` | The agent skill (install the app, save generated images via `pgallery`) |
| `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/` | Plugin manifests for Claude Code and Codex; both point at the one `skills/` folder |
| `scripts/backup-r2.sh` | Optional off-site backup to an S3-compatible bucket |
| `tests/*.mjs` | UI tests with mocked IPC (need jsdom / Playwright installed outside the repo) |

## Rules that keep user data safe

- **Never write library files except through `library.rs`.** The CLI and the app both call it.
  Agents saving images must use `pgallery add`, never copy files into the library by hand.
- **Files are named by ID** (`YYYYMMDD-HHMMSS-xxxx`), each image with a `<id>.json` beside it.
  Results link to photos by ID. Never rename or move these files; user-facing names are
  the optional extension-free `name` field (falls back to the stem of `originalName` for sources, date for results).
- Imports **copy**, never move. Saves are **atomic** (temp file + rename). Deletes go to the
  **macOS Trash**. The app never writes outside the library except its config file
  (`~/Library/Application Support/com.ribin.prompt-gallery/config.json`).
- Read-modify-write of `library.json` (tag vocabulary and virtual folders) goes through `TagLock`
  (`.prompt-gallery.lock`), shared by the app and `pgallery`. Tag remove/rename/merge edit every
  record under that lock and must never delete images or prompts.
- Hidden entries (`.DS_Store`, dotfiles) are ignored in all scans.
- Don't change the on-disk format without updating `docs/spec.md`, the loader's backward
  compatibility (old JSON must still load) and the tests.
- When testing, use temp folders and `PROMPT_GALLERY_CONFIG_DIR` / `--library`. Never touch a
  real library, the real config, or `/Applications` from tests.

## Commands

```bash
make dev                        # run the app (live-reloads the UI)
make build                      # release .app in src-tauri/target/release/bundle/macos/
make install-cli                # cargo install pgallery into ~/.cargo/bin
cd src-tauri && cargo test      # Rust tests (library + CLI)
cd src-tauri && cargo build     # must stay warning-free
```

To update an installed copy: quit the app, then replace `/Applications/Prompt Gallery.app` with
the new bundle (`ditto`), and rerun `make install-cli` if the CLI changed.

## Backup script (`scripts/backup-r2.sh`)

Settings in `~/.config/prompt-gallery/r2-backup.env` (never committed). Behaviour:
- Mirrors the library to the bucket; uploads only new/changed files (`aws s3 sync`).
- Files deleted locally are **moved** to `deleted/<YYYY-MM-DD>/<path>` in the bucket, never erased.
  More than 100 at once needs `--force` (guards against pointing at the wrong folder).
- Skips `.thumbs/`, `.DS_Store`, the lock file and temp files. `--restore <empty dir>` downloads
  the current library without `deleted/`.
- launchd can't read scripts under `~/Desktop`, `~/Documents` or `~/Downloads` (macOS privacy),
  so a scheduled job should run a copy kept elsewhere, e.g. `~/.config/prompt-gallery/`.
  Re-copy it after changing the script.
- aws-cli to `*.r2.cloudflarestorage.com` can fail with TLS errors through a local HTTPS proxy;
  launchd jobs don't inherit shell proxy variables.

## Pitfalls already hit

- The Codex sandbox can't write under `.agents/`; if a change there is needed, the agent leaves
  a patch to apply outside the sandbox.
- Headless Chromium and macOS automation are blocked in agent sandboxes, so UI layout changes
  are only covered by the jsdom tests; check them in the real app before calling them done.
- `tauri-cli` 2.9 sets an obsolete `STATIC_VCRUNTIME` variable; `build.rs` removes it on macOS to
  avoid a warning.
- The app restarted itself on first library choice in an early version; library switching now
  happens in-process through the guarded asset handler. Don't reintroduce `app.restart()`.

## Status

v1 plus agent integration, tag manager, compact dialogs, display names and the backup script.
Not done yet: a signed and notarized downloadable release (installs currently build from
source), and a Windows port (see README).

## Folders, videos and audio

- Sources have one optional `folder` ID; `library.json.folders` defaults to empty. Unknown IDs
  appear as Unfiled. Create/rename/delete/move use the shared `TagLock`; never move media files.
- Folder names are trimmed, case-insensitively unique, 1–100 characters. Deleting a folder
  clears memberships and preserves all media. Multi-record changes can partially complete on I/O failure.
- Images omit `kind`; videos use `kind: "video"` and audio uses `kind: "audio"` and optional `durationSeconds`. Accept MP4,
  MOV, M4V, MP3, M4A, AAC, WAV, AIF/AIFF and FLAC wherever paths are imported; paste remains images only.
- Video and audio posters use Quick Look followed by sips with one shared eight-second deadline.
  Timed-out children are killed and reaped; failure is nonfatal and displays a placeholder.
  Each missing video poster is attempted at most once per process/library/item, including
  imports and lazy loads; restart the app/CLI to retry a failure. Imports and library loads
  run on blocking workers in the app so native thumbnail work never runs on the UI thread.
- Unit tests skip native thumbnails. Every CLI integration-test child must set
  `PROMPT_GALLERY_DISABLE_POSTERS=1`; never run Quick Look against fake test videos.
  `scripts/check-video.sh` is the maintainer's isolated generated-video/import/range check.
  It skips native posters by default; opt in outside the sandbox with
  `PGALLERY_CHECK_REAL_POSTERS=1 bash scripts/check-video.sh` (bounded by the same timeout).
  Duration is best-effort via mdls and retried during loading without rewriting old metadata.
- Asset ranges support single bounded/open/suffix requests and 416. All streamed-media responses and open
  ranges are capped at 4 MiB. HEAD returns full metadata without reading a body.
- Tests must stay in temp libraries. Native Quick Look and drag/drop require a real-app check
  when unavailable in the sandbox. No new dependencies are required.

- Audio shares bounded poster attempts and best-effort duration with video. Missing cover art
  uses a name-hashed music-note tile; audio previews use native controls, and Copy audio copies
  only the file URL. Tests must never run Quick Look on fake audio.
- `bash scripts/check-audio.sh` generates a temporary WAV, imports source/result through the
  CLI and verifies a Range slice through the real handler. It disables native posters by default.
- The toolbar owns search; the sidebar label is Photos (internal `sources` IDs are unchanged).
  Main content is the page scroll container. Keep the title-bar traffic-light region clear.
