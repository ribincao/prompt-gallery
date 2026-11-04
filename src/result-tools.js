export function stem(name, file) {
  const ext = (file || "").split(".").pop();
  let value = (name || "").trim();
  if (ext) while (value.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) value = value.slice(0, -ext.length - 1).trim();
  return value;
}
export function sourceName(s) { return stem(s.name?.trim() || s.originalName, s.file || s.originalName); }
export function resultName(r, date) { return stem(r.name, r.file || r.path) || date(r.createdAt); }

// Shared source-photo controls and transient multi-selection in a prompt's result grid.
export function sourcePhotoPicker({ sources, needs = [], chosen = [], asset, esc }) {
  const matches = (s) => s.tags.some((tag) => needs.includes(tag));
  const ordered = [...sources.filter(matches), ...sources.filter((s) => !matches(s))];
  const options = ordered
    .map(
      (s) =>
        `<label class="source-option"><input type="checkbox" name="sources" value="${s.id}" ${chosen.includes(s.id) ? "checked" : ""}><span class="source-option-photo">${s.thumbnail ? `<img src="${asset(s.thumbnail)}" alt="" loading="lazy" decoding="async">` : '<span class="muted">No preview</span>'}${mediaBadge(s)}</span><span class="source-option-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span class="source-option-name">${esc(sourceName(s))}</span>${matches(s) ? "<small>Matches prompt</small>" : ""}</label>`,
    )
    .join("");
  const missing = chosen
    .filter((id) => !sources.some((s) => s.id === id))
    .map(
      (id) =>
        `<label class="check missing-source-option"><input type="checkbox" name="sources" value="${esc(id)}" checked>Source photo missing</label>`,
    )
    .join("");
  return `<fieldset class="source-picker"><legend>Source photos used</legend><p class="muted">Click photos to toggle. ${needs.length ? "Photos tagged with any of the prompt’s needs appear first." : "Choose any source photos used."}</p><div class="source-picker-grid">${options}</div>${!sources.length ? "<small>No source photos in this library.</small>" : ""}${missing}</fieldset>`;
}

export function createResultSelection({ asset, esc, button, date }) {
  let promptId = null,
    results = [],
    selected = new Set(),
    mode = false,
    anchor = null;
  function reset() {
    promptId = null;
    results = [];
    selected.clear();
    mode = false;
    anchor = null;
  }
  function begin(id, items) {
    if (id !== promptId) reset();
    promptId = id;
    results = items;
    selected = new Set([...selected].filter((id) => items.some((r) => r.id === id)));
  }
  function card(r, pid) {
    return `<button type="button" class="card result-card ${selected.has(r.id) ? "is-selected" : ""}" data-action="result" data-id="${r.id}" data-pid="${pid}" ${mode ? `aria-pressed="${selected.has(r.id)}"` : ""} aria-label="${mode ? "Select" : "View"} result ${esc(resultName(r, date))}">${mediaPoster(r, asset, esc, resultName(r, date))}${mode ? `<span class="result-choice" aria-hidden="true">${selected.has(r.id) ? '<svg viewBox="0 0 16 16" width="16" height="16"><path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>' : ""}</span>` : ""}${r.favorite ? '<span class="star">★</span>' : ""}<div class="card-body"><small>${esc(resultName(r, date))}</small></div></button>`;
  }
  function choose(id, event) {
    if (!mode && !event.metaKey && !event.ctrlKey && !event.shiftKey) return false;
    mode = true;
    if (event.shiftKey && anchor && results.some((r) => r.id === anchor)) {
      const first = results.findIndex((r) => r.id === anchor),
        last = results.findIndex((r) => r.id === id);
      for (const r of results.slice(Math.min(first, last), Math.max(first, last) + 1)) selected.add(r.id);
    } else {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = id;
    }
    return true;
  }
  function toolbar() {
    return `${mode ? `<small role="status">${selected.size} selected</small>${button("set-result-sources", "Set source photos…", "", selected.size ? "" : "disabled")}` : ""}${button("select-results", mode ? "Done" : "Select", "", `aria-pressed="${mode}"`)}`;
  }
  function toggle() {
    mode = !mode;
    selected.clear();
    anchor = null;
  }
  return { begin, card, choose, toolbar, toggle, reset, items: () => results.filter((r) => selected.has(r.id)) };
}

export function mediaBadge(r) {
  if (r.kind !== "video") return "";
  const n = r.durationSeconds;
  const duration = Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}` : "Video";
  return `<span class="video-badge">▶ ${duration}</span>`;
}
export function mediaPoster(r, asset, esc, name = "") {
  return `${r.thumbnail || r.kind !== "video" ? `<img src="${asset(r.thumbnail || r.path)}" alt="${esc(name)}" draggable="false" loading="lazy">` : '<span class="thumbnail-missing">Preview unavailable</span>'}${mediaBadge(r)}`;
}
export function mediaPreview(r, asset, esc, name, cls) {
  return r.kind === "video" ? `<video class="${cls}" controls preload="metadata" src="${asset(r.path)}" ${r.thumbnail ? `poster="${asset(r.thumbnail)}"` : ""} aria-label="${esc(name)}"></video>` : `<img class="${cls}" src="${asset(r.path)}" alt="${esc(name)}">`;
}
