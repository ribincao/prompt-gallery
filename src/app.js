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
let filter = [],
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
  const flat = !!(filter.length || query.trim());
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
const lineIcon = (path) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const copyIcon = lineIcon('<rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 3V1.5h-8v9H4"/>');
const checkIcon = lineIcon('<path d="m3 8 3 3 7-7"/>');
const moreIcon = lineIcon('<path d="M3 8h.01M8 8h.01M13 8h.01"/>');
let copyFeedbackTimer;
const promptGrid = createPromptGrid({ main, asset, esc, badges, button, mediaBadge, audioPlaceholder });
const date = (text) => new Date(text).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const resultSelection = createResultSelection({ asset, esc, button, date });
const photoPicker = (p, chosen = []) =>
  sourcePhotoPicker({ sources: library.sources, folders: folders(), chosen, asset, esc });
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
// The toast is a manual popover so it joins the top layer above any open dialog;
// hiding and re-showing it puts it on top of a dialog opened after it.
function toast(message) {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  try { if (el.matches(":popover-open")) el.hidePopover(); el.showPopover(); } catch {}
  toastTimer = setTimeout(() => {
    el.hidden = true;
    try { el.hidePopover(); } catch {}
  }, 5000);
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
  modal.classList.toggle("tag-manager", ["Manage tags", "Manage categories"].includes(title));
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
    folders, tags: () => library?.tags || [], categories: () => library?.categories || [], esc, tagColor, report, normalizeName: stem,
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
  // Inspectors open without focusing the name, so it isn't shown selected and a stray key can't replace it.
  requestAnimationFrame(() => modal.classList.contains("inspector-dialog") ? modal.focus() : $("input:not([type=checkbox]):not([type=hidden]),textarea,button", $("#dialog-form"))?.focus());
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
  return `<button class="card source-card ${s.id === selectedSource || selectedSources.has(s.id) ? "selected" : ""}" data-action="source" data-id="${s.id}" aria-label="Preview ${esc(sourceName(s))}">${mediaPoster(s, asset, esc, sourceName(s))}<div class="card-body"><h3>${esc(sourceName(s))}</h3>${filter.length || query.trim() ? `<small class="folder-label">${esc(folderLabel(folderOf(s)))}</small>` : ""}<div class="badges">${badges(s.tags)}</div></div></button>`;
}
function renderSidebar() {
  $("#prompt-count").textContent = library.prompts.length;
  $("#source-count").textContent = library.sources.length;
  $("#nav-prompts").classList.toggle("active", view === "prompts" && !favorites);
  $("#nav-sources").classList.toggle("active", view === "sources");
  $("#favorites").classList.toggle("active", view === "prompts" && favorites);
  $("#favorites").setAttribute("aria-pressed", String(favorites));

  $("#library-path span").textContent = library.root.split("/").filter(Boolean).pop() || "/";
  $("#library-path").title = library.root;
  $("#favorite-count").textContent = library.prompts.filter(p => p.favorite).length;
  const isCategories = view === "prompts", label = isCategories ? "Categories" : "Tags";
  $("#vocabulary-label").textContent = label;
  $("#manage-tags").setAttribute("aria-label", `Manage ${label.toLowerCase()}`);
  const tagsExpanded = expanded[view];
  const usage = new Map((isCategories ? library.categories : library.tags).map(t => [t, 0]));
  for (const item of isCategories ? library.prompts : library.sources) {
    for (const tag of new Set(isCategories ? item.categories : item.tags)) usage.set(tag, (usage.get(tag) || 0) + 1);
  }
  const tags = [...usage.keys()].sort((a, b) => usage.get(b) - usage.get(a) || a.localeCompare(b));
  const shown = tagsExpanded ? tags : tags.slice(0, 6);
  for (const t of filter) if (!shown.includes(t)) shown.push(t);
  $("#tags").innerHTML = `<button class="tag-filter ${!filter.length ? "active" : ""}" data-action="filter" data-tag="" aria-pressed="${!filter.length}">All ${label.toLowerCase()}</button>` + shown.map(t =>
    `<button class="tag-filter ${filter.includes(t) ? "active" : ""}" data-action="filter" data-tag="${esc(t)}" aria-pressed="${filter.includes(t)}"><span class="tag-dot tone-${tagColor(t)}" aria-hidden="true"></span><span class="tag-label">${esc(t)}</span><span class="count">${usage.get(t)}</span></button>`).join("") +
    (tags.length > 6 ? `<button id="more-tags" aria-expanded="${tagsExpanded}">${tagsExpanded ? "Show less" : `${tags.length - shown.length} more`}</button>` : "");
  $("#more-tags")?.addEventListener("click", () => {
    expanded[view] = !tagsExpanded;
    try { localStorage.setItem(isCategories ? "gallery-categories-collapsed" : "gallery-tags-collapsed", String(!expanded[view])); } catch {}
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
const expanded = {prompts: true, sources: true};
const filters = {prompts: [], sources: []};
try { expanded.sources = localStorage.getItem("gallery-tags-collapsed") !== "true"; expanded.prompts = localStorage.getItem("gallery-categories-collapsed") !== "true"; } catch {}
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
    const tags = isPrompts ? item.categories : item.tags;
    const text = isPrompts ? [item.title, item.text, item.notes, ...item.results.map((r) => resultName(r, date)), ...tags] : [sourceName(item), item.originalName, item.note, ...tags];
    return (
      filter.every((t) => tags.includes(t)) &&
      (!isPrompts || !favorites || item.favorite) &&
      text.join(" ").toLowerCase().includes(query.toLowerCase())
    );
  });
  if (!isPrompts) { renderSources(items); return; }
  main.innerHTML = `<header class="page-header"><div><h1>${favorites ? "Favorites" : filter.length ? esc(filter.join(" + ")) : "Prompts"}</h1><span class="toolbar-count">${items.length}</span></div><div class="actions">${!isPrompts ? button("paste", "Paste image") : ""}${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "+ New" : "+ Add photos", "primary")}</div></header>${warnings()}${items.length ? `<div class="grid"></div>` : `<section class="empty"><div class="hero-mark">${isPrompts ? "▤" : "▧"}</div><h2>${query || filter.length || favorites ? "Nothing matches yet" : isPrompts ? "Your next idea starts here" : "Bring your own inspiration"}</h2><p>${query || filter.length || favorites ? "Try a different search or clear your filters." : isPrompts ? "Save a prompt, then collect what it creates. You can also paste a block of prompt text here." : "Drop photos here, paste an image, or choose files. Originals are always copied and left untouched."}</p>${button(isPrompts ? "new-prompt" : "pick-sources", isPrompts ? "Create a prompt" : "Choose photos", "primary")}</section>`}`;
  if (items.length) promptGrid.mount($(".grid", main), items, library.root, library.prompts.map(p => p.id));
  promptGrid.afterRender();
}
// "Try with another photo": every photo, filtered by photo tags (AND) and name, ready to drag or ⌘C.
const tryState = { open: false, tags: [], query: "" };
try { tryState.open = localStorage.getItem("gallery-try-open") === "true"; } catch {}
function tryMatches() {
  const q = tryState.query.trim().toLowerCase();
  return library.sources.filter((s) => tryState.tags.every((t) => s.tags.includes(t)) &&
    (!q || [sourceName(s), s.note, ...s.tags].some((v) => (v || "").toLowerCase().includes(q))));
}
function tryGrid() {
  const items = tryMatches();
  return items.length
    ? items.map((s) => `<button class="card source-card try-card ${s.id === selectedSource ? "selected" : ""}" data-action="try-source" data-id="${s.id}" aria-label="Select ${esc(sourceName(s))}">${mediaPoster(s, asset, esc, sourceName(s))}<div class="card-body"><h3>${esc(sourceName(s))}</h3></div></button>`).join("")
    : `<p class="muted">${library.sources.length ? "No photos match these filters." : "No photos yet. Add some in Photos."}</p>`;
}
function tryChips() {
  const usage = new Map();
  for (const s of library.sources) for (const t of new Set(s.tags)) usage.set(t, (usage.get(t) || 0) + 1);
  const tags = [...usage.keys()].sort((a, b) => usage.get(b) - usage.get(a) || a.localeCompare(b));
  for (const t of tryState.tags) if (!tags.includes(t)) tags.push(t);
  return button("try-tag", "All", `chip ${tryState.tags.length ? "" : "active"}`, `data-tag="" aria-pressed="${!tryState.tags.length}"`) +
    tags.map((t) => button("try-tag", `${esc(t)} <small>${usage.get(t) || 0}</small>`, `chip ${tryState.tags.includes(t) ? "active" : ""}`, `data-tag="${esc(t)}" aria-pressed="${tryState.tags.includes(t)}"`)).join("");
}
function tryPanel() {
  const head = `<div class="section-header"><h2>Try with another photo</h2><div class="actions">${tryState.open ? button("copy-prompt", "Copy prompt") : ""}${button("toggle-try", tryState.open ? "Hide photos" : "Choose a photo…", "", `id="toggle-try" aria-expanded="${tryState.open}" aria-controls="try-panel"`)}</div></div>`;
  if (!tryState.open) return `<section class="try-section">${head}</section>`;
  return `<section class="try-section">${head}<div id="try-panel"><div class="try-filters"><input id="try-search" type="search" placeholder="Search photos" value="${esc(tryState.query)}" autocomplete="off" aria-label="Search photos"><div class="chips" id="try-chips">${tryChips()}</div></div><small class="muted">Copy the prompt, then drag a photo into ChatGPT. Or click a photo and press ⌘C.</small><div class="grid try-grid" id="try-grid">${tryGrid()}</div></div></section>`;
}
function refreshTry() {
  const grid = $("#try-grid", main), chips = $("#try-chips", main);
  if (grid) grid.innerHTML = tryGrid();
  if (chips) chips.innerHTML = tryChips();
}
main.addEventListener("input", (e) => {
  if (e.target.id !== "try-search") return;
  tryState.query = e.target.value;
  const grid = $("#try-grid", main);
  if (grid) grid.innerHTML = tryGrid();
});
// Shows **bold** from pasted ChatGPT prompts; Copy prompt still copies the raw text.
const promptMarkup = (text) => esc(text).replace(/\*\*([^*\n][^\n]*?)\*\*/g, "<strong>$1</strong>");
let promptTextExpanded = null;
function measurePromptText() {
  const wrap = $(".prompt-text-wrap", main), pre = $(".prompt-text", main), more = $(".prompt-more", main);
  if (!wrap || !more) return;
  const long = wrap.classList.contains("expanded") || pre.scrollHeight > pre.clientHeight + 2;
  more.hidden = !long;
  wrap.classList.toggle("clamped", long && !wrap.classList.contains("expanded"));
}
function renderPrompt() {
  const p = prompt();
  resultSelection.begin(p.id, p.results);
  main.innerHTML = `${button("back", "‹ All prompts", "back")}<header class="page-header"><div><h1>${esc(p.title)}</h1><div class="badges">${badges(p.categories)}</div></div><div class="actions">${button("favorite-prompt", p.favorite ? "★" : "☆", "", `aria-label="${p.favorite ? "Remove from" : "Add to"} favorites"`)}${button("edit-prompt", "Edit")}${button("prompt-menu", moreIcon, "", 'aria-label="More" title="More" aria-haspopup="menu" aria-expanded="false" aria-controls="context-menu"')}${button("copy-prompt", "Copy prompt", "primary")}</div></header>${warnings()}<div class="prompt-text-wrap ${promptTextExpanded === p.id ? "expanded" : ""}"><pre class="prompt-text">${promptMarkup(p.text)}</pre>${button("copy-prompt", copyIcon, "prompt-copy", 'aria-label="Copy prompt" title="Copy prompt"')}${button("toggle-prompt-text", promptTextExpanded === p.id ? "Show less" : "Show more", "prompt-more", "hidden")}</div>${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ""}${tryPanel()}<section><div class="section-header"><h2>Results <small>(${p.results.length})</small></h2><div class="actions">${p.results.length ? resultSelection.toolbar() : ""}${button("add-result-menu", "+ Add result", "", 'aria-haspopup="menu" aria-expanded="false" aria-controls="context-menu"')}</div></div>${p.results.length ? `<div class="grid ${p.results.length <= 3 ? "results-grid-large" : ""}">${p.results.map((r) => resultSelection.card(r, p.id)).join("")}</div>` : '<p class="muted">Drop, paste, or choose a generated image to keep it with this prompt.</p>'}</section>`;
  measurePromptText();
  requestAnimationFrame(measurePromptText);
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
    `<div class="form-grid">${field("Title", "title", p?.title || "", { required: true, full: true })}${field("Prompt text", "text", p?.text ?? text, { area: true, rows: 4, full: true })}${tagTokens("categories", p?.categories, "Categories")}${field("Source URL", "sourceUrl", p?.sourceUrl || "")}${field("Notes", "notes", p?.notes || "", { area: true, full: true })}</div>${footer(p ? "Save changes" : "Create prompt")}`,
    async (form) => {
      const values = new FormData(form),
        meta = {
          title: values.get("title").trim(),
          needs: p?.needs || [], // Needs are retired; keep whatever older prompts stored.
          categories: values.getAll("categories"),
          sourceUrl: values.get("sourceUrl").trim(),
          notes: values.get("notes"),
          favorite: p?.favorite || false,
        };
      if (p) await invoke("update_prompt", { id: p.id, meta, text: values.get("text") });
      else promptId = await invoke("create_prompt", { meta, text: values.get("text") });
      closeModal();
      filters[view] = filter; view = "prompts"; filter = filters.prompts;
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
    if (sourceFolder && !filter.length && !query.trim()) await invoke("move_sources", { ids, folder: sourceFolder });
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
    `<p class="muted">${(data.paths?.length ?? 1) === 1 ? "1 image" : `${data.paths.length} images`} ready to add to <strong>${esc(targetPrompt.title)}</strong>.</p>${photoPicker(targetPrompt, selectedSource ? [selectedSource] : [])}<div class="tag-editor">${field("Chat URL", "chatUrl", chatUrl, { hint: "Optional. Open this conversation later in your default browser." })}</div><div class="tag-editor">${field("Note", "note", "", { area: true })}</div>${footer("Add results")}`,
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
  filters[view] = filter;
  view = next;
  filter = filters[view];
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
    const tag = el.dataset.tag;
    // Click adds a tag to the filter, click again removes it; "All" clears. Items must match every tag.
    filter = !tag ? [] : filter.includes(tag) ? filter.filter((t) => t !== tag) : [...filter, tag];
    promptId = null;
    render();
  },
  "toggle-prompt-text": () => {
    promptTextExpanded = promptTextExpanded === promptId ? null : promptId;
    const wrap = $(".prompt-text-wrap", main);
    wrap.classList.toggle("expanded", promptTextExpanded === promptId);
    $(".prompt-more", main).textContent = promptTextExpanded === promptId ? "Show less" : "Show more";
    measurePromptText();
  },
  "toggle-try": () => {
    tryState.open = !tryState.open;
    try { localStorage.setItem("gallery-try-open", String(tryState.open)); } catch {}
    render();
    if (tryState.open) $("#try-panel", main)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  },
  "try-tag": (el) => {
    const tag = el.dataset.tag;
    tryState.tags = !tag ? [] : tryState.tags.includes(tag) ? tryState.tags.filter((t) => t !== tag) : [...tryState.tags, tag];
    refreshTry();
  },
  "try-source": (el) => {
    if (dragging) return;
    selectedSource = el.dataset.id;
    $$(".try-card", main).forEach((c) => c.classList.toggle("selected", c.dataset.id === selectedSource));
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
    const icon = $(".prompt-copy");
    if (icon) {
      clearTimeout(copyFeedbackTimer);
      icon.innerHTML = checkIcon;
      copyFeedbackTimer = setTimeout(() => { if (icon.isConnected) icon.innerHTML = copyIcon; }, 1500);
    }
    toast("Copied");
  },
  "add-result-menu": (el) => openMenu(button("pick-results", "Choose files…") + button("paste", "Paste image ⌘V"), el.getBoundingClientRect(), el),
  "prompt-menu": (el) => openMenu((prompt().sourceUrl ? button("open-url", "Open original source ↗", "", `data-url="${esc(prompt().sourceUrl)}"`) : "") + button("delete-prompt", "Move prompt to Trash", "danger"), el.getBoundingClientRect(), el),
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
      render();
      main.querySelector(`.result-card[data-id="${el.dataset.id}"]`)?.focus({ preventScroll: true });
    } else openResult(el.dataset.pid, el.dataset.id);
  },
  "select-results": () => {
    resultSelection.toggle();
    render();
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
  closeMenu($("#context-menu").contains(e.target));
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
$("#nav-prompts").addEventListener("click", () => { favorites = false; navigate("prompts"); });
$("#nav-sources").addEventListener("click", () => navigate("sources"));
$("#search").addEventListener("input", (e) => {
  sourceFolder = null;
  query = e.target.value;
  promptId = null;
  render();
});
$("#favorites").addEventListener("click", () => {
  const nextFavorite = view !== "prompts" || !favorites;
  if (view !== "prompts") navigate("prompts");
  favorites = nextFavorite;
  promptId = null;
  render();
});
let managerCategories = false;
let tagRows = [];
let tagEdit = null;
const tagUse = (row) => managerCategories ? `${row.prompts} prompts` : `${row.sources} photo${row.sources === 1 ? "" : "s"}`;
async function manageTags() {
  managerCategories = view === "prompts";
  tagRows = await invoke(managerCategories ? "category_usage" : "tag_usage");
  tagEdit = null;
  showModal(managerCategories ? "Manage categories" : "Manage tags", `<div class="add-tag">${field(managerCategories ? "Add category" : "Add tag", "newTag")}<button type="submit" class="primary">Add</button></div><div id="tag-list" aria-label="${managerCategories ? "Categories" : "Tags"}"></div>`, async (form) => {
    if (tagEdit) return;
    const tag = form.elements.newTag.value.trim();
    if (!tag) throw new Error(`Enter a ${managerCategories ? "category" : "tag"} name.`);
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
        ? `<label class="field">Rename ${esc(row.tag)}<input id="rename-tag" value="${esc(tagEdit.to ?? row.tag)}" aria-label="New ${managerCategories ? "category" : "tag"} name"></label><p class="tag-confirm" aria-live="polite"></p><div class="actions"><button type="button" data-tag-op="confirm" data-index="${index}" class="primary">Save</button><button type="button" data-tag-op="cancel">Cancel</button></div>`
        : `<p>Remove '${esc(row.tag)}' from ${managerCategories ? `${row.prompts} prompts` : `${row.sources} photos`}? Photos, prompts and results are kept.</p><div class="actions"><button type="button" class="danger" data-tag-op="confirm" data-index="${index}">Remove</button><button type="button" data-tag-op="cancel">Cancel</button></div>`;
    }
    return `<div class="tag-row ${editing ? "editing" : ""}">${controls}</div>`;
  }).join("");
  if (tagEdit?.mode === "rename") {
    const input = $("#rename-tag");
    input.addEventListener("input", () => {
      tagEdit.to = input.value.trim();
      tagEdit.confirmedMerge = false;
      const merge = tagRows.some((r) => r.tag.toLowerCase() === tagEdit.to.toLowerCase() && r.tag !== tagEdit.tag);
      $(".tag-confirm").textContent = merge ? `This will merge '${tagEdit.tag}' into '${tagEdit.to}' on ${managerCategories ? "prompt categories" : "photos"}.` : `Rename on ${managerCategories ? "prompt categories" : "photos"}.`;
    });
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.select();
  }
}
async function changeTag(command, args) {
  try {
    if (managerCategories) {
      command = ({set_tags:"set_categories", remove_tag:"remove_category", rename_tag:"rename_category"})[command];
      if (command === "set_categories") args = {categories: args.tags};
    }
    const result = await invoke(command, args);
    const from = (args.tag ?? args.from ?? "").toLowerCase();
    if (filter.some((t) => t.toLowerCase() === from)) {
      const names = managerCategories ? library.categories : library.tags;
      const to = args.to ? names.find(t => t.toLowerCase() === args.to.toLowerCase()) || args.to : null;
      filter = [...new Set(filter.flatMap((t) => t.toLowerCase() !== from ? [t] : to ? [to] : []))];
    }
    await refresh();
    await manageTags();
    if (result) {
      const message = managerCategories ? `Updated ${result.prompts} prompts.` : `Updated ${result.sources} photos.`;
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
    if (!to) throw new Error(`${managerCategories ? "Category" : "Tag"} names cannot be empty.`);
    const merge = tagRows.some((r) => r.tag.toLowerCase() === to.toLowerCase() && r.tag !== row.tag);
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
    if (!$("#context-menu").hidden) { e.preventDefault(); closeMenu(true); }
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
  const contents =
    button("copy-image", source(selectedSource)?.kind === "audio" ? "Copy audio" : source(selectedSource)?.kind === "video" ? "Copy video" : "Copy image", "", `data-id="${selectedSource}"`) +
    button("reveal", "Reveal in Finder", "", `data-id="${selectedSource}"`) +
    button("source", "Edit tags", "", `data-id="${selectedSource}"`) +
    button("delete-source", "Move to Trash", "danger", `data-id="${selectedSource}"`);
  openMenu(contents, { left: e.clientX, bottom: e.clientY }, card);
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

let menuTrigger = null;
function closeMenu(restoreFocus = false) {
  const menu = $("#context-menu");
  if (menu.hidden) return;
  menu.hidden = true;
  menuTrigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus();
  menuTrigger = null;
}
function openMenu(contents, rect, trigger = document.activeElement) {
  closeMenu();
  const menu = $("#context-menu");
  menuTrigger = trigger;
  menu.innerHTML = contents;
  for (const item of $$("button", menu)) item.setAttribute("role", "menuitem");
  menu.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  menu.style.left = `${Math.max(0, Math.min(rect.left, innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(0, Math.min(rect.bottom, innerHeight - menu.offsetHeight))}px`;
  $("button", menu)?.focus();
}
$("#context-menu").addEventListener("keydown", (e) => {
  const items = $$("button", e.currentTarget);
  const index = items.indexOf(document.activeElement);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (e.key === "Tab") closeMenu(true);
});
function folderMenu(id, rect) {
  openMenu(button("rename-folder", "Rename", "", `data-id="${esc(id)}"`) + button("delete-folder", "Delete", "danger", `data-id="${esc(id)}"`), rect);
}
