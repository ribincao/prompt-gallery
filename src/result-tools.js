export function stem(name, file) {
  const ext = (file || "").split(".").pop();
  let value = (name || "").trim();
  if (ext) while (value.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) value = value.slice(0, -ext.length - 1).trim();
  return value;
}
export function sourceName(s) { return stem(s.name?.trim() || s.originalName, s.file || s.originalName); }
export function resultName(r, date) { return stem(r.name, r.file || r.path) || date(r.createdAt); }

// Shared source-photo controls and transient multi-selection in a prompt's result grid.
export function sourcePhotoPicker({ sources, chosen = [], asset, esc }) {
  const options = sources
    .map(
      (s) =>
        `<label class="source-option"><input type="checkbox" name="sources" value="${s.id}" ${chosen.includes(s.id) ? "checked" : ""}><span class="source-option-photo">${s.thumbnail ? `<img src="${asset(s.thumbnail)}" alt="" loading="lazy" decoding="async">` : s.kind === "audio" ? audioPlaceholder(s, esc, sourceName(s)) : '<span class="muted">No preview</span>'}${mediaBadge(s)}</span><span class="source-option-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span class="source-option-name">${esc(sourceName(s))}</span></label>`,
    )
    .join("");
  const missing = chosen
    .filter((id) => !sources.some((s) => s.id === id))
    .map(
      (id) =>
        `<label class="check missing-source-option"><input type="checkbox" name="sources" value="${esc(id)}" checked>Source photo missing</label>`,
    )
    .join("");
  return `<fieldset class="source-picker"><legend>Photos used</legend><p class="muted">Click photos to toggle.</p><div class="source-picker-grid">${options}</div>${!sources.length ? "<small>No photos in this library.</small>" : ""}${missing}</fieldset>`;
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
    return `${mode ? `<small role="status">${selected.size} selected</small>${button("set-result-sources", "Set photos…", "", selected.size ? "" : "disabled")}` : ""}${button("select-results", mode ? "Done" : "Select", "", `aria-pressed="${mode}"`)}`;
  }
  function toggle() {
    mode = !mode;
    selected.clear();
    anchor = null;
  }
  return { begin, card, choose, toolbar, toggle, reset, items: () => results.filter((r) => selected.has(r.id)) };
}

export function mediaBadge(r) {
  if (!["video", "audio"].includes(r.kind)) return "";
  const n = r.durationSeconds;
  const duration = Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}` : (r.kind === "audio" ? "Audio" : "Video");
  return `<span class="video-badge">${r.kind === "audio" ? "♪" : "▶"} ${duration}</span>`;
}
export function mediaPoster(r, asset, esc, name = "") {
  return `${r.thumbnail || !["video", "audio"].includes(r.kind) ? `<img src="${asset(r.thumbnail || r.path)}" alt="${esc(name)}" draggable="false" loading="lazy">` : r.kind === "audio" ? audioPlaceholder(r, esc, name) : '<span class="thumbnail-missing">Preview unavailable</span>'}${mediaBadge(r)}`;
}
export function mediaPreview(r, asset, esc, name, cls) {
  if (r.kind === "audio") return `<div class="audio-preview ${cls}">${r.thumbnail ? `<img src="${asset(r.thumbnail)}" alt="${esc(name)}">` : audioPlaceholder(r, esc, name)}<audio controls preload="metadata" src="${asset(r.path)}" aria-label="${esc(name)}"></audio></div>`;
  return r.kind === "video" ? `<video class="${cls}" controls preload="metadata" src="${asset(r.path)}" ${r.thumbnail ? `poster="${asset(r.thumbnail)}"` : ""} aria-label="${esc(name)}"></video>` : `<img class="${cls}" src="${asset(r.path)}" alt="${esc(name)}">`;
}

export function audioPlaceholder(r, esc, name = "") {
  let hash = 0;
  for (const c of (r.name || r.originalName || name || r.file || "Audio")) hash = (Math.imul(hash, 31) + c.codePointAt(0)) | 0;
  return `<span class="thumbnail-missing audio-placeholder tone-${Math.abs(hash) % 6}" role="img" aria-label="${esc(name || "Audio")}">♪</span>`;
}
