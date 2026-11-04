import { createPromptGrid } from "./prompt-cards.js";
import { sourcePhotoPicker, createResultSelection } from "./result-tools.js";

const { invoke, convertFileSrc, Channel } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (s, parent = document) => parent.querySelector(s);
const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const split = (text) => [
  ...new Set(
    text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];
const asset = (path) => (path ? convertFileSrc(path) : "");
const main = $("#main"),
  modal = $("#modal"),
  lightbox = $("#lightbox");
let library = null,
  view = "prompts",
  promptId = null,
  selectedSource = null;
let filter = "",
  favorites = false,
  query = "",
  busy = false,
  toastTimer;
let lightItems = [],
  lightIndex = 0,
  lightPrompt = null,
  modalSubmit = null;
let dragging = false;
let showAllSourcesFor = null;
const prompt = () => library?.prompts.find((p) => p.id === promptId);
const source = (id) => library?.sources.find((s) => s.id === id);
const badges = (tags) => tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("");
const button = (action, label, cls = "", data = "") =>
  `<button type="button" data-action="${action}" class="${cls}" ${data}>${label}</button>`;
const promptGrid = createPromptGrid({ main, asset, esc, badges, button });
const date = (text) => new Date(text).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const resultSelection = createResultSelection({ asset, esc, button, date });
const photoPicker = (p, chosen = []) =>
  sourcePhotoPicker({ sources: library.sources, needs: p.needs, chosen, asset, esc });
const resultMeta = (r, sourcePhotos) => ({
  sourcePhotos,
  chatUrl: r.chatUrl,
  model: r.model,
  note: r.note,
  favorite: r.favorite,
});
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5000);
}
function report(error) {
  const text = String(error);
  toast(text);
  const target = modal.open ? $("#modal-error") : null;
  if (target) target.textContent = text;
}
async function task(fn) {
  if (busy) return;
  busy = true;
  $("#busy").hidden = false;
  try {
    return await fn();
  } catch (e) {
    report(e);
  } finally {
    busy = false;
    flushLibraryRefresh();
    $("#busy").hidden = true;
  }
}
function showModal(title, body, submit) {
  modalSubmit = submit;
  $("#modal-content").innerHTML =
    `<div class="dialog-header"><h2>${esc(title)}</h2>${button("close-modal", "✕", "icon", 'aria-label="Close dialog"')}</div><form id="dialog-form">${body}<p id="modal-error" class="inline-error" role="alert"></p></form>`;
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => $("input:not([type=checkbox]),textarea,button", $("#dialog-form"))?.focus());
}
function closeModal() {
  modal.close();
  modalSubmit = null;
}
function footer(label = "Save") {
  return `<div class="form-actions">${button("close-modal", "Cancel")}<button class="primary" type="submit">${label}</button></div>`;
}
function field(label, name, value = "", { area = false, full = false, required = false, rows = 3, hint = "" } = {}) {
  return `<label class="field ${full ? "full" : ""}">${esc(label)}${area ? `<textarea name="${name}" rows="${rows}" ${required ? "required" : ""}>${esc(value)}</textarea>` : `<input name="${name}" value="${esc(value)}" ${required ? "required" : ""}>`}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}
function tagChecks(name, chosen = []) {
  return `<div class="checks">${[...new Set([...library.tags, ...chosen])].map((t) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(t)}" ${chosen.includes(t) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div>`;
}
function collectedTags(form, name, extra) {
  return [...new Set([...new FormData(form).getAll(name), ...split(form.elements[extra]?.value || "")])];
}
function warnings() {
  return library.warnings.length
    ? `<details class="warning"><summary>${library.warnings.length} library warning${library.warnings.length === 1 ? "" : "s"} — show files</summary><ul>${library.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>`
    : "";
}
function sourceCard(s, mini = false) {
  const card = `<button class="card source-card ${s.id === selectedSource ? "selected" : ""}" data-action="source" data-id="${s.id}" aria-label="Preview ${esc(s.originalName)}"><img src="${asset(s.thumbnail || s.path)}" alt="${esc(s.originalName)}" draggable="false" loading="lazy"><div class="card-body">${mini ? esc(s.originalName) : `<h3>${esc(s.originalName)}</h3><div class="badges">${badges(s.tags)}</div>`}</div></button>`;
  return mini ? `<div class="source-mini">${card}</div>` : card;
}
function renderSidebar() {
  $("#prompt-count").textContent = library.prompts.length;
  $("#source-count").textContent = library.sources.length;
  $("#nav-prompts").classList.toggle("active", view === "prompts");
  $("#nav-sources").classList.toggle("active", view === "sources");
  $("#favorites").classList.toggle("active", favorites);
  $("#favorites").setAttribute("aria-pressed", String(favorites));
  $("#favorites").disabled = view === "sources";
  $("#library-path").textContent = library.root;
  $("#library-path").title = library.root;
  const tags = [...new Set([...library.tags, ...library.prompts.flatMap((p) => p.tags)])];
  $("#tags").innerHTML =
    `<button class="chip ${!filter ? "active" : ""}" data-action="filter" data-tag="">All</button>` +
    tags
      .map(
        (t) =>
          `<button class="chip ${filter === t ? "active" : ""}" data-action="filter" data-tag="${esc(t)}">${esc(t)}</button>`,
      )
      .join("");
}
function render() {
  if (!library) return;
  renderSidebar();
  if (promptId && !prompt()) promptId = null;
  if (promptId) {
    renderPrompt();
    promptGrid.afterRender();
    return;
  }
  resultSelection.reset();
  showAllSourcesFor = null;
  const isPrompts = view === "prompts";
  const items = (isPrompts ? library.prompts : library.sources).filter((item) => {
    const tags = isPrompts ? [...item.tags, ...item.needs] : item.tags;
    const text = isPrompts ? [item.title, item.text, item.notes, ...tags] : [item.originalName, item.note, ...tags];
    return (
      (!filter || tags.includes(filter)) &&
      (!isPrompts || !favorites || item.favorite) &&
      text.join(" ").toLowerCase().includes(query.toLowerCase())
    );
  });
  main.innerHTML = `<header class="page-header"><div><p class="eyebrow">YOUR LIBRARY</p><h1>${isPrompts ? "Prompts" : "Source photos"}</h1><p>${items.length} ${isPrompts ? "ideas to come back to" : "photos, ready for your next idea"}</p></div><div class="actions">${!isPrompts ? button("paste", "Paste image") : ""}${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "+ New prompt" : "+ Add photos", "primary")}</div></header>${warnings()}${items.length ? `<div class="grid">${items.map((item) => (isPrompts ? promptGrid.card(item) : sourceCard(item))).join("")}</div>` : `<section class="empty"><div class="hero-mark">${isPrompts ? "▤" : "▧"}</div><h2>${query || filter || favorites ? "Nothing matches yet" : isPrompts ? "Your next idea starts here" : "Bring your own inspiration"}</h2><p>${query || filter || favorites ? "Try a different search or clear your filters." : isPrompts ? "Save a prompt, then collect what it creates. You can also paste a block of prompt text here." : "Drop photos here, paste an image, or choose files. Originals are always copied and left untouched."}</p>${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "Create a prompt" : "Choose photos", "primary")}</section>`}`;
  promptGrid.afterRender();
}
function renderPrompt() {
  const p = prompt();
  resultSelection.begin(p.id, p.results);
  const matches = library.sources.filter((s) => s.tags.some((t) => p.needs.includes(t)));
  const suggestions = showAllSourcesFor === p.id ? library.sources : matches;
  main.innerHTML = `${button("back", "‹ All prompts", "back")}<header class="page-header"><div><h1>${esc(p.title)}</h1><div class="badges">${badges(p.needs.length ? p.needs : ["text-only"])}${badges(p.tags)}</div></div><div class="actions">${button("favorite-prompt", p.favorite ? "★" : "☆", "", `aria-label="${p.favorite ? "Remove from" : "Add to"} favorites"`)}${button("edit-prompt", "Edit")}${button("copy-prompt", "Copy prompt", "primary")}</div></header>${warnings()}<pre class="prompt-text">${esc(p.text)}</pre>${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ""}${p.sourceUrl ? button("open-url", "Original source ↗", "", `data-url="${esc(p.sourceUrl)}"`) : ""}<section><div class="section-header"><h2>Suggested source photos</h2><small>${suggestions.length} ${showAllSourcesFor === p.id ? "available" : "matching"} ${suggestions.length === 1 ? "photo" : "photos"}</small></div>${p.needs.length ? (suggestions.length ? `<div class="strip">${suggestions.map((s) => sourceCard(s, true)).join("")}</div><small>Click to preview · Drag to ChatGPT · Copy image with ⌘C</small>` : `<p class="muted">No matching photos yet. Add a source photo with one of this prompt’s needs tags.</p>${library.sources.length ? button("show-all-sources", "Show all source photos", "link-button") : ""}`) : '<p class="muted">This is a text-only prompt. No source photo needed.</p>'}</section><section><div class="section-header"><h2>Results <small>(${p.results.length})</small></h2><div class="actions">${p.results.length ? resultSelection.toolbar() : ""}${button("paste", "Paste image")}${button("pick-results", "+ Add result")}</div></div>${p.results.length ? `<div class="grid">${p.results.map((r) => resultSelection.card(r, p.id)).join("")}</div>` : '<p class="muted">Drop, paste, or choose a generated image to keep it with this prompt.</p>'}</section><div class="section-header">${button("delete-prompt", "Move prompt to Trash", "danger")}</div>`;
}
let pendingLibraryRefresh = false;
let refreshInFlight = null;
async function refresh(external = false) {
  if (refreshInFlight) {
    await refreshInFlight;
    return refresh(external);
  }
  refreshInFlight = (async () => {
    const next = await invoke("load_library");
    if (external && (busy || modal.open || lightbox.open)) {
      pendingLibraryRefresh = true;
      return;
    }
    // An app save and its watcher event may both load; only changed data redraws.
    if (external && JSON.stringify(next) === JSON.stringify(library)) return;
    const top = main.scrollTop, left = main.scrollLeft;
    library = next;
    render();
    main.scrollTop = top;
    main.scrollLeft = left;
  })();
  try { await refreshInFlight; } finally { refreshInFlight = null; }
}
async function flushLibraryRefresh() {
  if (!pendingLibraryRefresh || busy || modal.open || lightbox.open || !library) return;
  pendingLibraryRefresh = false;
  try { await refresh(true); } catch (error) { report(error); }
}
modal.addEventListener("close", () => setTimeout(flushLibraryRefresh, 0));
lightbox.addEventListener("close", () => setTimeout(flushLibraryRefresh, 0));
async function chooseLibrary() {
  if (busy) return;
  const path = await invoke("pick_library_folder");
  if (!path) return;
  await task(async () => {
    try {
      await invoke("set_library", { path });
    } catch (e) {
      if (String(e) !== "CONFIRM_NONEMPTY") throw e;
      showModal(
        "Use this folder as a library?",
        `<p>This folder is not empty. Prompt Gallery will add library.json, sources, prompts, and .thumbs. Existing files stay in place.</p><p class="muted">${esc(path)}</p>${footer("Use this folder")}`,
        async () => {
          await invoke("set_library", { path, confirmNonempty: true });
          closeModal();
          await refresh();
        },
      );
      return;
    }
    promptId = null;
    selectedSource = null;
    await refresh();
  });
}
function editPrompt(existing = null, text = "") {
  if (!library) return;
  const p = existing;
  showModal(
    p ? "Edit prompt" : "New prompt",
    `<div class="form-grid">${field("Title", "title", p?.title || "", { required: true, full: true })}${field("Prompt text", "text", p?.text ?? text, { area: true, rows: 8, full: true })}<div class="full"><label class="field">Source photos it needs<small>Show source photos tagged with any of these. Leave empty for a text-only prompt.</small></label>${tagChecks("needs", p?.needs)}<div class="tag-editor">${field("New needs tags, separated by commas", "newNeeds")}</div></div>${field("Style tags, separated by commas", "tags", p?.tags.join(", ") || "")}${field("Source URL", "sourceUrl", p?.sourceUrl || "")}${field("Notes", "notes", p?.notes || "", { area: true, full: true })}</div>${footer(p ? "Save changes" : "Create prompt")}`,
    async (form) => {
      const values = new FormData(form),
        meta = {
          title: values.get("title").trim(),
          needs: collectedTags(form, "needs", "newNeeds"),
          tags: split(values.get("tags")),
          sourceUrl: values.get("sourceUrl").trim(),
          notes: values.get("notes"),
          favorite: p?.favorite || false,
        };
      if (p) await invoke("update_prompt", { id: p.id, meta, text: values.get("text") });
      else promptId = await invoke("create_prompt", { meta, text: values.get("text") });
      closeModal();
      view = "prompts";
      await refresh();
      toast("Prompt saved");
    },
  );
}
function openSource(id) {
  const s = source(id);
  if (!s) return;
  selectedSource = id;
  render();
  const uses = library.prompts.flatMap((p) =>
    p.results.filter((r) => r.sourcePhotos.includes(id)).map((r) => ({ p, r })),
  );
  showModal(
    s.originalName,
    `<img class="source-preview" src="${asset(s.path)}" alt="${esc(s.originalName)}"><div class="actions">${button("copy-image", "Copy image", "primary", `data-id="${id}"`)}${button("reveal", "Reveal in Finder", "", `data-id="${id}"`)}${button("delete-source", "Move to Trash", "danger", `data-id="${id}"`)}</div><div class="section-header"><h3>Tags</h3></div>${tagChecks("tags", s.tags)}<div class="tag-editor">${field("New tags, separated by commas", "newTags")}</div><div class="tag-editor">${field("Note", "note", s.note, { area: true })}</div><div class="source-uses"><h3>Results that used this photo (${uses.length})</h3>${uses.length ? uses.map(({ p, r }) => button("result", esc(p.title), "", `data-id="${r.id}" data-pid="${p.id}"`)).join("") : "<small>No linked results yet.</small>"}</div>${footer("Save photo details")}`,
    async (form) => {
      await invoke("update_source", {
        id,
        tags: collectedTags(form, "tags", "newTags"),
        note: form.elements.note.value,
      });
      closeModal();
      await refresh();
      toast("Photo details saved");
    },
  );
}
function importedTags(ids) {
  showModal(
    `Tag ${ids.length === 1 ? "your photo" : `your ${ids.length} photos`}`,
    `<p class="muted">The originals have been copied into your library. Add tags to match them with prompts.</p>${tagChecks("tags")}<div class="tag-editor">${field("New tags, separated by commas", "newTags")}</div>${footer("Save tags")}`,
    async (form) => {
      const tags = collectedTags(form, "tags", "newTags");
      for (const id of ids) await invoke("update_source", { id, tags, note: "" });
      closeModal();
      await refresh();
      toast("Photos tagged");
    },
  );
}
async function importSources(data) {
  await task(async () => {
    let ids;
    try {
      ids = data.paths
        ? await invoke("import_sources", { paths: data.paths, tags: [] })
        : [await invoke("import_source_bytes", { bytes: data.bytes, tags: [] })];
    } catch (e) {
      await refresh();
      throw e;
    }
    await refresh();
    importedTags(ids);
  });
}
async function chatFromClipboard() {
  try {
    return await invoke("clipboard_chat_url");
  } catch {
    return "";
  }
}
async function addResults(data, pid = promptId) {
  const targetPrompt = library.prompts.find((p) => p.id === pid);
  if (!targetPrompt) return;
  const chatUrl = await chatFromClipboard();
  showModal(
    "Add results",
    `<p class="muted">${data.paths ? data.paths.length : "1"} image${data.paths?.length === 1 ? "" : "s"} ready to add to <strong>${esc(targetPrompt.title)}</strong>.</p>${photoPicker(targetPrompt, selectedSource ? [selectedSource] : [])}<div class="tag-editor">${field("Chat URL", "chatUrl", chatUrl, { hint: "Optional. Open this conversation later in your default browser." })}</div><div class="tag-editor">${field("Note", "note", "", { area: true })}</div>${footer("Add results")}`,
    async (form) => {
      const values = new FormData(form);
      try {
        await invoke("add_results", {
          promptId: pid,
          paths: data.paths || null,
          bytes: data.bytes || null,
          sourcePhotos: values.getAll("sources"),
          chatUrl: values.get("chatUrl").trim(),
          note: values.get("note"),
        });
      } catch (e) {
        closeModal();
        await refresh();
        throw e;
      }
      closeModal();
      await refresh();
      toast("Results added");
    },
  );
}
function openResult(pid, id) {
  const p = library.prompts.find((p) => p.id === pid);
  if (!p) return;
  closeModal();
  lightItems = p.results;
  lightPrompt = pid;
  lightIndex = Math.max(
    0,
    p.results.findIndex((r) => r.id === id),
  );
  renderLightbox();
  if (!lightbox.open) lightbox.showModal();
}
function renderLightbox() {
  const r = lightItems[lightIndex];
  if (!r) {
    lightbox.close();
    return;
  }
  $("#lightbox-content").innerHTML =
    `<div class="dialog-header"><div class="actions">${button("prev-result", "←", "", `aria-label="Previous result" ${lightIndex === 0 ? "disabled" : ""}`)}<small>${lightIndex + 1} / ${lightItems.length}</small>${button("next-result", "→", "", `aria-label="Next result" ${lightIndex === lightItems.length - 1 ? "disabled" : ""}`)}</div>${button("close-lightbox", "✕", "icon", 'aria-label="Close result"')}</div><img class="lightbox-image" src="${asset(r.path)}" alt="${esc(r.note || "Generated result")}"><div class="lightbox-footer"><div class="actions"><small>${esc(date(r.createdAt))} · ${esc(r.model)}</small><div class="actions">${button("favorite-result", r.favorite ? "★ Favorite" : "☆ Favorite")}${button("edit-result", "Edit")}${r.chatUrl ? button("open-url", "Open chat ↗", "primary", `data-url="${esc(r.chatUrl)}"`) : ""}${button("delete-result", "Move to Trash", "danger")}</div></div>${r.note ? `<p>${esc(r.note)}</p>` : ""}<div class="image-sources">${r.sourcePhotos.length ? "<small>Source photos:</small>" : ""}${r.sourcePhotos
      .map((id) => {
        const s = source(id);
        return s
          ? button(
              "light-source",
              `<img src="${asset(s.thumbnail || s.path)}" alt=""><span>${esc(s.originalName)}</span>`,
              "linked-source",
              `data-id="${id}" aria-label="Open source photo ${esc(s.originalName)}"`,
            )
          : '<span class="missing">Source photo missing</span>';
      })
      .join("")}</div></div>`;
}
function editResult() {
  const r = lightItems[lightIndex],
    pid = lightPrompt;
  lightbox.close();
  showModal(
    "Edit result",
    `${photoPicker(
      library.prompts.find((p) => p.id === pid),
      r.sourcePhotos,
    )}<div class="tag-editor">${field("Chat URL", "chatUrl", r.chatUrl)}</div><div class="tag-editor">${field("Model", "model", r.model)}</div><div class="tag-editor">${field("Note", "note", r.note, { area: true })}</div>${footer()}`,
    async (form) => {
      const f = new FormData(form);
      await invoke("update_result", {
        promptId: pid,
        id: r.id,
        meta: {
          sourcePhotos: f.getAll("sources"),
          chatUrl: f.get("chatUrl").trim(),
          model: f.get("model"),
          note: f.get("note"),
          favorite: r.favorite,
        },
      });
      closeModal();
      await refresh();
      openResult(pid, r.id);
    },
  );
}
function setResultSources() {
  const p = prompt(),
    items = resultSelection.items();
  if (!p || !items.length) return;
  const shared = items[0].sourcePhotos.filter((id) => items.every((r) => r.sourcePhotos.includes(id)));
  showModal(
    "Set source photos",
    `<p>Replace the source-photo links on ${items.length} selected results. Choose no photos to clear their links.</p>${photoPicker(p, shared)}${footer("Apply to selected results")}`,
    async (form) => {
      const sourcePhotos = new FormData(form).getAll("sources");
      let completed = 0;
      try {
        for (const r of items) {
          await invoke("update_result", { promptId: p.id, id: r.id, meta: resultMeta(r, sourcePhotos) });
          completed++;
        }
      } catch (error) {
        await refresh();
        throw new Error(
          `Updated ${completed} of ${items.length} results. ${error}. Retry to apply to all selected results.`,
        );
      }
      closeModal();
      await refresh();
      toast(`Source photos set for ${items.length} results`);
    },
  );
}
function confirmTrash(kind, id, pid = null) {
  lightbox.close();
  showModal(
    `Move ${kind} to Trash?`,
    `<p>${kind === "prompt" ? "This prompt and all its results will be moved to the macOS Trash." : "This item and its metadata will be moved to the macOS Trash."} You can restore them in Finder.</p>${kind === "source" ? '<p class="muted">Linked results stay in the library and will show “Source photo missing”.</p>' : ""}${footer("Move to Trash")}`,
    async () => {
      await invoke("trash_item", { kind, id, promptId: pid });
      closeModal();
      if (kind === "prompt") promptId = null;
      if (kind === "source") selectedSource = null;
      await refresh();
      toast("Moved to Trash");
    },
  );
}
async function copyImage(id) {
  const s = source(id);
  if (s) {
    await invoke("copy_image_to_clipboard", { path: s.path });
    toast("Copied");
  }
}
async function pasteClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        await acceptImage(await item.getType(type));
        return;
      }
    }
    toast("No image on the clipboard. Copy an image, then press ⌘V.");
  } catch {
    toast("Press ⌘V to paste an image from the clipboard.");
  }
}
async function pngBytes(blob) {
  if (blob.type === "image/png") return Array.from(new Uint8Array(await blob.arrayBuffer()));
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Could not convert pasted image to PNG");
    return Array.from(new Uint8Array(await png.arrayBuffer()));
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function acceptImage(blob, targetPromptId = promptId || promptGrid.target()) {
  await acceptImport({ bytes: await pngBytes(blob) }, targetPromptId);
}
async function acceptImport(data, targetPromptId = promptId) {
  if (!library) {
    toast("Choose a library first");
    return;
  }
  if (modal.open || lightbox.open) {
    toast("Close the current dialog before importing images");
    return;
  }
  if (targetPromptId) await task(() => addResults(data, targetPromptId));
  else if (view === "sources") await importSources(data);
  else toast("Hover or focus a prompt card to add results, or switch to Source photos");
}
async function pickResults(pid = promptId) {
  if (!pid || modal.open || lightbox.open) return;
  await task(async () => {
    const paths = await invoke("pick_image_files");
    if (paths.length) await addResults({ paths }, pid);
  });
}
function navigate(next) {
  view = next;
  promptId = null;
  selectedSource = null;
  render();
}
const actions = {
  "close-modal": () => closeModal(),
  "close-lightbox": () => lightbox.close(),
  "new-prompt": () => editPrompt(),
  "edit-prompt": () => editPrompt(prompt()),
  prompt: (el) => {
    promptId = el.dataset.id;
    selectedSource = null;
    render();
    main.scrollTop = 0;
  },
  back: () => {
    promptId = null;
    render();
  },
  filter: (el) => {
    filter = el.dataset.tag;
    promptId = null;
    render();
  },
  source: (el) => {
    if (!dragging) openSource(el.dataset.id);
  },
  "copy-image": (el) => copyImage(el.dataset.id),
  reveal: (el) => invoke("reveal_in_finder", { path: source(el.dataset.id).path }),
  "copy-prompt": async () => {
    await navigator.clipboard.writeText(prompt().text);
    toast("Copied");
  },
  "favorite-prompt": async () => {
    const p = prompt();
    await invoke("update_prompt", { id: p.id, meta: { ...p, favorite: !p.favorite }, text: p.text });
    await refresh();
  },
  "pick-sources": async () => {
    const paths = await invoke("pick_image_files");
    if (paths.length) await importSources({ paths });
  },
  "pick-results": () => pickResults(),
  "card-pick-results": (el) => pickResults(el.dataset.id),
  paste: () => pasteClipboard(),
  result: (el, event) => {
    if (
      el.classList.contains("result-card") &&
      main.contains(el) &&
      promptId === el.dataset.pid &&
      resultSelection.choose(el.dataset.id, event)
    ) {
      renderPrompt();
      main.querySelector(`.result-card[data-id="${el.dataset.id}"]`)?.focus({ preventScroll: true });
    } else openResult(el.dataset.pid, el.dataset.id);
  },
  "select-results": () => {
    resultSelection.toggle();
    renderPrompt();
  },
  "set-result-sources": () => setResultSources(),
  "show-all-sources": () => {
    showAllSourcesFor = promptId;
    renderPrompt();
  },
  "prev-result": () => {
    lightIndex = Math.max(0, lightIndex - 1);
    renderLightbox();
  },
  "next-result": () => {
    lightIndex = Math.min(lightItems.length - 1, lightIndex + 1);
    renderLightbox();
  },
  "light-source": (el) => {
    lightbox.close();
    openSource(el.dataset.id);
  },
  "open-url": (el) => invoke("open_chat", { url: el.dataset.url }),
  "edit-result": () => editResult(),
  "favorite-result": async () => {
    const r = lightItems[lightIndex];
    await invoke("update_result", { promptId: lightPrompt, id: r.id, meta: { ...r, favorite: !r.favorite } });
    await refresh();
    lightItems = library.prompts.find((p) => p.id === lightPrompt).results;
    renderLightbox();
  },
  "delete-source": (el) => confirmTrash("source", el.dataset.id),
  "delete-prompt": () => confirmTrash("prompt", promptId),
  "delete-result": () => confirmTrash("result", lightItems[lightIndex].id, lightPrompt),
};
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  $("#context-menu").hidden = true;
  if (!el || busy || el.disabled) return;
  try {
    await actions[el.dataset.action]?.(el, e);
  } catch (error) {
    report(error);
  }
});
$("#modal-content").addEventListener("submit", (e) => {
  e.preventDefault();
  if (modalSubmit) task(() => modalSubmit(e.target));
});
modal.addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
$("#choose-library").addEventListener("click", () => chooseLibrary().catch(report));
$("#switch-library").addEventListener("click", () => {
  $("#library-menu").open = false;
  chooseLibrary().catch(report);
});
$("#reload").addEventListener("click", () => {
  if (library) task(refresh);
});
$("#nav-prompts").addEventListener("click", () => navigate("prompts"));
$("#nav-sources").addEventListener("click", () => navigate("sources"));
$("#search").addEventListener("input", (e) => {
  query = e.target.value;
  promptId = null;
  render();
});
$("#favorites").addEventListener("click", () => {
  favorites = !favorites;
  promptId = null;
  render();
});
$("#manage-tags").addEventListener("click", () => {
  if (!library) return;
  showModal(
    "Tag vocabulary",
    `${field("Tags, separated by commas", "tags", library.tags.join(", "), { area: true, rows: 4, hint: "Shared by source photos and prompt needs. New tags are merged into the vocabulary; existing tags are retained." })}${footer()}`,
    async (form) => {
      await invoke("set_tags", { tags: split(form.elements.tags.value) });
      closeModal();
      await refresh();
    },
  );
});
document.addEventListener("paste", (e) => {
  if (busy || e.target.closest("input,textarea,[contenteditable]")) return;
  const image = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  if (image) {
    e.preventDefault();
    const blob = image.getAsFile();
    if (blob) acceptImage(blob).catch(report);
    return;
  }
  const text = e.clipboardData?.getData("text/plain");
  if (
    library &&
    view === "prompts" &&
    !promptId &&
    !modal.open &&
    !lightbox.open &&
    !$(".grid", main) &&
    text?.length >= 80
  ) {
    e.preventDefault();
    editPrompt(null, text);
  }
});
// Also handle the native Edit → Copy menu, which may dispatch copy without keydown.
document.addEventListener("copy", (e) => {
  if (!e.target.closest("input,textarea,[contenteditable]") && selectedSource && !window.getSelection()?.toString()) {
    e.preventDefault();
    copyImage(selectedSource).catch(report);
  }
});
document.addEventListener("keydown", (e) => {
  const editing = !!e.target.closest("input,textarea,[contenteditable]");
  if (e.key === "Escape") {
    $("#context-menu").hidden = true;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("#search").focus();
    $("#search").select();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !modal.open && !lightbox.open) {
    e.preventDefault();
    editPrompt();
  }
  if (
    (e.metaKey || e.ctrlKey) &&
    e.key.toLowerCase() === "c" &&
    !editing &&
    selectedSource &&
    !window.getSelection()?.toString()
  ) {
    e.preventDefault();
    copyImage(selectedSource).catch(report);
  }
  if (lightbox.open && !editing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    actions[e.key === "ArrowLeft" ? "prev-result" : "next-result"]();
  }
});
document.addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".source-card");
  if (!card) return;
  e.preventDefault();
  selectedSource = card.dataset.id;
  const menu = $("#context-menu");
  menu.innerHTML =
    button("copy-image", "Copy image", "", `data-id="${selectedSource}"`) +
    button("reveal", "Reveal in Finder", "", `data-id="${selectedSource}"`) +
    button("source", "Edit tags", "", `data-id="${selectedSource}"`) +
    button("delete-source", "Move to Trash", "danger", `data-id="${selectedSource}"`);
  menu.hidden = false;
  menu.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - 180)}px`;
  $("button", menu).focus();
});
// Native dragDropEnabled intercepts HTML dragstart; begin a native drag after a mouse threshold.
document.addEventListener("mousedown", (e) => {
  const card = e.target.closest(".source-card");
  if (!card || e.button !== 0 || busy) return;
  const s = source(card.dataset.id),
    x = e.clientX,
    y = e.clientY;
  const cleanup = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  const up = () => {
    cleanup();
    setTimeout(() => (dragging = false), 100);
  };
  const move = (event) => {
    if (Math.hypot(event.clientX - x, event.clientY - y) < 7) return;
    cleanup();
    dragging = true;
    selectedSource = s.id;
    const onEvent = new Channel();
    onEvent.onmessage = () => setTimeout(() => (dragging = false), 150);
    invoke("plugin:drag|start_drag", {
      item: [s.path],
      image: s.thumbnail || s.path,
      options: { mode: "copy" },
      onEvent,
    }).catch((error) => {
      dragging = false;
      report(`Drag unavailable: ${error}. Use Copy image instead.`);
    });
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up, { once: true });
});
document.addEventListener("dragstart", (e) => {
  if (e.target.closest(".source-card")) e.preventDefault();
});
async function start() {
  await listen("library-changed", (event) => {
    if (library && event.payload === library.root) {
      pendingLibraryRefresh = true;
      flushLibraryRefresh();
    }
  });
  const dragHover = (event) => {
    if (dragging || busy || modal.open || lightbox.open) return;
    main.classList.add("drop-active");
    promptGrid.highlightDrop(event.payload.position);
  };
  await listen("tauri://drag-enter", dragHover);
  await listen("tauri://drag-over", dragHover);
  await listen("tauri://drag-leave", () => {
    main.classList.remove("drop-active");
    promptGrid.clearDrop();
  });
  await listen("tauri://drag-drop", (event) => {
    main.classList.remove("drop-active");
    const card = promptGrid.hitTest(event.payload.position);
    promptGrid.clearDrop();
    if (dragging || busy) return;
    const paths = event.payload.paths.filter((p) => /\.(jpe?g|png|webp|heic|gif)$/i.test(p));
    if (paths.length) {
      if (card) promptGrid.select(card);
      acceptImport({ paths }, card?.dataset.promptId || promptId).catch(report);
    } else toast("Choose jpg, jpeg, png, webp, heic, or gif images");
  });
  await task(async () => {
    const config = await invoke("get_config");
    if (config.libraryPath) {
      try {
        await invoke("set_library", { path: config.libraryPath });
        await refresh();
      } catch (e) {
        toast(`Could not open the previous library: ${e}. Choose a folder to continue.`);
      }
    }
  });
}
start().catch(report);
