# Prompt Gallery — spec (v1)

A local macOS app for collecting AI image prompts, the source photos you feed them, and
the images they produced. Built with Tauri 2, like `retro-media-player`. Nothing is
uploaded anywhere; the app only reads and writes a folder on your Mac.

## The problem it solves

- Prompts found online end up scattered across renamed ChatGPT conversations.
- Testing a prompt needs the right kind of source photo (a solo portrait, a group, a pet,
  a landscape, a character sheet), and finding one in Photos takes ages.
- There is no single place to see what a prompt produced and copy it again.

## Core idea: three linked things

```
Source photo ──used by──▶ Result ◀──produced by── Prompt
   (tags)                (chat URL)             (text, "needs" tags)
```

- **Source photo**: an original image of yours, tagged by what it shows.
- **Prompt**: the prompt text, plus which kind of source photo it needs.
- **Result**: an image a prompt generated, remembering which source photo(s) it used and
  the ChatGPT conversation it came from.

Opening a prompt shows the source photos whose tags match what the prompt needs, so the
right photo is one click away.

## Repo vs library

- **The repo holds only the app.** No user data ever lives in it, so it can be public and
  anyone can use it for their own collection.
- **The library is a folder the user picks** on first launch (suggested default:
  `~/Pictures/Prompt Library`). It is never inside the repo, so `git clean`, re-cloning or
  deleting the project can't touch it.
- The chosen path is saved in the app config:
  `~/Library/Application Support/com.ribin.prompt-gallery/config.json`
  → `{ "libraryPath": "/Users/…/Prompt Library" }`.
- The user can switch libraries later (Library → Open other library…).

## Library layout (plain files are the source of truth)

```
Prompt Library/
  library.json                 { "app": "prompt-gallery", "version": 1, "tags": [...] }
  sources/
    <id>.<ext>                 the original photo, copied in unchanged
    <id>.json                  source metadata
  prompts/
    <id>/
      prompt.md                the prompt text, exactly as written (no frontmatter)
      meta.json                prompt metadata
      results/
        <id>.<ext>             a generated image, copied in unchanged
        <id>.json              result metadata
  .thumbs/                     generated thumbnails; safe to delete, rebuilt on demand
```

- Every file is readable without the app: open it in Finder, edit it in a text editor,
  or let Claude/Codex read it.
- There is no database in v1. The app scans the library on open and keeps an index in
  memory. That is fast enough for a few thousand items. A SQLite cache can come later, but
  it must always be rebuildable from these files.
- `library.json` marks a folder as a library. Opening a folder without it: if it's empty,
  initialise it; otherwise ask before turning it into a library.

### IDs

`YYYYMMDD-HHMMSS-xxxx` (local time + 4 random hex chars), e.g. `20261104-213015-a3f9`.
Sortable by date, readable in Finder, collision-safe for one person.

### Metadata

`sources/<id>.json`
```json
{ "id": "…", "file": "<id>.jpg", "originalName": "IMG_1234.jpg",
  "tags": ["single"], "note": "", "createdAt": "2026-11-04T21:30:15+08:00" }
```

`prompts/<id>/meta.json`
```json
{ "id": "…", "title": "Pixar-style family portrait", "needs": ["group"],
  "tags": ["3d", "cute"], "sourceUrl": "https://… (where I found it)",
  "notes": "", "favorite": false,
  "createdAt": "…", "updatedAt": "…" }
```

`prompts/<id>/results/<id>.json`
```json
{ "id": "…", "file": "<id>.png", "sourcePhotos": ["<source id>"],
  "chatUrl": "https://chatgpt.com/c/…", "model": "ChatGPT", "note": "",
  "favorite": false, "createdAt": "…" }
```

- `needs` and source `tags` share one vocabulary. Built-in tags: `single`, `couple`,
  `group`, `pet`, `landscape`, `character-sheet`, `object`. Users can add their own; the
  full list is stored in `library.json` under `tags`.
- A prompt with `needs: []` is text-only (no source photo).
- If a result references a source photo that was deleted, the result still shows, with
  "source photo missing".

## Safety rules (the library is the database)

1. **Import always copies.** The original file is never moved or modified.
2. **Delete never hard-deletes.** Deleting a source, prompt or result moves its files to the
   macOS Trash, so it can be put back from Finder.
3. **Writes are atomic.** JSON and `prompt.md` are written to a temp file in the same folder
   and renamed into place, so a crash can't leave a half-written file.
4. **The app never deletes the library folder** and never writes outside it (except its own
   config file).
5. Corrupt or unreadable JSON is skipped with a warning listing the file, never deleted or
   overwritten.

Backups are the user's job, documented in the README: Time Machine, plus optionally
syncing the library to private cloud storage. iCloud Drive is not a backup (deletions sync,
and "Optimize Mac Storage" evicts originals).

## Screens

One window, native macOS title bar, follows system light/dark mode.

**Sidebar**: two sections, **Prompts** and **Source photos**; a search box; tag filter
chips; a "Favorites" filter.

**Prompts view**: a grid of prompt cards showing the title and `needs` tags. A card with
no results keeps a text placeholder; one result shows a single flat thumbnail. With two
or more results, show a small photo stack of the newest three results at most: newest on
top, with up to two older thumbnails peeking out behind, slightly offset and rotated
(e.g. -4° and +3°). A corner badge shows the total result count. On hover or keyboard
focus, the stack fans out slightly using CSS transform transitions; reduced-motion
preferences keep it still. Load thumbnails from `.thumbs/`, never full-resolution
originals in these cards, and render at most three preview images per card.

Each prompt card is a drop target for image files. Hit-test Tauri's drag-drop cursor
position against the card (converting physical coordinates to CSS pixels), highlight it
while hovered during a drag, and add the dropped files to that prompt. A small **+**
button appears on hover or keyboard focus and opens the image picker for that prompt.
**Cmd+V** pastes a clipboard image into the hovered card, or the focused/selected card
when no card is hovered; a card gains selection through focus or pointer interaction.
Clicking the main card still opens prompt detail. All three import paths open the same
**Add result** form as prompt detail, asking for source photos used and prefilling a
chatgpt.com chat URL from the clipboard. Adding from the grid keeps the user in the grid.
Search matches title, prompt text, tags and notes. The data model is unchanged.

**Prompt detail** (opens when a card is clicked):
- Title and the full prompt text, with a big **Copy prompt** button (shows "Copied").
- Edit button: edit title, text, needs, tags, source URL, notes.
- **Suggested source photos**: a strip of source photos whose tags intersect `needs`,
  newest first. Needs match **any** selected tag. If none match and the library has sources,
  offer **Show all source photos** in place. Photos can be dragged out; **Reveal in Finder**
  is available in the right-click menu, without a repeated button or hover tooltip.
- **Results**: a grid of this prompt's results. Click opens a lightbox (arrow keys to step
  through, Esc to close) showing the image, its source photo(s), date, note and an
  "Open chat" link that opens `chatUrl` in the default browser. Linked source photos appear
  as clickable thumbnails that open their source detail. **Select**, Cmd-click, and
  Shift-click enable multi-selection; **Set source photos…** replaces the source links on
  every selected result while preserving chat URL, model, note, and favorite status.
- **Add result**: paste (Cmd+V), drop files, or pick files. After adding, a small form
  asks for the source photo(s) used (pre-filled with the last one picked from the strip)
  and the chat URL (pre-filled from the clipboard if it's a chatgpt.com URL). Add/Edit result
  and batch linking share a grid of thumbnail toggles (accent ring and check when selected),
  showing photos matching any prompt needs-tag first, then the remaining photos.

**New prompt** (Cmd+N): title, prompt text, needs, tags, source URL. Saving creates the
folder. Pasting a long block of text into the empty grid also opens this form with the
text filled in.

**Source photos view**: a grid of thumbnails, filterable by tag. Add via paste, drop or
picker; newly added photos open a tag picker straight away. Click a photo to edit its tags
and note, see which results used it, reveal it in Finder, or delete it.

**Empty and first-run states**: first launch shows "Choose a library folder" with the
suggested default and a short line about why the data lives outside the app.

## Import and export

- **Pick files**: native file dialog, multiple selection, images only
  (jpg, jpeg, png, webp, heic, gif).
- **Drop files**: Tauri's drag-drop event (it gives real file paths). Dropping on the
  Source photos view adds sources; dropping on a prompt adds results.
- **Paste**: an image on the clipboard (e.g. copied from ChatGPT) is read in the frontend and
  sent to the backend as bytes, saved as PNG.
## Using a source photo (getting it into ChatGPT)

Photos are always sent from the library itself; the app never exports copies to another
folder. On any source photo thumbnail (the Source photos grid and the suggested strip on a
prompt):

| Action | Does |
|---|---|
| Click | Select it and show a larger preview. Never jumps to Finder. |
| Drag | Drag the original file out into another app (ChatGPT in a browser or its Mac app). Uses `tauri-plugin-drag`. |
| Cmd+C / "Copy image" button | Put the photo on the clipboard to paste into ChatGPT with Cmd+V. |
| Right-click | Context menu: Copy image, Reveal in Finder, Edit tags, Move to Trash. |

Drag and copy are both primary paths: drag when the windows sit side by side, copy when
ChatGPT is full screen or on another desktop.

**Copy image** writes both representations to the macOS pasteboard in one go: the file URL
of the original (like copying in Finder, so apps that accept files get the untouched
original) and PNG image data (for apps that only accept pixels). This needs a small native
pasteboard call from Rust (e.g. `objc2-app-kit`'s `NSPasteboard`, writing an `NSURL` and
`NSImage`), because the web clipboard API can only write pixels. Show a brief "Copied"
confirmation. Whether ChatGPT in Chrome, Safari and its Mac app takes the file or the
pixels must be tested by hand and noted in the README.

If drag-out proves unreliable, keep Copy image and Reveal in Finder; never fall back to
exporting files.

## Thumbnails

Generated on import (and lazily for any image missing one) with macOS `sips`:
`sips -Z 480 -s format jpeg <in> --out .thumbs/<id>.jpg`. `sips` handles HEIC, so no image
crate is needed. Grids show thumbnails; the lightbox shows the original.

## Architecture

- `src/`: plain HTML/CSS/JS, no build step, no framework, no external requests
  (same approach as `retro-media-player`). Split into `index.html`, `styles.css`,
  `app.js` (and more modules if it grows).
- `src-tauri/`: Rust backend that owns all file I/O through custom commands. The frontend
  never touches the filesystem directly.
- Images are shown with Tauri's asset protocol (`convertFileSrc`). A guarded handler for
  the `asset` URI scheme checks the active canonical library root on every request and
  rejects external paths, symlinks, and non-images. This replaces the stock additive
  asset-scope responder so first choice and library switches require no process restart.
  Automatic scope grants from file drops cannot bypass the current-root check.

### Backend commands (Rust)

| Command | Does |
|---|---|
| `get_config` / `set_library(path)` | Read config; open or initialise a library |
| `pick_library_folder` | Native folder picker |
| `load_library` | Scan and return all sources, prompts and results |
| `import_sources(paths, tags)` | Copy files into `sources/`, write JSON, make thumbnails |
| `import_source_bytes(bytes, tags)` | Same, from pasted image data |
| `update_source(id, tags, note)` | Edit source metadata |
| `create_prompt(meta, text)` / `update_prompt(id, meta, text)` | Write prompt files |
| `add_results(promptId, paths \| bytes, sourcePhotos, chatUrl, note)` | Copy results in |
| `update_result(promptId, id, …)` | Edit result metadata |
| `trash_item(kind, id[, promptId])` | Move files to the macOS Trash |
| `reveal_in_finder(path)` | Show a file in Finder |
| `set_tags(tags)` | Save the tag vocabulary |

Plugins and crates: `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-drag`,
`trash`, `serde`/`serde_json`, `chrono`, `rand`; `tempfile` for tests.

## Out of scope for v1

- Calling any image API from the app (generation stays in ChatGPT).
- Sync, accounts, sharing, a web version.
- Built-in backup to the cloud (documented as a manual step instead).
- Prompt variables / templates (e.g. `{subject}`) — a likely v2 feature.
