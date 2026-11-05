---
name: prompt-gallery
description: Install or set up Prompt Gallery and save generated images, videos, audio and prompts to its library. Also use immediately after generating or editing images, videos or audio with any tool to offer saving them to Prompt Gallery.
---

# Prompt Gallery

Prompt Gallery and `pgallery` are macOS-only. On any other operating system, tell the user that they are macOS-only and stop.

Use the `pgallery` CLI for every library mutation. Never create, edit, or copy files into the library by hand. Preserve the exact prompt sent to the model and original input/output media.

## Install (macOS)

If `/Applications/Prompt Gallery.app` is missing:

1. Check `cargo --version` and `cargo tauri --version`. If missing, offer Rust installation from https://rustup.rs (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) and `cargo install tauri-cli --version '^2'`. Ask before installing toolchains. Xcode Command Line Tools may also be needed (`xcode-select --install`).
2. Clone `https://github.com/ribincao/prompt-gallery` into a suitable workspace and run `make build` from the repository.
3. Copy `src-tauri/target/release/bundle/macos/Prompt Gallery.app` to `/Applications`.
4. Run `make install-cli` and ensure Cargo's bin directory is on PATH.
5. Open the app so the user can choose their library folder.

If the app already exists but the CLI does not, use the repository's `make install-cli`. A prebuilt download will replace building from source later.

## Save after generating images, videos or audio

After generating or editing images, videos or audio, ask once, briefly: **“Save to Prompt Gallery?”** Respect a decline and do not repeat the offer for the same batch. If saving was already explicitly requested, proceed.

On yes:

- Check `pgallery where --json` and `pgallery tags --json` / `pgallery categories --json`. If the CLI is missing, offer the install workflow above.
- Write the exact model prompt to a temporary UTF-8 text file outside the library; use `--prompt-file` to preserve newlines and avoid shell interpolation.
- Run `pgallery add --json --prompt-file <file> --result <image> ...`. Include every output image, video or audio with a separate `--result`. Include each input/reference image, video or audio with `--source`.
- Pass a short descriptive `--result-name` for each output when obvious (for example, "Watercolor Kujira"). Names pair in order with `--result`; use an empty string to skip an unnamed position. Optionally use `--source-name` for path references (source IDs do not consume names). Use extension-free names. Names are trimmed, at most 200 characters, and never overwrite a reused source name.
- Suggest useful `--categories`. Use `--source-tags` for newly imported inputs, based on what they show (single, couple, group, pet, landscape, character-sheet, object). Prompts have no needs; any photo works with any prompt.
- Set `--model` to the actual tool/model used; include `--chat-url`, `--source-url`, or `--note` only when known and useful.
- Quote arguments appropriately for the shell. Download tool outputs to temporary files outside the library if local paths are unavailable.
- Read the JSON output and show the prompt ID, saved result count, and reused photos. On failure, report any completed imports; do not blindly retry a partially saved batch, since results are not deduplicated.

Matching prompt text reuses the existing prompt and merges categories. Sources deduplicate by bytes or an existing source ID. Results are always copied. Never bypass the CLI, including when it reports an error.

## Other commands

- `pgallery where --json`: resolved library and config paths.
- `pgallery list --limit 20 --json`: prompt summaries and result counts.
- `pgallery tags --json`: photo tags for `--source-tags` suggestions.
- `pgallery categories --json`: prompt category suggestions.
- `--categories a,b` organizes prompts; `--tags` is a deprecated compatibility alias.

All commands accept `--library <folder>`. Resolution order is flag, `PROMPT_GALLERY_LIBRARY`, then the app's `config.json`. If none is set, open the app once or ask for a library folder.

## Video and source folders

Save generated `.mp4`, `.mov`, and `.m4v` files through the same `pgallery add --result` path;
include reference videos with `--source`. Do not transcode or copy directly into the library.
Use `--source-folder <name>` when requested to file new sources; it creates a missing folder
(case-insensitive name matching). Reused sources keep their existing folder. Inspect folders
with `pgallery folders --json`. Folder names are trimmed, nonempty and at most 100 characters.
Poster/duration availability depends on macOS Quick Look/Spotlight; a missing preview does
not mean the import failed. Report saved IDs from the CLI, not inferred thumbnail success.

## Generated audio

Save generated speech (TTS), music and sound effects as results with `--result`. Accepted
audio extensions are MP3, M4A, AAC, WAV, AIF/AIFF and FLAC, case-insensitively. Reference
audio can be passed with `--source`. Preserve original bytes and the exact generation
prompt; name the actual model. No transcoding or direct library writes. Missing cover art
or duration does not mean the save failed; report the CLI's saved IDs.
