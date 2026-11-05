# Prompt Gallery — spec (v1)

A local macOS app for collecting AI image prompts, the photos you feed them, and
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
   (tags)                (chat URL)             (text, categories)
```

- **Source photo**: an original image of yours, tagged by what it shows.
- **Prompt**: the prompt text and its categories. Any source photo works with any prompt.
- **Result**: an image a prompt generated, remembering which source photo(s) it used and
  the ChatGPT conversation it came from.

The result source picker lists every photo in library order.

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
  library.json                 { "app": "prompt-gallery", "version": 1, "tags": [...], "categories": [...] }
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
{ "id": "…", "file": "<id>.jpg", "originalName": "IMG_1234.jpg", "name": "Kujira in a bucket",
  "tags": ["single"], "note": "", "createdAt": "2026-11-04T21:30:15+08:00" }
```

`prompts/<id>/meta.json`
```json
{ "id": "…", "title": "Pixar-style family portrait",
  "categories": ["3d", "cute"], "sourceUrl": "https://… (where I found it)",
  "notes": "", "favorite": false,
  "createdAt": "…", "updatedAt": "…" }
```

`prompts/<id>/results/<id>.json`
```json
{ "id": "…", "file": "<id>.png", "name": "Watercolor Kujira", "sourcePhotos": ["<source id>"],
  "chatUrl": "https://chatgpt.com/c/…", "model": "ChatGPT", "note": "",
  "favorite": false, "createdAt": "…" }
```

- Source and result `name` is optional. Trim whitespace; reject more than 200 Unicode
  characters. Empty names clear the field (omitted from JSON). Existing records without
  `name` load without rewriting. Display a non-empty custom name, otherwise the source
  `originalName` or the result date. `originalName`, IDs, filenames, thumbnails and links
  never change when renaming. Search includes custom names and source original filenames;
  result names also find their containing prompt.
- Source `tags` use one vocabulary. Built-in tags: `single`, `couple`,
  `group`, `pet`, `landscape`, `character-sheet`, `object`. Users can add, remove, rename or merge their own tags; the
  full list is stored in `library.json` under `tags`.
- Legacy `needs` (retired 2026-11-05): older prompts may still have a `needs` array of photo
  tags. It loads, is preserved on save and follows tag rename/remove, but the app neither shows
  nor edits it and the CLI no longer writes it.
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

**Sidebar**: two sections, **Prompts** and **Photos**; a search box; tag filter
chips; a "Favorites" filter. Filter chips toggle: clicking a tag adds it, clicking it again
removes it, and "All" clears them. Several selected tags combine with AND (an item must have
every selected tag).

**Prompts view**: a grid of prompt cards showing the title and categories. A card with
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
**Add result** form as prompt detail, asking for photos used and prefilling a
chatgpt.com chat URL from the clipboard. Adding from the grid keeps the user in the grid.
Search matches title, prompt text, tags and notes. The data model is unchanged.

**Prompt detail** (opens when a card is clicked):
- Title and the full prompt text, with a big **Copy prompt** button (shows "Copied").
- Edit button: edit title, text, categories, source URL, notes.
- **Try with another photo**: collapsed by default (open state remembered in
  `gallery-try-open`). Opened, it shows a name search, photo-tag chips with counts (selected
  tags combine with AND; **All** clears) and a grid of every matching photo. Clicking a photo
  selects it (⌘C copies the original; Add result pre-links it); dragging starts a native drag
  into other apps. A second **Copy prompt** button sits in the panel header.
- **Results**: a grid of this prompt's results. Click opens a lightbox (arrow keys to step
  through, Esc to close) showing the image, its source photo(s), date, note and an
  "Open chat" link that opens `chatUrl` in the default browser. Linked photos appear
  as clickable thumbnails that open their source detail. **Select**, Cmd-click, and
  Shift-click enable multi-selection; **Set photos…** replaces the source links on
  every selected result while preserving chat URL, model, note, and favorite status.
- **Add result**: paste (Cmd+V), drop files, or pick files. After adding, a small form
  asks for the source photo(s) used (pre-filled with the photo last picked in the Try panel)
  and the chat URL (pre-filled from the clipboard if it's a chatgpt.com URL). Add/Edit result
  and batch linking share a grid of thumbnail toggles (accent ring and check when selected),
  listing every photo in library order.

**New prompt** (Cmd+N): title, prompt text, categories, source URL, notes. Saving creates the
folder. Pasting a long block of text into the empty grid also opens this form with the
text filled in.

**Photos view**: a one-level virtual folder grid with newest-item covers, counts, Unfiled (when nonempty), and New folder. Folder items have a root breadcrumb. Search/tag filters show a flat cross-folder list with folder labels. Add via paste, drop or
picker; imports inside a folder inherit it. Select/Cmd/Shift selection supports Move to…; folder menus support Rename and Delete. Deletion moves memberships to Unfiled and keeps media. Newly added photos open a tag picker straight away. Click a photo to edit its name, tags
and note, see which results used it, reveal it in Finder, or delete it.

**Empty and first-run states**: first launch shows "Choose a library folder" with the
suggested default and a short line about why the data lives outside the app.

## Import and export

- **Pick files**: native file dialog, multiple selection, images and videos
  (jpg, jpeg, png, webp, heic, gif, mp4, mov, m4v; case-insensitive).
- **Drop files**: Tauri's drag-drop event (it gives real file paths). Dropping on the
  Photos view adds sources; dropping on a prompt adds results.
- **Paste**: an image on the clipboard (e.g. copied from ChatGPT) is read in the frontend and
  sent to the backend as bytes, saved as PNG.
## Using a source photo (getting it into ChatGPT)

Photos are always sent from the library itself; the app never exports copies to another
folder. On any source photo thumbnail (the Photos grid):

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
  rejects external paths, symlinks, traversal, and extensions outside the media whitelist. This replaces the stock additive
  asset-scope responder so first choice and library switches require no process restart.
  Automatic scope grants from file drops cannot bypass the current-root check.

### Tag management and form dialogs

The sidebar **Manage tags** button opens a compact list with an Add tag field, usage
counts, Rename and Remove. Counts include tags found only in metadata; each prompt counts
once when its `needs` contains the name. Counting does not require intact
images, prompt text or results and does not populate the vocabulary.

Remove strips the name from `library.json.tags`, source `tags`, and prompt `needs`. Categories remain unchanged.
Rename replaces it in all those fields; an existing destination merges with stable
per-field deduplication. Empty names are rejected. Metadata fields and media stay intact.
The dialog confirms removal inline and requires a second confirmation before merging.
After mutations it refreshes usage and the library, clears a removed active filter, and
follows a renamed filter. An orphan tag can be managed even if absent from the vocabulary.

`tag_usage`, `remove_tag`, and `rename_tag` acquire `TagLock`. Mutations write records
atomically, then save the vocabulary last; they return photo/prompt counts and skipped-file
warnings. The lock lease is renewed during scanning and between writes. A failed write stops the operation and
reports earlier completed records; it does not roll them back. A directory-sync failure
can occur after the failed record's rename, so the error also explains that uncertainty.
Unreadable or unsafe metadata is skipped with a warning, like the loader. Existing record
writers are not globally serialized by this lock; do not run concurrent record edits/imports
while managing tags. After the one-time migration, loading never reconstructs either vocabulary from records. `set_tags`
remains additive, and CLI adds only explicitly supplied tags to it.

Form dialogs keep Cancel and the primary submit action in a fixed header. Errors are
visible below the title, outside the form's scroll area. Enter in single-line inputs and
Cmd+Enter submit; Esc cancels. The prompt textarea starts at four rows and grows to about
12, then scrolls internally. Categories and
source URL share a row; notes use two rows. Source previews and result-photo pickers are
shorter. Source and result edit forms begin with a Name field prefilled with the display
name without a matching extension. A source with a custom name shows its original filename stem underneath. Saving an
untouched fallback does not store it as a custom name. At small window sizes only the body scrolls, leaving actions visible; the tag
manager scrolls its list. Light and dark mode retain the system-blue Photos-neutral style.
The layout target is a new prompt with about 15 tags fitting at 1200×800; the browser smoke
test checks that target and header visibility at 800×560.

### Backend commands (Rust)

| Command | Does |
|---|---|
| `get_config` / `set_library(path)` | Read config; open or initialise a library |
| `pick_library_folder` | Native folder picker |
| `load_library` | Scan and return all sources, prompts and results |
| `import_sources(paths, tags)` | Copy files into `sources/`, write JSON, make thumbnails |
| `import_source_bytes(bytes, tags)` | Same, from pasted image data |
| `update_source(id, tags, note, name)` | Edit source metadata |
| `create_prompt(meta, text)` / `update_prompt(id, meta, text)` | Write prompt files |
| `add_results(promptId, paths \| bytes, sourcePhotos, chatUrl, note)` | Copy results in |
| `update_result(promptId, id, …)` | Edit result metadata |
| `trash_item(kind, id[, promptId])` | Move files to the macOS Trash |
| `reveal_in_finder(path)` | Show a file in Finder |
| `set_tags(tags)` | Add names to the tag vocabulary |
| `tag_usage` | Count photos/prompts per tag, including names absent from vocabulary |
| `remove_tag(tag)` | Strip the photo tag from sources and prompt needs; return changed-record counts and warnings |
| `rename_tag(from, to)` | Rename or merge sources and prompt needs; return changed-record counts and warnings |

Plugins and crates: `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-drag`,
`trash`, `serde`/`serde_json`, `chrono`, `rand`; `tempfile` for tests.

## Out of scope for v1

- Calling any image API from the app (generation stays in ChatGPT).
- Sync, accounts, sharing, a web version.
- Built-in backup to the cloud (documented as a manual step instead).
- Prompt variables / templates (e.g. `{subject}`) — a likely v2 feature.

## Backward-compatible folder and video metadata

`library.json` optionally contains `folders` (absent means `[]`):
```json
{"app":"prompt-gallery","version":1,"tags":[],"folders":[{"id":"20261105-120000-abcd","name":"Family","createdAt":"2026-11-05T12:00:00+08:00"}]}
```
Source JSON adds optional `folder`, a folder ID; missing/unknown IDs render as Unfiled.
There is one level and at most one membership per source. Results have no folder field.
Folders use the existing ID scheme, atomic JSON writes and `.prompt-gallery.lock` (`TagLock`).
Create/rename validate trimmed, nonempty names of at most 100 Unicode characters, unique
case-insensitively. Delete clears source memberships before removing the folder. Bulk moves
validate inputs before writing; I/O failures can leave earlier changes applied and are reported.

Both source and result JSON support:
```json
{"kind":"video","durationSeconds":1.25}
```
These are additional fields alongside existing metadata. Images omit both fields; absent kind
means image. `durationSeconds` is optional, finite and nonnegative, measured by mdls when
available, retried in loaded records if missing (no migration writes). Original media bytes,
IDs and paths are unchanged. Legacy `name` fields are displayed without the matching file
extension; saving stores a trimmed stem, limited to 200 characters. `originalName` is preserved.

Video thumbnails run `qlmanage -t -s 480 -o <private scratch dir> <file>`, convert its poster
with sips to `.thumbs/<id>.jpg`, and remove scratch output. Quick Look and sips share an
8-second deadline: spawn, poll `try_wait`, kill on timeout, and reap before cleanup. Child
stdio is discarded to prevent pipe stalls. Failure never fails an import. A process-local,
thread-safe set keyed by the library thumbnail path limits missing video posters to one
attempt per process, whether triggered by import or lazy loading; restart to retry failures.
App imports and library loads run through `spawn_blocking`, keeping native thumbnail work
off the UI thread. Unit tests skip real thumbnails, and CLI integration-test processes set
`PROMPT_GALLERY_DISABLE_POSTERS=1`. The generated-video maintainer script disables native
posters unless `PGALLERY_CHECK_REAL_POSTERS=1` is explicitly supplied. Cards never use video originals as image fallback. Video
previews use `<video controls preload="metadata">` with no autoplay; closing pauses playback.
Copy video puts only the original file URL on NSPasteboard; image copy also supplies PNG.

Asset requests are GET/HEAD only. Video MIME types are video/mp4, video/quicktime and
video/x-m4v. All successful responses advertise Accept-Ranges: bytes. Single ranges support
start-end, start-, and -suffix forms, returning 206 with Content-Range and Content-Length.
Invalid/unsatisfiable or multiple ranges return 416 with `bytes */<length>`. Open ranges are
capped at 4 MiB. Initial video GETs larger than 4 MiB return the first bounded 206 segment;
explicit bounded/suffix ranges read only the requested slice, capped at 4 MiB as well. HEAD ignores Range and reports
the complete representation length with no body read. Current-library guards apply before reads.

Commands added: `create_folder(name)`, `rename_folder(id,name)`, `delete_folder(id)`,
`move_sources(ids,folder)` (null means Unfiled). All storage mutation stays in library.rs.

## Compact macOS shell and audio

The Overlay title bar hides the native title. Traffic lights occupy the reserved 48 px
sidebar top; toolbar and sidebar chrome expose Tauri drag regions with only start-dragging
permission. Photos replaces the source-section label; internal `sources` IDs remain unchanged.
Search and primary/secondary actions share one toolbar. Only the main pane scrolls at page
level; long prompt text and modal lists can scroll internally. Cards use square covers and
two compact caption lines. Tags use stable name-hashed palette dots and usage counts
(photos in Photos; prompts in Prompts and Favorites). The six most-used
tags appear first; expansion is stored with guarded localStorage access.

Audio imports accept `.mp3`, `.m4a`, `.aac`, `.wav`, `.aif`, `.aiff` and `.flac`,
case-insensitively, in every file-import path, including CLI sources/results. No audio paste.
Source/result metadata adds `"kind":"audio"` with optional `durationSeconds`; missing kind
still means image and old records load without migration. Original files are copied unchanged.
Audio uses the existing bounded Quick Look/sips poster attempt (shared eight-second deadline,
once per process/library/item). No cover is required: a name-hashed music-note tile is used.
Tests disable native posters. Duration uses best-effort mdls, just like video.

Audio MIME types: MP3 `audio/mpeg`, M4A `audio/mp4`, AAC `audio/aac`, WAV `audio/wav`,
AIF/AIFF `audio/aiff`, FLAC `audio/flac`. Audio and video use the same guarded streamed-media
handler: GET/HEAD, single ranges, 206/416 and a 4 MiB response cap. Audio previews show a
cover with `<audio controls preload="metadata">` beneath it, without autoplay. Closing
pauses playback. Copy audio puts only the original file URL on NSPasteboard; drag-out uses
the original file and a cover or app-icon drag preview. Tags, folders, source/result linking,
Trash, backup and live refresh follow existing media behavior.

## Independent photo tags and prompt categories

`Library` IPC includes `tags: string[]` and `categories: string[]`. Prompt metadata stores
`categories: string[]`; legacy `tags` is read only as a fallback when `categories` is absent.
If both keys exist, categories wins (even an empty array). New prompt writes omit `tags`,
including raw metadata writes during vocabulary operations. No bulk prompt migration occurs.
Names are trimmed, empty names dropped, and duplicates removed case-insensitively in order.

When `library.json.categories` is absent, scan metadata in sorted path order. Categories is
the first-seen union of prompt categories (legacy tags). Photo tags retain existing
names except prompt-only style names, then append missing source tags and prompt needs (builtins the user removed are not re-added).
Unused custom photo vocabulary is preserved. Prompt-only
style names leave the tag vocabulary. Persist once using TagLock and an atomic write; a busy
lock or unwritable library still loads the same computed vocabularies in memory. The next
vocabulary write persists both. An existing empty categories array is already migrated;
removed names are never resurrected. Prompt text, IDs, media and results remain untouched.

`set_categories(categories)`, `category_usage`, `rename_category(from,to)` and
`remove_category(tag)` mirror the tag commands. Usage rows have `tag`, `sources` (zero for
categories), and `prompts`. Tag prompt counts refer only to needs; tag mutations edit sources
and needs, never categories. Category mutations edit prompts only. Rename to an existing
case-insensitive name merges. Operations use the shared lock, atomic record writes, warnings
and partial-progress reporting; they never delete prompts or media.

Prompts and Favorites show Categories; Photos shows Tags. Sidebar counts exclude needs:
prompts per category, photos per tag. Each view retains its filter. Expansion keys are
`gallery-categories-collapsed` and `gallery-tags-collapsed`, defaulting to expanded.
The shared manager adapts its heading, counts and confirmations. Prompt Categories tokens
suggest only categories; photo Tags suggest only photo tags. Prompt detail shows category
badges only. Search matches prompt categories and photo tags.
