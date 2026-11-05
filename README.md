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

- **Prompts**: the text, where you found it, its categories, and what kind of photo it needs.
- **Photos**: your images, videos and audio, tagged and organized in virtual folders.
- **Results**: every image, video or audio file a prompt produced, with the source photo it used and a link back
  to the ChatGPT conversation.

Open a prompt, copy it, drag a photo from **Photos** into ChatGPT, and paste the result back
in.

![Prompt detail with copy button](docs/screenshots/prompt-detail.png)

### Copy a photo, paste it into ChatGPT

No more hunting for the original file in Finder or Photos. Open any photo, click
**Copy image** (or select it and press ⌘C), then press ⌘V in ChatGPT. The app puts the original
file on the clipboard, so ChatGPT gets the full-quality photo, HEIC included. Prefer dragging?
Drag the thumbnail straight into the chat instead.

![Source photo with Copy image, ready to paste into ChatGPT](docs/screenshots/copy-image.png)

## Features

**Prompts**
- **Prompt grid with stacked results.** Each card shows a prompt's newest results as a little
  pile with a count. Drop files onto a card to add results to it.
- **Categories** to find prompts fast (Design, Story, Sticker…), with one-click **Copy prompt**
  and **Favorites**.
- **Needs**: the kind of photo a prompt wants (single, couple, group…). Photos with those tags
  are listed first when you link results to the photos they came from.
- **Add results fast**: paste a copied image with ⌘V, drop files, or pick them. A ChatGPT link on
  your clipboard is filled in automatically, so **Open chat** takes you back later.

**Photos**
- **Images, videos and audio**: JPG, PNG, WEBP, HEIC, GIF, MP4, MOV, M4V, MP3, M4A, AAC, WAV,
  AIF/AIFF and FLAC. Videos and audio play inside the app; posters show the duration.
- **Folders** (one level) for where a photo came from, and **tags** for what's in it. Tags and
  categories are separate lists, so tidying one never touches the other.
- **An inspector for every photo and result**: large preview, inline name (no file extension),
  folder menu, tag chips with autocomplete, note, and the results it was used in.
- **Copy or drag the original into ChatGPT** (⌘C, **Copy image**, or drag the thumbnail).

**Finding things**
- **Stack filters**: click tags in the sidebar to combine them (**Libin** + **Family** shows only
  photos with both); click a tag again to drop it, or **All tags** to clear. Categories work the
  same way on the Prompts side.
- **Search** titles, prompt text, names, notes, tags and categories (⌘F).
- **Manage tags / Manage categories**: add, rename, merge or remove. Photos, prompts and results
  are never deleted.

**Everywhere**
- Native-feeling Mac window with an integrated title bar, light and dark mode, and an agent CLI
  (`pgallery`) for saving AI output from Claude Code or Codex.

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
  it can only show or play files from inside the current library.
- **Older libraries upgrade themselves**: when you open one, prompt style tags become
  categories and your photo tags stay as they are. Nothing is renamed or moved.

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
2. **Add photos.** In **Photos**, drop, paste or pick files. Put them in folders by where they
   came from (Camera, AI characters, References…) and tag what's in them (people, pets, shot
   type). Open a photo to rename it, change its folder or edit its tags.
3. **Create a prompt** with **+ New** (⌘N), or paste a block of text into an empty prompt grid.
   Give it a title, categories, and the kinds of photo it needs.
4. **Try it.** Open the prompt, click **Copy prompt**, then find a photo in **Photos** and send
   it to ChatGPT: drag it into the chat, or select it, press ⌘C and paste there.
5. **Save the results.** Copy the generated image in ChatGPT and press ⌘V in the prompt, or drop
   the files onto the prompt card. Click the photos you used and keep the chat link.
6. **Organize.** Click **Edit** next to **Categories** (on Prompts) or **Tags** (on Photos) to
   rename, merge or remove them. Removing a photo tag also removes it from prompt needs;
   categories only affect prompts.
7. **Come back later.** Filter, search, open a result full size, and use **Open chat** to jump
   back into the conversation.

| Shortcut | Does |
|---|---|
| ⌘N | New prompt |
| ⌘Enter | Submit the open form |
| ⌘F | Search |
| ⌘V | Paste an image into the current view |
| ⌘C | Copy the selected photo |
| ← → | Step through results in the full-size view |
| Esc | Close a dialog or the full-size view |

Dialogs keep **Cancel** and **Save** next to the title; ⌘Enter saves and Esc cancels.
Tag and category changes save each record atomically; if a write fails, the app reports how many
records were already updated.

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
pgallery add --prompt-file /tmp/prompt.txt --result /tmp/generated.png --model "image-tool" --categories Portrait --json
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
  requests. `controls.js` holds the shared folder menu and tag fields.
- **`src-tauri/`**: the Rust side, which does all file work through a small set of commands:
  - `library.rs`: storage, imports, thumbnails, Trash.
  - `commands.rs`: the commands the interface calls.
  - `asset.rs`: serves images, and video and audio byte ranges, only from the current library.
  - `cli.rs`: the `pgallery` command-line tool.
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
