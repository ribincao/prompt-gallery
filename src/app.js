import { folderControl, tokenControl, inlineName, mountControls } from "./controls.js";
import { createPromptGrid } from "./prompt-cards.js";
import { sourcePhotoPicker, createResultSelection, sourceName, resultName, stem, mediaPoster, mediaPreview, mediaBadge, audioPlaceholder } from "./result-tools.js";

const { invoke, convertFileSrc, Channel } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (s, parent = document) => parent.querySelector(s);
const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
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
let scrollTimer;
main.addEventListener("scroll", () => {
  main.classList.add("is-scrolling");
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => main.classList.remove("is-scrolling"), 700);
}, { passive: true });
let dragging = false;
let sourceFolder = null; // null = folder grid; empty string = Unfiled
let sourceMode = false, sourceAnchor = null, selectedSources = new Set(), visibleSources = [];
const folders = () => library?.folders || [];
const folderOf = (s) => folders().find((f) => f.id === s.folder)?.id || "";
const folderLabel = (id) => folders().find((f) => f.id === id)?.name || "Unfiled";
function folderPicker(selected = "") {
  return folderControl(selected, esc);
}
function folderForm(id = null) {
  const f = folders().find((f) => f.id === id);
  showModal(f ? "Rename folder" : "New folder", `${field("Name", "name", f?.name || "", { required: true })}${footer()}`, async (form) => {
    await invoke(f ? "rename_folder" : "create_folder", { id, name: form.elements.name.value });
    closeModal(); await refresh();
  });
}
async function moveSelected(ids, folder) {
  try { await invoke("move_sources", { ids, folder: folder || null }); }
  finally { await refresh(); }
  selectedSources.clear(); sourceMode = false; render();
}
function moveDialog() {
  const ids = [...selectedSources];
  showModal("Move to…", `${folderPicker()}<p>${ids.length} selected items</p>${footer("Move")}`, async (form) => {
    await moveSelected(ids, form.elements.folder.value); closeModal();
  });
}
function renderSources(items) {
  if (sourceFolder && !folders().some((f) => f.id === sourceFolder)) sourceFolder = null;
  const flat = !!(filter || query.trim());
  visibleSources = flat ? items : items.filter((s) => folderOf(s) === sourceFolder);
  selectedSources = new Set([...selectedSources].filter((id) => visibleSources.some((s) => s.id === id)));
  const grid = !flat && sourceFolder === null;
  const folderCard = (id, name) => {
    const contents = library.sources.filter((s) => folderOf(s) === id);
    return `<article class="card folder-card" data-folder-target="${esc(id)}"><button data-action="open-folder" data-id="${esc(id)}">${contents[0]?.thumbnail ? `<img src="${asset(contents[0].thumbnail)}" alt="">` : '<span class="folder-cover">▱</span>'}<div class="card-body"><h3>${esc(name)}</h3><small>${contents.length} items</small></div></button>${id ? button("folder-menu", "⋯", "folder-menu", `data-id="${esc(id)}" aria-label="Manage ${esc(name)}"`) : ""}</article>`;
  };
  main.innerHTML = `<header class="page-header"><div><h1>${sourceFolder !== null && !flat ? `${button("source-root", "Photos", "back", 'data-folder-target=""')} › ${esc(folderLabel(sourceFolder))}` : "Photos"}</h1><span class="toolbar-count">${grid ? library.sources.length : visibleSources.length}</span></div><div class="actions">${!grid ? `${button("select-sources", sourceMode ? "Done" : "Select")}${sourceMode ? `<small>${selectedSources.size} selected</small>${button("move-sources", "Move to…", "", selectedSources.size ? "" : "disabled")}` : ""}` : ""}${button("paste", "Paste image")}${button("pick-sources", "+ Add photos", "primary")}</div></header>${warnings()}${!grid && folders().length ? `<div class="folder-drop-targets" aria-label="Move by dragging to a folder">${folders().map((f) => button("open-folder", esc(f.name), "chip", `data-id="${esc(f.id)}" data-folder-target="${esc(f.id)}"`)).join("")}</div>` : ""}<div class="grid">${grid ? folders().map((f) => folderCard(f.id, f.name)).join("") + (library.sources.some((s) => !folderOf(s)) ? folderCard("", "Unfiled") : "") + button("new-folder", '<span class="new-folder-icon" aria-hidden="true">▱</span><span class="new-folder-label">+ New folder</span>', "card new-folder") : visibleSources.map((s) => sourceCard(s)).join("")}</div>${!grid && !visibleSources.length ? '<p class="empty">No matching items. Drop files here or choose Add photos.</p>' : ""}`;
}

const prompt = () => library?.prompts.find((p) => p.id === promptId);
const source = (id) => library?.sources.find((s) => s.id === id);
const badges = (tags) => tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("");
const button = (action, label, cls = "", data = "") =>
  `<button type="button" data-action="${action}" class="${cls}" ${data}>${label}</button>`;
const promptGrid = createPromptGrid({ main, asset, esc, badges, button, mediaBadge, audioPlaceholder });
const date = (text) => new Date(text).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const resultSelection = createResultSelection({ asset, esc, button, date });
const photoPicker = (p, chosen = []) =>
  sourcePhotoPicker({ sources: library.sources, needs: p.needs, chosen, asset, esc });
const resultMeta = (r, sourcePhotos) => ({
  sourcePhotos,
  name: r.name ?? null,
  chatUrl: r.chatUrl,
  model: r.model,
  note: r.note,
  favorite: r.favorite,
});
// Leaving a fallback untouched must not turn it into a custom name.
function editedName(value, displayed, stored, file) {
  const name = stem(value, file);
  if (name === displayed) return stored ? stem(stored, file) : null;
  if ([...name].length > 200) throw new Error("Names must be 200 characters or fewer");
  return name || null;
}
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
let dialogControls = null;
function showModal(title, body, submit) {
  dialogControls?.destroy();
  modal.classList.toggle("inspector-dialog", body.includes('class="item-inspector"'));
  modalSubmit = submit;
  modal.classList.toggle("tag-manager", title === "Manage tags");
  $("#modal-content").innerHTML =
    `<div class="dialog-heading"><div class="dialog-header"><h2>${esc(title)}</h2></div><p id="modal-error" class="inline-error" role="alert"></p></div><form id="dialog-form">${body}</form>`;
  const actions = $(".form-actions", $("#dialog-form"));
  if (actions) {
    $(".dialog-header").append(actions);
    $("[type=submit]", actions).setAttribute("form", "dialog-form");
  }
  const text = $('#dialog-form textarea[name="text"]');
  if (text) {
    const grow = () => { text.style.height = "auto"; text.style.height = `${text.scrollHeight}px`; };
    text.addEventListener("input", grow);
    requestAnimationFrame(grow);
  }
  dialogControls = mountControls($("#dialog-form"), {
    folders, tags: () => library?.tags || [], esc, tagColor, report, normalizeName: stem,
    createFolder: async name => {
      const folder = await invoke("create_folder", { name });
      library.folders = [...folders(), folder];
      renderSidebar();
      return folder;
    },
  });
  const media = $(".inspector-preview img, .inspector-preview video, .inspector-preview audio", modal);
  const metadata = $(".media-metadata", modal);
  if (media && metadata) {
    const update = () => {
      const width = media.naturalWidth || media.videoWidth, height = media.naturalHeight || media.videoHeight;
      const duration = Number.isFinite(media.duration) ? media.duration : Number(metadata.dataset.duration);
      metadata.textContent = metadata.dataset.original + (width && height && !media.closest('.audio-preview') ? ` · ${width}×${height}` : '') + (duration > 0 ? ` · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : '');
    };
    media.addEventListener('load', update); media.addEventListener('loadedmetadata', update);
    $(".inspector-preview audio", modal)?.addEventListener('loadedmetadata', e => { metadata.dataset.duration = e.target.duration; update(); });
    update();
  }
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => $(modal.classList.contains("inspector-dialog") ? ".inline-name" : "input:not([type=checkbox]):not([type=hidden]),textarea,button", $("#dialog-form"))?.focus());
}
function closeModal() {
  dialogControls?.destroy();
  modal.close();
  modalSubmit = null;
}
function footer(label = "Save") {
  return `<div class="form-actions">${button("close-modal", "Cancel")}<button class="primary" type="submit">${label}</button></div>`;
}
function field(label, name, value = "", { area = false, full = false, required = false, rows = 2, hint = "" } = {}) {
  return `<label class="field ${full ? "full" : ""}">${esc(label)}${area ? `<textarea name="${name}" rows="${rows}" ${required ? "required" : ""}>${esc(value)}</textarea>` : `<input name="${name}" value="${esc(value)}" ${required ? "required" : ""}>`}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}
function tagTokens(name, chosen = [], label = "Tags", hint = "") {
  return tokenControl(name, chosen, esc, label, hint);
}
function collectedTags(form, name) {
  return [...new Set(new FormData(form).getAll(name))];
}
function warnings() {
  return library.warnings.length
    ? `<details class="warning"><summary>${library.warnings.length} library warning${library.warnings.length === 1 ? "" : "s"} — show files</summary><ul>${library.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>`
    : "";
}
function sourceCard(s) {
  return `<button class="card source-card ${s.id === selectedSource || selectedSources.has(s.id) ? "selected" : ""}" data-action="source" data-id="${s.id}" aria-label="Preview ${esc(sourceName(s))}">${mediaPoster(s, asset, esc, sourceName(s))}<div class="card-body"><h3>${esc(sourceName(s))}</h3>${filter || query.trim() ? `<small class="folder-label">${esc(folderLabel(folderOf(s)))}</small>` : ""}<div class="badges">${badges(s.tags)}</div></div></button>`;
}
function renderSidebar() {
  $("#prompt-count").textContent = library.prompts.length;
  $("#source-count").textContent = library.sources.length;
  $("#nav-prompts").classList.toggle("active", view === "prompts" && !favorites);
  $("#nav-sources").classList.toggle("active", view === "sources");
  $("#favorites").classList.toggle("active", view === "prompts" && favorites);
  $("#favorites").setAttribute("aria-pressed", String(favorites));
  $("#favorites").disabled = view === "sources";
  $("#library-path").textContent = library.root;
  $("#library-path").title = library.root;
  $("#favorite-count").textContent = library.prompts.filter(p => p.favorite).length;
  const usage = new Map(library.tags.map(t => [t, 0]));
  for (const item of [...library.sources, ...library.prompts]) {
    for (const tag of new Set([...(item.tags || []), ...(item.needs || [])])) usage.set(tag, (usage.get(tag) || 0) + 1);
  }
  const tags = [...usage.keys()].sort((a, b) => usage.get(b) - usage.get(a) || a.localeCompare(b));
  const shown = tagsExpanded ? tags : tags.slice(0, 6);
  if (filter && !shown.includes(filter)) shown.push(filter);
  $("#tags").innerHTML = `<button class="tag-filter ${!filter ? "active" : ""}" data-action="filter" data-tag="" aria-pressed="${!filter}">All tags</button>` + shown.map(t =>
    `<button class="tag-filter ${filter === t ? "active" : ""}" data-action="filter" data-tag="${esc(t)}" aria-pressed="${filter === t}"><span class="tag-dot tone-${tagColor(t)}" aria-hidden="true"></span><span class="tag-label">${esc(t)}</span><span class="count">${usage.get(t)}</span></button>`).join("") +
    (tags.length > 6 ? `<button id="more-tags" aria-expanded="${tagsExpanded}">${tagsExpanded ? "Show less" : `${tags.length - shown.length} more`}</button>` : "");
  $("#more-tags")?.addEventListener("click", () => {
    tagsExpanded = !tagsExpanded;
    try { localStorage.setItem("gallery-tags-collapsed", String(!tagsExpanded)); } catch {}
    renderSidebar();
  });
}
function render() {
  renderView();
  const header = $(".page-header", main);
  if (!header) return;
  const heading = $("#toolbar-heading"), actions = $("#toolbar-actions");
  heading.replaceChildren(...header.firstElementChild.childNodes);
  actions.replaceChildren(...$(".actions", header).childNodes);
  const back = $(":scope > .back", main);
  if (back) heading.prepend(back);
  $("h1", heading)?.setAttribute("data-tauri-drag-region", "");
  const metadata = $(".badges", heading);
  if (metadata) {
    metadata.classList.add("detail-tags");
    main.prepend(metadata);
  }
  header.remove();
}
let tagsExpanded = true;
try { tagsExpanded = localStorage.getItem("gallery-tags-collapsed") !== "true"; } catch {}
function tagColor(name) {
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.codePointAt(0)) | 0;
  return Math.abs(hash) % 6;
}
function renderView() {
  if (!library) return;
  renderSidebar();
  if (promptId && !prompt()) promptId = null;
  if (promptId) {
    renderPrompt();
    promptGrid.afterRender();
    return;
  }
  resultSelection.reset();
  const isPrompts = view === "prompts";
  const items = (isPrompts ? library.prompts : library.sources).filter((item) => {
    const tags = isPrompts ? [...item.tags, ...item.needs] : item.tags;
    const text = isPrompts ? [item.title, item.text, item.notes, ...item.results.map((r) => resultName(r, date)), ...tags] : [sourceName(item), item.originalName, item.note, ...tags];
    return (
      (!filter || tags.includes(filter)) &&
      (!isPrompts || !favorites || item.favorite) &&
      text.join(" ").toLowerCase().includes(query.toLowerCase())
    );
  });
  if (!isPrompts) { renderSources(items); return; }
  main.innerHTML = `<header class="page-header"><div><h1>${favorites ? "Favorites" : filter ? esc(filter) : "Prompts"}</h1><span class="toolbar-count">${items.length}</span></div><div class="actions">${!isPrompts ? button("paste", "Paste image") : ""}${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "+ New" : "+ Add photos", "primary")}</div></header>${warnings()}${items.length ? `<div class="grid"></div>` : `<section class="empty"><div class="hero-mark">${isPrompts ? "▤" : "▧"}</div><h2>${query || filter || favorites ? "Nothing matches yet" : isPrompts ? "Your next idea starts here" : "Bring your own inspiration"}</h2><p>${query || filter || favorites ? "Try a different search or clear your filters." : isPrompts ? "Save a prompt, then collect what it creates. You can also paste a block of prompt text here." : "Drop photos here, paste an image, or choose files. Originals are always copied and left untouched."}</p>${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "Create a prompt" : "Choose photos", "primary")}</section>`}`;
  if (items.length) promptGrid.mount($(".grid", main), items, library.root, library.prompts.map(p => p.id));
  promptGrid.afterRender();
}
function renderPrompt() {
  const p = prompt();
  resultSelection.begin(p.id, p.results);
  main.innerHTML = `${button("back", "‹ All prompts", "back")}<header class="page-header"><div><h1>${esc(p.title)}</h1><div class="badges">${badges(p.needs.length ? p.needs : ["text-only"])}${badges(p.tags)}</div></div><div class="actions">${button("favorite-prompt", p.favorite ? "★" : "☆", "", `aria-label="${p.favorite ? "Remove from" : "Add to"} favorites"`)}${button("edit-prompt", "Edit")}${button("copy-prompt", "Copy prompt", "primary")}</div></header>${warnings()}<pre class="prompt-text">${esc(p.text)}</pre>${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ""}${p.sourceUrl ? button("open-url", "Original source ↗", "", `data-url="${esc(p.sourceUrl)}"`) : ""}<section><div class="section-header"><h2>Results <small>(${p.results.length})</small></h2><div class="actions">${p.results.length ? resultSelection.toolbar() : ""}${button("paste", "Paste image")}${button("pick-results", "+ Add result")}</div></div>${p.results.length ? `<div class="grid">${p.results.map((r) => resultSelection.card(r, p.id)).join("")}</div>` : '<p class="muted">Drop, paste, or choose a generated image to keep it with this prompt.</p>'}</section><div class="section-header">${button("delete-prompt", "Move prompt to Trash", "danger")}</div>`;
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
modal.addEventListener("close", () => { $$("video, audio", modal).forEach((v) => v.pause()); setTimeout(flushLibraryRefresh, 0); });
lightbox.addEventListener("close", () => { $$("video, audio", lightbox).forEach((v) => v.pause()); setTimeout(flushLibraryRefresh, 0); });
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
    `<div class="form-grid">${field("Title", "title", p?.title || "", { required: true, full: true })}${field("Prompt text", "text", p?.text ?? text, { area: true, rows: 4, full: true })}<div class="full"><label class="field">Photos it needs<small>Photos with these tags are listed first when you link results. Leave empty for a text-only prompt.</small></label>${tagTokens("needs", p?.needs, "Needs")}</div>${tagTokens("tags", p?.tags, "Style tags", "Describe the look or style of this prompt.")}${field("Source URL", "sourceUrl", p?.sourceUrl || "")}${field("Notes", "notes", p?.notes || "", { area: true, full: true })}</div>${footer(p ? "Save changes" : "Create prompt")}`,
    async (form) => {
      const values = new FormData(form),
        meta = {
          title: values.get("title").trim(),
          needs: collectedTags(form, "needs"),
          tags: values.getAll("tags"),
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
function inspector(item, name, fields, result) {
  const copy = item.kind === "audio" ? "Copy audio" : item.kind === "video" ? "Copy video" : "Copy image";
  const data = `data-id="${esc(item.id)}"`;
  const icon = path => `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>`;
  return `<div class="item-inspector"><div class="inspector-media"><div class="inspector-preview">${mediaPreview(item, asset, esc, name, "source-preview")}</div><div class="media-actions">${button(result ? "copy-result" : "copy-image", icon('M8 8h12v12H8z M16 8V4H4v12h4') + copy, "", data)}${button(result ? "reveal-result" : "reveal", icon('M3 7h7l2 2h9v11H3z M3 7V4h7l2 3') + 'Reveal', "", data)}${button(result ? "delete-result" : "delete-source", icon('M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'), "danger trash-icon", `${data} title="Move to Trash" aria-label="Move to Trash"`)}</div></div><div class="inspector-details">${inlineName(name, esc, item.file || item.originalName || item.path)}<p class="media-metadata muted" data-original="${esc(item.originalName ? 'Original file: ' + item.originalName : 'Created ' + date(item.createdAt))}" data-duration="${item.durationSeconds || ''}"></p>${fields}</div></div>`;
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
    sourceName(s),
    `${inspector(s, sourceName(s), `${folderPicker(folderOf(s))}${tagTokens("tags", s.tags)}${field("Note", "note", s.note, { area: true })}<div class="source-uses"><h3>Used in ${uses.length} results</h3><div class="inspector-links">${uses.map(({p,r}) => button("result", `${mediaPoster(r, asset, esc, resultName(r,date))}<span class="sr-only">${esc(resultName(r,date))}</span>`, "inspector-thumb", `data-id="${esc(r.id)}" data-pid="${esc(p.id)}" title="${esc(p.title + ' · ' + resultName(r,date))}"`)).join("")}</div>${!uses.length ? '<small>No linked results yet.</small>' : ''}</div>`, false)}${footer("Save")}`,

    async (form) => {
      await invoke("update_source", {
        id,
        tags: collectedTags(form, "tags"),
        note: form.elements.note.value,
        name: editedName(form.elements.name.value, sourceName(s), s.name, s.file || s.originalName),
      });
      await invoke("move_sources", { ids: [id], folder: form.elements.folder.value || null });
      closeModal();
      await refresh();
      toast("Photo details saved");
    },
  );
}
function importedTags(ids) {
  showModal(
    `Tag ${ids.length === 1 ? "your photo" : `your ${ids.length} photos`}`,
    `<p class="muted">The originals have been copied into your library. Add tags to match them with prompts.</p>${tagTokens("tags")}${footer("Save tags")}`,
    async (form) => {
      const tags = collectedTags(form, "tags");
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
    if (sourceFolder && !filter && !query.trim()) await invoke("move_sources", { ids, folder: sourceFolder });
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
    `<div class="dialog-header"><div class="actions">${button("prev-result", "←", "", `aria-label="Previous result" ${lightIndex === 0 ? "disabled" : ""}`)}<small>${lightIndex + 1} / ${lightItems.length}</small>${button("next-result", "→", "", `aria-label="Next result" ${lightIndex === lightItems.length - 1 ? "disabled" : ""}`)}</div>${button("close-lightbox", "✕", "icon", 'aria-label="Close result"')}</div>${mediaPreview(r, asset, esc, resultName(r, date), "lightbox-image")}<div class="lightbox-footer"><div class="actions"><small>${esc(resultName(r, date))} · ${esc(r.model)}</small><div class="actions">${button("favorite-result", r.favorite ? "★ Favorite" : "☆ Favorite")}${button("copy-result", r.kind === "audio" ? "Copy audio" : r.kind === "video" ? "Copy video" : "Copy image")}${button("edit-result", "Edit")}${r.chatUrl ? button("open-url", "Open chat ↗", "primary", `data-url="${esc(r.chatUrl)}"`) : ""}${button("delete-result", "Move to Trash", "danger")}</div></div>${r.note ? `<p>${esc(r.note)}</p>` : ""}<div class="image-sources">${r.sourcePhotos.length ? "<small>Photos:</small>" : ""}${r.sourcePhotos
      .map((id) => {
        const s = source(id);
        return s
          ? button(
              "light-source",
              `${mediaPoster(s, asset, esc)}<span>${esc(sourceName(s))}</span>`,
              "linked-source",
              `data-id="${esc(id)}" aria-label="Open source photo ${esc(sourceName(s))}"`,
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
    `${inspector(r, resultName(r,date), `<div class="result-properties">${field("Chat URL", "chatUrl", r.chatUrl)}${field("Model", "model", r.model)}</div>${field("Note", "note", r.note, {area:true})}<div class="inspector-sources">${photoPicker(library.prompts.find(p => p.id === pid), r.sourcePhotos).replace('Photos used</legend>', 'Source photos</legend>')}</div>`, true)}${footer()}`,

    async (form) => {
      const f = new FormData(form);
      await invoke("update_result", {
        promptId: pid,
        id: r.id,
        meta: {
          name: editedName(f.get("name"), resultName(r, date), r.name, r.file || r.path),
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
    "Set photos",
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
      toast(`Photos set for ${items.length} results`);
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
  else toast("Hover or focus a prompt card to add results, or switch to Photos");
}
async function pickResults(pid = promptId) {
  if (!pid || modal.open || lightbox.open) return;
  await task(async () => {
    const paths = await invoke("pick_image_files");
    if (paths.length) await addResults({ paths }, pid);
  });
}
function navigate(next) {
  sourceFolder = null; sourceMode = false; selectedSources.clear();
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
    sourceFolder = null;
    filter = el.dataset.tag;
    promptId = null;
    render();
  },
  source: (el, event) => {
    if (dragging) return;
    if (view === "sources" && !promptId && (sourceMode || event.metaKey || event.ctrlKey || event.shiftKey)) {
      sourceMode = true;
      const id = el.dataset.id;
      if (event.shiftKey && sourceAnchor && visibleSources.some((s) => s.id === sourceAnchor)) {
        const a = visibleSources.findIndex((s) => s.id === sourceAnchor), b = visibleSources.findIndex((s) => s.id === id);
        visibleSources.slice(Math.min(a,b), Math.max(a,b)+1).forEach((s) => selectedSources.add(s.id));
      } else { selectedSources.has(id) ? selectedSources.delete(id) : selectedSources.add(id); sourceAnchor = id; }
      render();
    } else openSource(el.dataset.id);
  },
  "new-folder": () => folderForm(),
  "rename-folder": (el) => folderForm(el.dataset.id),
  "delete-folder": (el) => showModal("Delete folder?", `<p>Its items will become Unfiled. All media is kept.</p>${footer("Delete folder")}`, async () => { await invoke("delete_folder", { id: el.dataset.id }); closeModal(); await refresh(); }),
  "open-folder": (el) => { sourceFolder = el.dataset.id; sourceMode = false; selectedSources.clear(); render(); },
  "source-root": () => { sourceFolder = null; sourceMode = false; selectedSources.clear(); render(); },
  "select-sources": () => { sourceMode = !sourceMode; selectedSources.clear(); render(); },
  "move-sources": () => moveDialog(),
  "folder-menu": (el) => folderMenu(el.dataset.id, el.getBoundingClientRect()),
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
  "reveal-result": () => invoke("reveal_in_finder", { path: lightItems[lightIndex].path }),
  "copy-result": async () => { await invoke("copy_image_to_clipboard", { path: lightItems[lightIndex].path }); toast("Copied"); },
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
  dialogControls?.commit();
  if (modalSubmit) task(() => modalSubmit(e.target));
});
modal.addEventListener("close", () => dialogControls?.destroy());
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
  sourceFolder = null;
  query = e.target.value;
  promptId = null;
  render();
});
$("#favorites").addEventListener("click", () => {
  favorites = !favorites;
  promptId = null;
  render();
});
let tagRows = [];
let tagEdit = null;
const tagUse = (row) => `${row.sources} photo${row.sources === 1 ? "" : "s"} · ${row.prompts} prompt${row.prompts === 1 ? "" : "s"}`;
async function manageTags() {
  tagRows = await invoke("tag_usage");
  tagEdit = null;
  showModal("Manage tags", `<div class="add-tag">${field("Add tag", "newTag")}<button type="submit" class="primary">Add</button></div><div id="tag-list" aria-label="Tags"></div>`, async (form) => {
    if (tagEdit) return;
    const tag = form.elements.newTag.value.trim();
    if (!tag) throw new Error("Enter a tag name.");
    await changeTag("set_tags", { tags: [tag] });
  });
  $(".dialog-header").insertAdjacentHTML("beforeend", button("close-modal", "Done"));
  renderTagRows();
}
function renderTagRows() {
  $("#tag-list").innerHTML = tagRows.map((row, index) => {
    const editing = tagEdit?.tag === row.tag;
    let controls = `<span class="tag-name">${esc(row.tag)}</span><small>${tagUse(row)}</small><div class="actions"><button type="button" data-tag-op="rename" data-index="${index}">Rename</button><button type="button" data-tag-op="remove" data-index="${index}" class="danger">Remove</button></div>`;
    if (editing) {
      controls = tagEdit.mode === "rename"
        ? `<label class="field">Rename ${esc(row.tag)}<input id="rename-tag" value="${esc(tagEdit.to ?? row.tag)}" aria-label="New tag name"></label><p class="tag-confirm" aria-live="polite"></p><div class="actions"><button type="button" data-tag-op="confirm" data-index="${index}" class="primary">Save</button><button type="button" data-tag-op="cancel">Cancel</button></div>`
        : `<p>Remove '${esc(row.tag)}' from ${row.sources} photos and ${row.prompts} prompts? Photos and prompts are kept.</p><div class="actions"><button type="button" class="danger" data-tag-op="confirm" data-index="${index}">Remove</button><button type="button" data-tag-op="cancel">Cancel</button></div>`;
    }
    return `<div class="tag-row ${editing ? "editing" : ""}">${controls}</div>`;
  }).join("");
  if (tagEdit?.mode === "rename") {
    const input = $("#rename-tag");
    input.addEventListener("input", () => {
      tagEdit.to = input.value.trim();
      tagEdit.confirmedMerge = false;
      const merge = tagRows.some((r) => r.tag === tagEdit.to && r.tag !== tagEdit.tag);
      $(".tag-confirm").textContent = merge ? `This will merge '${tagEdit.tag}' into '${tagEdit.to}' on all photos and prompts.` : "Rename on all photos and prompts.";
    });
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.select();
  }
}
async function changeTag(command, args) {
  try {
    const result = await invoke(command, args);
    if (filter === (args.tag ?? args.from)) filter = args.to || "";
    await refresh();
    await manageTags();
    if (result) {
      const message = `Updated ${result.sources} photos and ${result.prompts} prompts.`;
      $("#modal-error").textContent = [message, ...(result.warnings || [])].join(" ");
    }
  } catch (error) {
    // An atomic write can fail after earlier records have changed. Refresh both
    // views even on failure, but preserve the backend's partial-progress error.
    await refresh();
    await manageTags();
    throw error;
  }
}
$("#modal-content").addEventListener("click", (e) => {
  const el = e.target.closest("[data-tag-op]");
  if (!el || busy) return;
  const row = tagRows[Number(el.dataset.index)];
  if (el.dataset.tagOp === "cancel") { tagEdit = null; renderTagRows(); return; }
  if (el.dataset.tagOp !== "confirm") {
    tagEdit = { tag: row.tag, mode: el.dataset.tagOp };
    renderTagRows();
    return;
  }
  task(async () => {
    if (tagEdit.mode === "remove") return changeTag("remove_tag", { tag: row.tag });
    const to = $("#rename-tag").value.trim();
    if (!to) throw new Error("Tag names cannot be empty.");
    const merge = tagRows.some((r) => r.tag === to && r.tag !== row.tag);
    if (merge && !tagEdit.confirmedMerge) {
      tagEdit.confirmedMerge = true;
      el.textContent = "Confirm merge";
      return;
    }
    await changeTag("rename_tag", { from: row.tag, to });
  });
});
$("#manage-tags").addEventListener("click", () => {
  if (library) task(manageTags);
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
  if (modal.open && e.key === "Enter" && !e.isComposing &&
      ((e.metaKey || e.ctrlKey) || e.target.matches("input:not([type=checkbox])"))) {
    e.preventDefault();
    if (busy) return;
    const inline = e.target.closest(".tag-row")?.querySelector('[data-tag-op="confirm"]');
    if (inline) inline.click();
    else $("#dialog-form").requestSubmit();
    return;
  }
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
  const folder = e.target.closest(".folder-card");
  if (folder?.dataset.folderTarget) { e.preventDefault(); folderMenu(folder.dataset.folderTarget, {left:e.clientX,bottom:e.clientY}); return; }
  const card = e.target.closest(".source-card");
  if (!card) return;
  e.preventDefault();
  selectedSource = card.dataset.id;
  const menu = $("#context-menu");
  menu.innerHTML =
    button("copy-image", source(selectedSource)?.kind === "audio" ? "Copy audio" : source(selectedSource)?.kind === "video" ? "Copy video" : "Copy image", "", `data-id="${selectedSource}"`) +
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
  const card = e.target.closest(".source-card, .result-card");
  if (!card || e.button !== 0 || busy || e.metaKey || e.shiftKey || e.ctrlKey) return;
  const isSource = card.classList.contains("source-card");
  const s = isSource ? source(card.dataset.id) : library.prompts.find((p) => p.id === card.dataset.pid)?.results.find((r) => r.id === card.dataset.id),
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
    if (isSource) selectedSource = s.id;
    const onEvent = new Channel();
    onEvent.onmessage = () => setTimeout(() => (dragging = false), 150);
    invoke("plugin:drag|start_drag", {
      item: isSource && selectedSources.has(s.id) ? library.sources.filter((s) => selectedSources.has(s.id)).map((s) => s.path) : [s.path],
      image: s.thumbnail || (["video", "audio"].includes(s.kind) ? new URL("./app-icon.png", location.href).href : s.path),
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
  if (e.target.closest(".source-card, .result-card")) e.preventDefault();
});
async function start() {
  await listen("library-changed", (event) => {
    if (library && event.payload === library.root) {
      pendingLibraryRefresh = true;
      flushLibraryRefresh();
    }
  });
  const dragHover = (event) => {
    if (busy || modal.open || lightbox.open) return;
    const pos = event.payload.position, scale = window.devicePixelRatio || 1;
    const target = pos && document.elementFromPoint(pos.x / scale, pos.y / scale)?.closest("[data-folder-target]");
    $$(".folder-drop-active").forEach((el) => el.classList.remove("folder-drop-active"));
    target?.classList.add("folder-drop-active");
    if (dragging) return;
    main.classList.add("drop-active");
    promptGrid.highlightDrop(event.payload.position);
  };
  await listen("tauri://drag-enter", dragHover);
  await listen("tauri://drag-over", dragHover);
  await listen("tauri://drag-leave", () => {
    $$(".folder-drop-active").forEach((el) => el.classList.remove("folder-drop-active"));
    main.classList.remove("drop-active");
    promptGrid.clearDrop();
  });
  await listen("tauri://drag-drop", (event) => {
    $$(".folder-drop-active").forEach((el) => el.classList.remove("folder-drop-active"));
    main.classList.remove("drop-active");
    const card = promptGrid.hitTest(event.payload.position);
    promptGrid.clearDrop();
    if (busy) return;
    const pos = event.payload.position, scale = window.devicePixelRatio || 1;
    const target = pos && document.elementFromPoint(pos.x / scale, pos.y / scale)?.closest("[data-folder-target]");
    const internal = event.payload.paths.map((path) => library?.sources.find((s) => s.path === path)?.id);
    if (target && internal.length && internal.every(Boolean)) { task(() => moveSelected(internal, target.dataset.folderTarget)); return; }
    if (dragging) return;
    const paths = event.payload.paths.filter((p) => /\.(jpe?g|png|webp|heic|gif|mp4|mov|m4v|mp3|m4a|aac|wav|aif|aiff|flac)$/i.test(p));
    if (paths.length) {
      if (card) promptGrid.select(card);
      acceptImport({ paths }, card?.dataset.promptId || promptId).catch(report);
    } else toast("Choose a supported image, video or audio file");
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

function folderMenu(id, rect) {
  const menu = $("#context-menu");
  menu.innerHTML = button("rename-folder", "Rename", "", `data-id="${esc(id)}"`) + button("delete-folder", "Delete", "danger", `data-id="${esc(id)}"`);
  menu.hidden = false; menu.style.left = `${Math.min(rect.left, innerWidth - 200)}px`; menu.style.top = `${Math.min(rect.bottom, innerHeight - 120)}px`;
}
