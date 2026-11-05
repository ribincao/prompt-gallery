// Test-only in-memory IPC bridge. Never loaded by the app.
export function installMockBridge() {
  const lib = { root: "/tmp/Prompt Library", folders: [], categories: ["style-only"], tags: ["single", "group", "pet"], sources: [], prompts: [], warnings: [] };
  const calls = [];
  const listeners = {};
  let serial = 0;
  const id = () => `20261104-120000-${(++serial).toString(16).padStart(4, "0")}`;
  const date = () => new Date().toISOString();
  window.testState = { lib, calls, listeners, assetPaths: [] };
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        window.testState.copied = text;
      },
      read: async () => {
        throw new Error("Use paste event");
      },
    },
  });
  window.__TAURI__ = {
    core: {
      Channel: class {},
      convertFileSrc: (path) => {
        window.testState.assetPaths.push(path);
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8S8AAAAASUVORK5CYII=";
      },
      invoke: async (cmd, args = {}) => {
        calls.push({ cmd, args });
        const p = lib.prompts.find((p) => p.id === (args.promptId || args.id));
        switch (cmd) {
          case "create_folder": { const f = {id: id(), name: args.name.trim(), createdAt: date()}; lib.folders.push(f); return f; }
          case "rename_folder": lib.folders.find(f => f.id === args.id).name = args.name.trim(); return;
          case "delete_folder": lib.folders = lib.folders.filter(f => f.id !== args.id); lib.sources.forEach(s => { if (s.folder === args.id) delete s.folder; }); return;
          case "move_sources": lib.sources.filter(s => args.ids.includes(s.id)).forEach(s => s.folder = args.folder); return;
          case "get_config":
            return { libraryPath: null };
          case "pick_library_folder":
            return lib.root;
          case "set_library":
            return;
          case "load_library":
            return JSON.parse(JSON.stringify(lib));
          case "pick_image_files":
            return ["/tmp/original.png"];
          case "clipboard_chat_url":
            return "https://chatgpt.com/c/test";
          case "import_sources":
          case "import_source_bytes": {
            const ids = (args.paths || ["paste"]).map(() => {
              const sid = id();
              lib.sources.unshift({
                id: sid,
                file: `${sid}.png`,
                originalName: cmd === "import_sources" ? "Original.png" : "Pasted image.png",
                tags: args.tags,
                note: "",
                createdAt: date(),
                path: `${lib.root}/sources/${sid}.png`,
                thumbnail: null,
              });
              return sid;
            });
            return cmd === "import_sources" ? ids : ids[0];
          }
          case "update_source":
            Object.assign(
              lib.sources.find((s) => s.id === args.id),
              { tags: args.tags, note: args.note, name: args.name ?? null },
            );
            return;
          case "create_prompt": {
            const pid = id();
            lib.categories = [...new Set([...lib.categories, ...args.meta.categories])];
            lib.prompts.unshift({
              ...args.meta,
              id: pid,
              text: args.text,
              results: [],
              createdAt: date(),
              updatedAt: date(),
            });
            return pid;
          }
          case "update_prompt":
            Object.assign(p, args.meta, { text: args.text });
            return;
          case "add_results": {
            const rid = id();
            p.results.unshift({
              id: rid,
              file: `${rid}.png`,
              path: `${lib.root}/prompts/${p.id}/results/${rid}.png`,
              thumbnail: null,
              sourcePhotos: args.sourcePhotos,
              chatUrl: args.chatUrl,
              note: args.note,
              model: "ChatGPT",
              favorite: false,
              createdAt: date(),
            });
            return [rid];
          }
          case "update_result":
            Object.assign(
              p.results.find((r) => r.id === args.id),
              args.meta,
            );
            return;
          case "set_categories": lib.categories = [...new Set([...lib.categories, ...args.categories])]; return;
          case "category_usage": return [...new Set([...lib.categories, ...lib.prompts.flatMap(p => p.categories)])].map(tag => ({tag, sources:0, prompts:lib.prompts.filter(p => p.categories.includes(tag)).length}));
          case "remove_category":
          case "rename_category": {
            const from = args.tag ?? args.from;
            const replace = values => [...new Set(values.flatMap(t => t === from ? (args.to ? [args.to] : []) : [t]))];
            const prompts = lib.prompts.filter(p => p.categories.includes(from)).length;
            lib.categories = replace(lib.categories);
            lib.prompts.forEach(p => p.categories = replace(p.categories));
            return {sources:0, prompts, warnings:[]};
          }
          case "set_tags":
            lib.tags = [...new Set([...lib.tags, ...args.tags])];
            return;
          case "tag_usage":
            return [...new Set([...lib.tags, ...lib.sources.flatMap(s => s.tags), ...lib.prompts.flatMap(p => [...p.needs])])].sort().map(tag => ({tag, sources: lib.sources.filter(s => s.tags.includes(tag)).length, prompts: lib.prompts.filter(p => p.needs.includes(tag)).length}));
          case "remove_tag":
          case "rename_tag": {
            if (window.testState.tagError) throw new Error(window.testState.tagError);
            const from = args.tag ?? args.from;
            const replace = tags => [...new Set(tags.flatMap(t => t === from ? (args.to ? [args.to] : []) : [t]))];
            const sources = lib.sources.filter(s => s.tags.includes(from)).length;
            const prompts = lib.prompts.filter(p => p.needs.includes(from)).length;
            lib.tags = replace(lib.tags);
            lib.sources.forEach(s => s.tags = replace(s.tags));
            lib.prompts.forEach(p => { p.needs = replace(p.needs); });
            return {sources, prompts, warnings: []};
          }
          case "trash_item":
            if (window.testState.trashError) throw new Error(window.testState.trashError);
            if (args.kind === "source") lib.sources = lib.sources.filter((s) => s.id !== args.id);
            else if (args.kind === "prompt") lib.prompts = lib.prompts.filter((p) => p.id !== args.id);
            else p.results = p.results.filter((r) => r.id !== args.id);
            return;
          case "copy_image_to_clipboard":
          case "reveal_in_finder":
          case "open_chat":
          case "plugin:drag|start_drag":
            return;
          default:
            throw new Error(`Unexpected command: ${cmd}`);
        }
      },
    },
    event: {
      listen: async (event, callback) => {
        listeners[event] = callback;
        return () => {};
      },
    },
  };
}
