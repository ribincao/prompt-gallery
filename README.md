<p align="center">
  <img src="app-icon.png" width="128" alt="Prompt Gallery icon">
</p>

<h1 align="center">Prompt Gallery</h1>

<p align="center">
  A local Mac app for the AI image prompts you collect, the photos you feed them,<br>
  and the pictures, videos and audio they make.
</p>

![Prompts view with stacked result cards](docs/screenshots/prompts.png)

## Why

You find a great image prompt online, try it in ChatGPT, and rename the chat so you can find
it again. A few dozen prompts later, nothing is findable. Every new test also means digging
through your photo library for the right kind of picture: a solo portrait, a group shot, your
cat, a landscape, a character sheet.

Prompt Gallery keeps all three things together and linked:

- **Prompts**: the text, where you found it, and what kind of source photo it needs.
- **Photos**: your images, videos and audio, tagged and organized in virtual folders.
- **Results**: every image, video or audio file a prompt produced, with the source photo it used and a link back
  to the ChatGPT conversation.

Open a prompt, copy it, drag a photo from **Photos** into ChatGPT, and paste the result back
in.

![Prompt detail with copy button](docs/screenshots/prompt-detail.png)

### Copy a photo, paste it into ChatGPT

No more hunting for the original file in Finder or Photos. Open any source photo, click
**Copy image** (or select it and press ⌘C), then press ⌘V in ChatGPT. The app puts the original
file on the clipboard, so ChatGPT gets the full-quality photo, HEIC included. Prefer dragging?
Drag the thumbnail straight into the chat instead.

![Source photo with Copy image, ready to paste into ChatGPT](docs/screenshots/copy-image.png)

## Features

- **Extension-free names.** Name fields and labels omit the file extension. Saving a matching
  extension strips it; original filenames and files remain untouched.
- **Virtual source folders.** Open Photos to see folder covers and counts. Create,
  rename, or delete folders; deleting a folder puts its items in Unfiled. Select items with
  Select, Cmd-click, or Shift-click and use Move to…. Drag to a folder target or the breadcrumb
  root (Unfiled). Imports inside a folder inherit it. Search and tag filters show matches
  across all folders with folder labels; clearing them returns to the folder grid.
- **Videos alongside images.** Import MP4, MOV and M4V as sources or results, including via
  `pgallery`. Posters show a play badge and duration when available. Open a video to play it
  with controls; Copy video copies its original file URL. Video paste is not supported.
  Quick Look creates posters within an eight-second budget; unavailable posters show a placeholder.
  Each video is attempted once per app session; restart to retry a failed poster.

- **Prompt grid with stacked results.** Each card shows a prompt's newest results as a little
  pile of photos with a count.
- **One-click Copy prompt.**
- **Needs.** A prompt can say what kind of photo it needs (`single`, `couple`, `group`, `pet`,
  `landscape`, `character-sheet`, `object`, or your own tags); photos with those tags are listed
  first when you link results to their source photos.
- **Copy and paste a photo into ChatGPT** with one click (or ⌘C), or drag it straight into the
  chat. No digging for the original file; you always send the original, and nothing is exported.
- **Add results fast**: paste a copied image with ⌘V, drop files onto a prompt card, or pick
  them. A ChatGPT link on your clipboard is filled in automatically.
- **Link results to photos** by clicking thumbnails, one result or many at once.
- **Independent categories and tags.** Categories organize prompts; tags organize photos.
  Search prompts by category and photos by tag, alongside title, text and notes; mark favorites.
- **Combine filters.** Click tags in the sidebar to stack them (for example **Libin** +
  **Family** shows only photos with both); click a tag again to drop it, or **All tags** to clear.
  Categories on the Prompts side work the same way.
- **Light and dark mode**, following the system.

## Your data stays yours

Everything lives in a **library folder you choose** on first launch, for example
`~/Pictures/Prompt Library`. It is never inside this repo, so the repo holds only the app and
anyone can use it for their own collection. Nothing is uploaded and there are no accounts.

The library is plain files you can open without the app:

```
Prompt Library/
  library.json          marks the folder as a library, holds photo tags and prompt categories
  sources/              your photos (copied in unchanged) + one .json each
  prompts/<id>/
    prompt.md           the prompt text, exactly as written
    meta.json           title, needs, categories, notes, source link
    results/            generated images + one .json each
  .thumbs/              thumbnails, safe to delete (rebuilt automatically)
```

Safety rules the app follows:

- **Importing always copies.** Your original files are never moved or changed.
- **Deleting moves to the macOS Trash**, so you can put things back from Finder.
- **Saves are atomic**: a crash can't leave a half-written file.
- **It never writes outside the library folder** (apart from its own small config file), and
  it can only display images and stream videos from inside the current library.

The library is a normal folder, so back it up like one. Time Machine covers it. iCloud Drive is
*not* a backup: deletions sync everywhere, and "Optimize Mac Storage" can remove originals.

### Off-site backup to a bucket (optional)

[`scripts/backup-r2.sh`](scripts/backup-r2.sh) copies the library to a private S3-compatible
bucket, such as Cloudflare R2 (10 GB free). The bucket mirrors your library: it uploads only new
or changed files, and anything you delete locally is **moved to `deleted/<date>/` in the bucket,
never erased**. A restore brings back just your current library, and deleted photos stay
recoverable. Thumbnails are skipped; the app rebuilds them.

1. Create a private bucket and an API token limited to it (R2: *Manage API tokens*, Object
   Read & Write), then install the AWS CLI (`brew install awscli`).
2. Put the settings in `~/.config/prompt-gallery/r2-backup.env` (`chmod 600`, never commit it):
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=your-bucket
   ```
3. Run `scripts/backup-r2.sh` (or `--dryrun` first). To run it daily, add a launchd job that
   calls the script; macOS runs a missed job when the Mac wakes up. Put the job's copy of the
   script outside `~/Desktop`, `~/Documents` and `~/Downloads`: macOS blocks background jobs
   from reading those folders.
   As a safety check, the script refuses to move more than 100 files to `deleted/` in one run
   (that usually means it's pointed at the wrong folder); pass `--force` if it's intended.

Restore into an empty folder with `scripts/backup-r2.sh --restore <folder>` (on a new Mac too:
copy the settings file over first), then choose that folder as the library in the app. To get
a deleted file back, copy it from `deleted/<date>/<path>` in the bucket to the same path in
your library. This is a one-way backup from one Mac, not live sync between several.

## Install and run (macOS)

There's no signed download yet; you build it yourself. You need:

- macOS with the Xcode Command Line Tools (`xcode-select --install`)
- [Rust](https://rustup.rs)
- Tauri CLI 2: `cargo install tauri-cli --version '^2'`

No Node.js is needed. The interface is plain HTML, CSS and JavaScript with no build step.

```bash
git clone https://github.com/ribincao/prompt-gallery.git
cd prompt-gallery
make build    # builds src-tauri/target/release/bundle/macos/Prompt Gallery.app
```

Drag `Prompt Gallery.app` into `/Applications`. Because the build isn't signed, macOS may block
the first launch: right-click the app, choose **Open**, then **Open** again.

Other commands:

```bash
make dev                     # run in development mode with live reload of the UI
make icon SRC=app-icon.png   # regenerate the icon set from a 1024×1024 PNG
make clean                   # remove build output
```

## How to use it

1. **Choose a library folder** on first launch. An empty folder (or a new one) works best.
   Switch later from **Library** at the bottom of the sidebar.
2. **Add photos.** Go to *Photos* and drop, paste or pick images, then tag them
   by what they show. A photo can have several tags. Open a photo for a two-column inspector with a media
   preview and details. Click its title to edit the display name; results have the same
   inspector under **Edit**. Enter or blur keeps a title edit; Esc reverts it. Names are trimmed and limited
   to 200 characters. Clear the field to restore the original filename stem (sources) or date
   (results). Renaming changes metadata only; files and links keep their IDs.
   Use **Folder** to choose a folder or **New folder…** to create one inline. The same
   menu appears in **Move to…**. Type in **+ Add tag** to choose or create tags; Enter or
   comma adds a chip, × removes it, and Backspace in an empty field removes the last chip.
   Arrow keys navigate suggestions and Esc closes the menu.
3. **Create a prompt** with **+ New** (⌘N). Paste the text, give it a title, and choose
   which kinds of photo it needs. Needs and categories use separate token fields. Pasting a long block of text into an empty prompt grid starts
   a new prompt for you.
4. **Try it.** Open the prompt, click **Copy prompt**, then find a photo in **Photos** (folders,
   tags or search) and send it to ChatGPT: drag it into the chat, or select it, press ⌘C and
   paste there.
5. **Save the results.** Copy the generated image in ChatGPT and press ⌘V in the prompt, or drop
   the files onto the prompt card. Click the photos you used and keep the chat link.
6. **Manage tags and categories.** Prompts and Favorites show **Categories** in the sidebar;
   Photos shows **Tags**. Click **Edit** to add, rename, merge or remove entries from the
   corresponding vocabulary. Categories affect prompts only; tags affect photos and prompt
   needs. Neither operation deletes photos, prompts or results. Each view remembers its own
   filter and expanded list. Category counts show prompts; tag counts show photos, with prompt
   needs counts also available in Manage tags.
7. **Come back later.** Search, filter by one or more categories or photo tags (click to add,
   click again to remove; items must match all of them), open a result full size, and use **Open chat** to
   jump back into the conversation.

| Shortcut | Does |
|---|---|
| ⌘N | New prompt |
| ⌘Enter | Submit the open form |
| ⌘F | Search |
| ⌘V | Paste an image into the current view |
| ⌘C | Copy the selected source photo |
| ← → | Step through results in the full-size view |
| Esc | Close a dialog or the full-size view |

Form dialogs keep **Cancel** and the primary action beside the title, with errors just
below. ⌘Enter saves the form; Esc cancels when no control is consuming it. Enter in a
name, folder-creation or tag field commits that edit; other single-line fields submit. Long content scrolls beneath the
header; long prompt text and tag-manager lists have their own scroll area.

Tag operations save each changed record atomically, but the whole operation is not a
transaction. If a write fails, the app reports how many records were already updated and
refreshes the library. Unreadable records are skipped with warnings; repair them before
retrying if you need those records included.

## Use it from an AI agent

Prompt Gallery and `pgallery` are macOS-only. Install the Claude Code plugin:

```text
/plugin marketplace add ribincao/prompt-gallery
/plugin install prompt-gallery@prompt-gallery
```

Install the Codex plugin:

```sh
codex plugin marketplace add ribincao/prompt-gallery
codex plugin add prompt-gallery@prompt-gallery
```

Both plugins use the same skill folder. As a manual fallback, copy `skills/prompt-gallery` into `~/.claude/skills/` or `~/.agents/skills/`.
The skill offers to save images after generation and uses the shared storage CLI:

```sh
make install-cli
pgallery add --prompt-file /tmp/prompt.txt --result /tmp/generated.png --model "image-tool" --tags portrait --json
```

Open the app once to choose a library, or pass `--library <folder>`. An empty existing
folder is initialized on the first add. The open app refreshes automatically.
See [agent integration](docs/agent-integration.md) for the CLI reference and config paths.

## Windows

**Prompt Gallery runs on macOS only for now.** It's built on [Tauri](https://tauri.app), which
supports Windows, so a port is realistic, but a few features call macOS directly:

| Feature | macOS implementation | What Windows would need |
|---|---|---|
| Thumbnails | the built-in `sips` tool | an image library such as the `image` crate |
| Reveal in Finder | `open -R` | `explorer /select,<path>` |
| Copy image (file + pixels) | AppKit pasteboard (`native.rs`) | the Win32 clipboard (`CF_HDROP` + bitmap) |
| Move to Trash | the `trash` crate | already cross-platform (Recycle Bin) |

With those swapped in, it would build on Windows with the same `cargo tauri build`, plus the
[Tauri Windows prerequisites](https://tauri.app/start/prerequisites/) (Microsoft C++ Build
Tools and WebView2). Pull requests are welcome.

## How it's built

- **`src/`**: the interface. Plain HTML, CSS and JavaScript, no framework and no network
  requests.
- **`src-tauri/`**: the Rust side, which does all file work through a small set of commands:
  - `library.rs`: storage, imports, thumbnails, Trash.
  - `commands.rs`: the commands the interface calls.
  - `asset.rs`: serves images and video byte ranges, only from the current library.
  - `native.rs`: the macOS clipboard.
- **`docs/spec.md`**: the full design: data format, screens and safety rules.

Run the checks:

```bash
cd src-tauri && cargo test && cargo build
```

The interface tests in `tests/` use jsdom and Playwright; see the comment at the top of each
file for how to run them.

## License

[MIT](LICENSE)

### Audio and compact browsing

Import MP3, M4A, AAC, WAV, AIF/AIFF and FLAC as sources or results. Photos contains
all source media. Audio shows embedded cover art when Quick Look supplies it, otherwise
a tinted music-note tile. Open it for playback controls; **Copy audio** copies the original
file URL. Audio paste is not supported. Duration is best-effort via Spotlight.

The integrated title bar holds search and view actions. Sidebar tags are ordered by usage,
with all tags shown by default and **Show less** to collapse to the top six; **Edit** opens tag management.
Square previews, one-line names and muted tags keep the grid compact in light and dark mode.

Existing libraries migrate their shared vocabulary on load: prompt style tags become categories,
while existing photo tags, source tags and prompt needs remain photo tags (removed builtins are not re-added). Prompt files convert from `tags`
to `categories` only when saved. A busy lock or read-only library uses the migrated vocabulary
in memory until it can be saved. New `library.json` files include `"categories": []` beside `tags`.
