# Agent integration

Prompt Gallery and `pgallery` are macOS-only. On other operating systems, the agent
skill explains this limitation and stops.

`pgallery` and the macOS desktop app call the same `library.rs` functions. Agents never
write library records themselves. No format or ID changes are introduced. Imports copy
original bytes; JSON and prompt writes use the existing atomic writer and path guards.

## Install

From a checkout, run `make install-cli`, equivalent to:

```sh
cargo install --path src-tauri --bin pgallery --locked
```

The desktop binary remains the Cargo default (`prompt-gallery`); Tauri bundles that app.
The CLI runs independently of the app, using the same storage code and macOS `sips`
thumbnail generation.

## CLI reference

Global options can appear before or after the command:

- `--library <dir>`: an existing library, or an empty existing folder for the first add.
- `--json`: compact JSON on stdout; failures are JSON on stderr with a nonzero exit.
  Warnings also go to stderr. Without the flag, successful output is pretty JSON.
- `where`: `{libraryPath, configPath}`; resolves paths without opening the library.
- `tags`: array of vocabulary strings.
- `list [--limit N]`: newest-updated prompts, each with `id`, `title`, `needs`,
  `tags`, and `resultCount`.
- `add`: saves one prompt and one or more generated results.

Options for `add`:

| Option | Meaning |
|---|---|
| `--prompt-text TEXT` / `--prompt-file PATH` | Exactly one; file is UTF-8, text retained exactly |
| `--title TEXT` | Default: first 40 Unicode characters after collapsing whitespace |
| `--needs a,b` | Input-photo categories |
| `--tags a,b` | Prompt tags |
| `--source-url URL` | Original prompt URL; used only for new prompts |
| `--result PATH` | Repeatable; at least one required |
| `--source PATH_OR_ID` | Repeatable input/reference images |
| `--source-tags a,b` | Tags applied to newly imported sources |
| `--chat-url URL` | Conversation URL on every result |
| `--model TEXT` | Result model; default `agent` |
| `--note TEXT` | Note on every result |

The response contains `promptId`, `created` (false means matched), `resultIds`,
`sourceIds` (unique), and `sources` (one `{id, reused}` per supplied source).
No CLI command deletes records. Multi-file imports are not transactions: an I/O failure
may leave earlier records saved. Inspect `list` before retrying; result imports do not
deduplicate.

## Matching, deduplication, and locks

Prompt comparison normalizes CRLF to LF and trims outer whitespace. Stored text is never
normalized. An existing match retains its title, text, URLs, notes, favorite and creation
date; only new needs/tags are merged (updating the modification timestamp when changed).
If multiple pre-existing prompts match, the newest-updated match is used.

A source ID must exist and have an accessible library image. Paths are compared to source
images by size, then exact bytes, independent of filename. A match reuses the source
unchanged; otherwise the library imports a copy. Repeated sources in one invocation also
deduplicate. All results receive the resolved source IDs.

Unknown needs, prompt tags, and source tags join the vocabulary. Both the app and CLI
use an exclusive `.prompt-gallery.lock`, created with `create_new`, retrying for up to
five seconds. Locks older than 30 seconds are reclaimed. A scope guard removes its own lock
on normal return or error; crashes rely on stale recovery. Under the lock, `library.json`
is reread and tags are merged, so old app snapshots cannot discard new agent tags.
Vocabulary editing is consequently additive. The lock covers vocabulary writes only;
simultaneous prompt matching/imports are not a global transaction and can create duplicate
prompts. Do not run multiple saves of the same batch concurrently.

## Config paths

Resolution order: `--library`, `PROMPT_GALLERY_LIBRARY`, then `libraryPath` in
`config.json`. `PROMPT_GALLERY_CONFIG_DIR` replaces the config directory (use in tests).
The CLI only reads config; it never creates or changes it.

The default config path is
`~/Library/Application Support/com.ribin.prompt-gallery/config.json`.
Only the macOS config directory is resolved. Use `--library` for an explicit library
without an app config.

## Live refresh

The macOS app recursively watches the active library using `notify`. Events beneath
dot-prefixed components (including `.thumbs` and atomic-write temp files) and access-only
events are ignored. A 400 ms quiet interval coalesces writes into `library-changed`.
If native watching cannot start, a content-comparing polling watcher runs every 400 ms
(with the same quiet interval). Switching libraries replaces the watcher; queued events carry their root and are ignored
by the frontend if they belong to the old library.

The frontend defers external refresh while busy, while a dialog is open, or while a
lightbox is open, then loads when that interaction ends. It preserves view, prompt,
filters, search and main scroll position. If an open prompt was removed externally,
it returns to the grid. Comparing snapshots avoids repeated DOM rendering from the app's
own writes; a watcher event can still cause a read after an app-initiated read.
Long batches with pauses exceeding 400 ms may yield intermediate snapshots.

## Agent skill and plugins

```text
/plugin marketplace add ribincao/prompt-gallery
/plugin install prompt-gallery@prompt-gallery
```

For Codex CLI:

```sh
codex plugin marketplace add ribincao/prompt-gallery
codex plugin add prompt-gallery@prompt-gallery
```

Both plugins share the one `skills/prompt-gallery/` folder. The Codex marketplace is
`.agents/plugins/marketplace.json`; its plugin manifest is `.codex-plugin/plugin.json`.
The Codex plugin declares `"skills": "./skills/"` and has no MCP servers.

Alternatively copy `skills/prompt-gallery` into `~/.claude/skills/` or
`~/.agents/skills/`. The skill offers saving after image generation/editing, asks once,
then passes the exact model prompt, all results and reference images to the CLI.

The minimal root manifests follow the official
[marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces) and
[plugin manifest reference](https://code.claude.com/docs/en/plugins-reference).
Skills live at the repository root under `skills/`, not inside `.claude-plugin/`.
