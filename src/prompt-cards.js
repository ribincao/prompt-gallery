// Prompt-grid presentation and transient targeting state; no library data is changed here.
export function createPromptGrid({ main, asset, esc, badges, button }) {
  let selected = null;
  let hovered = null;
  let dropCard = null;
  const cards = () => [...main.querySelectorAll(".prompt-card")];
  const find = (id) => cards().find((card) => card.dataset.promptId === id);
  const cardAt = (target) => target?.closest?.(".prompt-card");

  function select(card) {
    selected = card?.dataset.promptId || null;
    for (const item of cards()) item.classList.toggle("is-selected", item === card);
  }
  main.addEventListener("focusin", (event) => {
    const card = cardAt(event.target);
    if (card) select(card);
  });
  main.addEventListener("mousedown", (event) => {
    if (event.button === 0) select(cardAt(event.target));
  });
  main.addEventListener("mouseover", (event) => {
    hovered = cardAt(event.target)?.dataset.promptId || null;
  });
  main.addEventListener("mouseout", (event) => {
    const card = cardAt(event.target);
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) hovered = null;
  });

  function thumbnail(result, cls = "") {
    // A failed thumbnail must not make the grid decode a full-resolution original.
    return result.thumbnail
      ? `<img class="${cls}" src="${asset(result.thumbnail)}" alt="" loading="lazy" decoding="async" draggable="false">`
      : `<span class="thumbnail-missing ${cls}" aria-hidden="true">Preview unavailable</span>`;
  }
  function card(prompt) {
    const results = prompt.results;
    const preview =
      results.length >= 2
        ? `<div class="result-stack" aria-hidden="true">${results
            .slice(0, 3)
            .map((result, i) => thumbnail(result, `stack-photo stack-layer-${i}`))
            .join("")}</div>`
        : results.length === 1
          ? thumbnail(results[0], "single-result")
          : `<div class="placeholder">${esc(prompt.text.slice(0, 200) || "An idea starts here.")}</div>`;
    const count =
      results.length >= 2
        ? `<span class="result-count" aria-label="${results.length} results">${results.length}</span>`
        : "";
    return `<article class="card prompt-card ${selected === prompt.id ? "is-selected" : ""}" data-prompt-id="${prompt.id}"><button type="button" class="prompt-card-open" data-action="prompt" data-id="${prompt.id}" aria-label="Open ${esc(prompt.title)}${results.length ? `, ${results.length} result${results.length === 1 ? "" : "s"}` : ""}">${preview}${results[0]?.kind === "video" ? `<span class="video-badge">▶ ${Number.isFinite(results[0].durationSeconds) ? `${Math.floor(results[0].durationSeconds / 60)}:${String(Math.floor(results[0].durationSeconds % 60)).padStart(2, "0")}` : "Video"}</span>` : ""}${count}${prompt.favorite ? '<span class="star">★</span>' : ""}<div class="card-body"><h3>${esc(prompt.title)}</h3><div class="badges">${badges(prompt.needs.length ? prompt.needs : ["text-only"])}</div></div></button>${button("card-pick-results", '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', "card-add-result", `data-id="${prompt.id}" aria-label="Add result to ${esc(prompt.title)}" title="Add result"`)}</article>`;
  }
  function target() {
    // Only visible cards can receive paste, so filters/navigation cannot leave a stale target.
    return (
      main.querySelector(".prompt-card:hover")?.dataset.promptId ||
      find(hovered)?.dataset.promptId ||
      cardAt(document.activeElement)?.dataset.promptId ||
      find(selected)?.dataset.promptId ||
      null
    );
  }
  function hitTest(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    const scale = window.devicePixelRatio || 1;
    const card = cardAt(document.elementFromPoint(position.x / scale, position.y / scale));
    return card && main.contains(card) ? card : null;
  }
  function clearDrop() {
    dropCard?.classList.remove("is-drop-target");
    dropCard = null;
  }
  function highlightDrop(position) {
    const next = hitTest(position);
    if (dropCard !== next) {
      clearDrop();
      dropCard = next;
      dropCard?.classList.add("is-drop-target");
    }
  }
  function afterRender() {
    hovered = null;
    clearDrop();
    if (!find(selected)) selected = null;
  }
  return { card, target, hitTest, highlightDrop, clearDrop, afterRender, select };
}
