# Prompt Gallery

A local macOS app for keeping AI image prompts together with the source photos you feed
them and the images they produced. Built with [Tauri 2](https://tauri.app). Nothing is
uploaded; the app only reads and writes a library folder you choose.

Status: spec written, not built yet. See [`docs/spec.md`](docs/spec.md).

## Your data

Your photos and prompts live in a **library folder outside this repo** (you pick it on
first launch, e.g. `~/Pictures/Prompt Library`). The repo holds only the app, so it never
contains anyone's data.

The library is plain files and folders, so back it up like any other folder:

- **Time Machine** covers it automatically.
- For an off-site copy, sync it to private cloud storage now and then.
- iCloud Drive is not a backup: deletions sync everywhere, and "Optimize Mac Storage" can
  remove the originals from your Mac.

The app never hard-deletes: deleting anything moves it to the macOS Trash.
