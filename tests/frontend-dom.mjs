// No browser or native UI access required. Tests the real frontend with a mock IPC bridge.
// JSDOM_MODULE=/absolute/path/to/jsdom/lib/api.js node tests/frontend-dom.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installMockBridge } from "./mock-bridge.mjs";
const { JSDOM } = await import(process.env.JSDOM_MODULE || "jsdom");
const dom = new JSDOM(await readFile(new URL("../src/index.html", import.meta.url), "utf8"), {
  url: "http://localhost",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document;
w.HTMLMediaElement.prototype.pause = function () {};
w.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
w.HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new w.Event("close"));
};
w.eval(`(${installMockBridge.toString()})();`);
// Control only the six-second Trash deadline, leaving UI timers real.
const trashTimers = new Map();
const realSetTimeout = w.setTimeout.bind(w), realClearTimeout = w.clearTimeout.bind(w);
let timerId = -1;
w.setTimeout = (fn, delay, ...args) => {
  if (delay !== 6000) return realSetTimeout(fn, delay, ...args);
  const id = timerId--; trashTimers.set(id, () => fn(...args)); return id;
};
w.clearTimeout = id => { trashTimers.delete(id); realClearTimeout(id); };
async function expireTrash() { const callbacks = [...trashTimers.values()]; trashTimers.clear(); callbacks.forEach(fn => fn()); await tick(); }

// Load the UI modules into the same DOM realm before the app entry point.
for (const file of ["prompt-cards.js", "result-tools.js", "controls.js"]) {
  w.eval(
    (await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")).replaceAll("export function", "function"),
  );
}
w.eval((await readFile(new URL("../src/app.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, ""));
const $ = (s) => d.querySelector(s);
const tick = () => new Promise((r) => setTimeout(r, 5));
async function wait(fn, label) {
  for (let n = 0; n < 200; n++) {
    if (fn()) return;
    await tick();
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) {
  assert.ok($(selector), selector);
  $(selector).click();
  await tick();
}
function input(name, value) {
  const el = $(`#dialog-form [name=${name}]`);
  assert.ok(el, name);
  el.value = value;
}
async function addTag(name, value, key = "Enter") {
  const el = $(`.token-control[data-name="${name}"] .token-input`);
  el.focus(); el.value = value; el.dispatchEvent(new w.Event("input"));
  el.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await tick();
}
async function save() {
  const form = $("#dialog-form");
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(() => $("#busy").hidden, "save");
  await tick();
  assert.equal($("#modal-error")?.textContent || "", "");
}
async function act(name) {
  await click(`[data-action="${name}"]`);
}
try {
  await wait(() => $("#busy").hidden, "startup");
  await click("#choose-library");
  await wait(() => !!$('[data-action="new-prompt"]'), "library");
  assert.match($("#main").textContent, /Your next idea starts here/);
  assert.ok($("#toolbar #search"));
  assert.equal($("#sidebar #search"), null);
  assert.match($("#nav-sources").textContent, /Photos/);
  assert.equal($("#vocabulary-label").textContent, "Categories");
  for (const id of ["nav-prompts", "nav-sources", "favorites"]) {
    assert.ok($(`#${id} svg`), `${id} has a line icon`);
    assert.equal($(`#${id} svg`).getAttribute("stroke"), "currentColor");
  }
  assert.ok($(".nav.active"));
  assert.ok($(".tag-filter.active"));
  assert.notEqual($(".nav.active").className, $(".tag-filter.active").className);
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tag-filter\.active \{ background: var\(--filter-active-bg\)/);
  assert.match(css, /\.nav\.active \{ background: var\(--soft\)/);
  assert.match(css, /#favorites\.active svg \{ fill: currentColor/);
  assert.equal($("#library-path").textContent, "Prompt Library");
  assert.equal($("#library-path").title, w.testState.lib.root);
  assert.ok($("#library-path svg"));
  assert.ok($("#library-menu #switch-library"));

  const now = new Date(2026, 5, 10, 12);
  const meta = (dates, categories = ["Design"]) => w.promptCardMeta({ categories, results: dates.map(createdAt => ({createdAt})) }, now);
  assert.equal(meta([new Date(2026, 5, 10, 1)]), "Design · today");
  assert.equal(meta([new Date(2026, 5, 7)]), "Design · 3d ago");
  assert.equal(meta([new Date(2026, 4, 27)]), "Design · 2w ago");
  assert.equal(meta([new Date(2026, 2, 4)]), "Design · Mar 4");
  assert.equal(meta([new Date(2025, 2, 4)]), "Design · Mar 4, 2025");
  assert.equal(meta([new Date(2026, 2, 4), new Date(2026, 5, 10)]), "Design · today", "uses newest even if unsorted");
  assert.equal(meta([]), "Design");
  assert.equal(meta([], []), "No results yet");
  assert.equal(meta(["invalid"], []), "No results yet");
  assert.equal(meta([new Date(2026, 5, 10)], []), "today");

  const pickerHost = d.createElement("div");
  const pickerSources = [
    {id: "custom", name: "My <portrait>", originalName: "Auto.png", file: "1.png"},
    {id: "folder", folder: "f", originalName: "ChatGPT Image Nov.png", file: "2.png"},
    {id: "empty", originalName: "Other auto.png", file: "3.png"},
    {id: "unknown", folder: "gone", originalName: "Unknown.png", file: "4.png"},
  ];
  pickerHost.innerHTML = w.sourcePhotoPicker({sources: pickerSources, folders: [{id: "f", name: "References"}], asset: x => x, esc: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")});
  d.body.append(pickerHost);
  const options = [...pickerHost.querySelectorAll(".source-option")];
  assert.equal(options[0].querySelector(".source-option-name").textContent, "My <portrait>");
  assert.equal(options[1].querySelector(".source-option-name.muted").textContent, "References");
  assert.equal(options[2].querySelector(".source-option-name"), null);
  assert.equal(options[3].querySelector(".source-option-name"), null);
  assert.equal(options[1].title, "ChatGPT Image Nov");
  assert.equal(options[1].querySelector("input").getAttribute("aria-label"), "ChatGPT Image Nov");
  const pickerSearch = pickerHost.querySelector(".picker-search");
  for (const [query, index] of [["chatgpt image", 1], ["my <portrait>", 0], ["other auto", 2]]) {
    pickerSearch.value = query;
    pickerSearch.dispatchEvent(new w.Event("input", {bubbles: true}));
    assert.deepEqual(options.map(o => !o.hidden), options.map((_, i) => i === index));
  }
  pickerHost.remove();
  console.log("PASS: SVG navigation, distinct filter styling, library footer, fixed-date card metadata, picker labels and hidden-name search");

  const originalTags = [...w.testState.lib.categories];
  w.testState.lib.categories.push(...Array.from({length: 8}, (_, i) => `extra-${i}`));
  await click("#reload");
  assert.equal(d.querySelectorAll("#tags .tag-dot").length, originalTags.length + 8, "all tags shown by default");
  assert.equal($("#more-tags").getAttribute("aria-expanded"), "true");
  await click("#more-tags");
  assert.equal(w.localStorage.getItem("gallery-categories-collapsed"), "true");
  assert.equal(d.querySelectorAll("#tags .tag-dot").length, 6);
  await click("#more-tags");
  assert.equal(w.localStorage.getItem("gallery-categories-collapsed"), "false");
  w.testState.lib.categories = originalTags;
  await click("#reload");
  await click("#nav-sources");
  await act("pick-sources");
  await wait(() => $("#modal").open, "import");
  $('.token-control[data-name=tags] .token-input').focus();
  assert.ok(!$(".control-popover").textContent.includes("style-only"));
  await addTag("tags", "single");
  await save();
  assert.equal(w.testState.lib.sources[0].tags[0], "single");
  await act("open-folder");
  await act("source");
  await act("copy-image");
  assert.equal($("[name=name]").value, "Original");
  input("name", "  Kujira <bucket>  ");
  input("note", "A reference photo");
  await save();
  assert.equal(w.testState.lib.sources[0].note, "A reference photo");
  assert.equal(w.testState.lib.sources[0].name, "Kujira <bucket>");
  assert.equal($(".source-card h3").textContent, "Kujira <bucket>");
  assert.equal($(".source-card").getAttribute("aria-label"), "Preview Kujira <bucket>");
  for (const text of ["Kujira", "Original.png"]) {
    $("#search").value = text;
    $("#search").dispatchEvent(new w.Event("input"));
    assert.ok($(".source-card"));
  }
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  await act("open-folder");
  await act("source");
  assert.match($("#dialog-form").textContent, /Original file: Original/);
  input("name", "🐈".repeat(201));
  $("#dialog-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.match($("#modal-error").textContent, /200/);
  await act("close-modal");
  assert.ok(w.testState.calls.some((c) => c.cmd === "copy_image_to_clipboard"));
  await click("#nav-prompts");
  await act("new-prompt");
  assert.equal(d.querySelectorAll('.token-control').length, 1);
  assert.equal($('.token-control[data-name=needs]'), null, "prompts no longer have Needs");
  assert.ok($('.token-control[data-name=categories]'));
  $('.token-control[data-name=categories] .token-input').focus();
  assert.equal($('.control-popover').textContent, 'style-only');
  assert.equal($('#dialog-form .checks'), null);
  input("title", "Portrait <test>");
  const text = "  Illustrate this portrait.\nKeep the person recognizable.\n";
  input("text", text);
  await addTag("categories", "watercolor");
  await save();
  assert.equal($("#toolbar h1").textContent, "Portrait <test>");
  assert.equal($("#suggested-photos"), null);
  assert.equal(d.querySelectorAll("test").length, 0);
  await act("copy-prompt");
  assert.equal(w.testState.copied, text);
  const copyButton = $(".prompt-text-wrap [data-action=copy-prompt]");
  assert.equal(copyButton.title, "Copy prompt");
  assert.ok($("#toolbar [data-action=copy-prompt].primary"));
  w.testState.copied = null;
  copyButton.click(); await tick();
  assert.equal(w.testState.copied, text);
  assert.equal(copyButton.querySelector("path").getAttribute("d"), "m3 8 3 3 7-7");
  await new Promise(resolve => setTimeout(resolve, 1550));
  assert.ok(copyButton.querySelector("rect"), "copy icon returns after feedback");
  assert.equal($("#main [data-action=delete-prompt]"), null);
  await act("prompt-menu");
  assert.equal($("#context-menu [data-action=open-url]"), null, "no source item without a URL");
  assert.equal(d.activeElement, $("#context-menu [data-action=delete-prompt]"));
  assert.equal(d.activeElement.textContent, "Move prompt to Trash");
  assert.ok(d.activeElement.classList.contains("danger"));
  await click("#context-menu [data-action=delete-prompt]");
  assert.equal($("#modal").open, false, "Trash has no confirmation");
  assert.equal($("#prompt-count").textContent, "0");
  await act("undo-trash");
  await act("prompt");
  w.testState.lib.prompts[0].sourceUrl = "https://example.com/original";
  await click("#reload");
  assert.equal($("#main [data-action=open-url]"), null);
  await act("prompt-menu");
  assert.equal(d.activeElement.textContent, "Open original source ↗");
  await click("#context-menu [data-action=open-url]");
  assert.deepEqual(JSON.parse(JSON.stringify(w.testState.calls.at(-1))), {cmd: "open_chat", args: {url: "https://example.com/original"}});
  assert.ok($("#context-menu").hidden);
  await act("add-result-menu");
  assert.equal(d.activeElement.textContent, "Choose files…");
  assert.equal($("[data-action=add-result-menu]").getAttribute("aria-expanded"), "true");
  d.activeElement.dispatchEvent(new w.KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
  assert.equal(d.activeElement.textContent, "Paste image ⌘V");
  d.activeElement.dispatchEvent(new w.KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
  assert.ok($("#context-menu").hidden);
  assert.equal(d.activeElement, $("[data-action=add-result-menu]"));
  assert.equal(d.activeElement.getAttribute("aria-expanded"), "false");
  let clipboardReads = 0;
  const previousRead = w.navigator.clipboard.read;
  w.navigator.clipboard.read = async () => { clipboardReads++; return []; };
  await act("add-result-menu");
  await click("#context-menu [data-action=paste]");
  assert.equal(clipboardReads, 1, "menu invokes paste handler");
  assert.ok($("#context-menu").hidden);
  w.navigator.clipboard.read = previousRead;
  console.log("PASS: exact text copy and timed icon feedback, Add result and More menus, focus/Escape, original source and deferred Trash");

  await act("add-result-menu");
  await click("#context-menu [data-action=pick-results]");
  assert.equal($("[name=chatUrl]").value, "https://chatgpt.com/c/test");
  assert.equal($("[name=sources]").checked, false, "nothing preselected without an opened photo");
  $("[name=sources]").click();
  assert.equal($("[name=sources]").checked, true);
  assert.equal($(".source-option-name").textContent, "Kujira <bucket>");
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].sourcePhotos.length, 1);
  assert.ok($(".results-grid-large .result-card"));
  await act("result");
  assert.match($(".linked-source").textContent, /Kujira <bucket>/);
  await act("edit-result");
  const dateFallback = $("[name=name]").value;
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].name, null);
  await act("edit-result");
  input("name", "  Watercolor <cat>  ");
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].name, "Watercolor <cat>");
  assert.match($("#lightbox-content").textContent, /Watercolor <cat>/);
  assert.equal($(".lightbox-image").alt, "Watercolor <cat>");
  await act("close-lightbox");
  assert.match($(".result-card").getAttribute("aria-label"), /Watercolor <cat>/);
  assert.match($(".result-card").textContent, /Watercolor <cat>/);
  await click("#nav-sources");
  await act("open-folder");
  await act("source");
  assert.match($(".source-uses").textContent, /Watercolor <cat>/);
  input("name", "   ");
  await save();
  assert.equal($(".source-card").getAttribute("aria-label"), "Preview Original");
  await act("source");
  assert.match($("#dialog-form").textContent, /Original file: Original.png/);
  input("name", "Kujira <bucket>");
  await save();
  await click("#nav-prompts");
  $("#search").value = "watercolor";
  $("#search").dispatchEvent(new w.Event("input"));
  assert.equal(d.querySelectorAll(".prompt-card").length, 1);
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  await act("prompt");
  await act("result");
  await act("edit-result");
  input("name", "  ");
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].name, null);
  assert.match($("#lightbox-content").textContent, new RegExp(dateFallback));
  await act("open-url");
  assert.equal(w.testState.calls.at(-1).cmd, "open_chat");
  await act("close-lightbox");
  w.testState.listeners["tauri://drag-drop"]({ payload: { paths: ["/tmp/second.jpg"] } });
  await wait(() => $("#modal").open, "drop");
  await save();
  await act("result");
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.match($("#lightbox-content").textContent, /2 \/ 2/);
  await act("close-lightbox");
  await act("favorite-prompt");
  await act("back");
  await click("#favorites");
  assert.equal(d.querySelectorAll("[data-action=prompt]").length, 1);
  $("#search").value = "no match";
  $("#search").dispatchEvent(new w.Event("input"));
  assert.equal(d.querySelectorAll("[data-action=prompt]").length, 0);
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  await click("#nav-sources");
  await act("open-folder");
  $(".source-card").dispatchEvent(
    new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }),
  );
  assert.equal($("#context-menu").hidden, false);
  await click("#context-menu [data-action=source]");
  await act("delete-source");
  await expireTrash();
  assert.equal(w.testState.lib.sources.length, 0);
  await click("#nav-prompts");
  await act("prompt");
  [...d.querySelectorAll('[data-action="result"]')].find(el => w.testState.lib.prompts[0].results.find(r => r.id === el.dataset.id)?.sourcePhotos.length)?.click();
  await wait(() => !$("#lightbox").hidden || $("#lightbox").open, "linked result");
  assert.match($("#lightbox-content").textContent, /Source photo missing/);
  await act("close-lightbox");
  await click("#nav-sources");
  const paste = new w.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => ({
            type: "image/png",
            arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
          }),
        },
      ],
    },
  });
  d.body.dispatchEvent(paste);
  await wait(() => $("#modal").open, "paste image");
  await save();
  assert.ok(w.testState.calls.some((c) => c.cmd === "import_source_bytes"));
  await click("#nav-prompts");
  $("#search").value = "no match";
  $("#search").dispatchEvent(new w.Event("input"));
  const textPaste = new w.Event("paste", { bubbles: true, cancelable: true });
  const longText =
    "An elaborate prompt that describes a beautiful landscape with quiet mountains and evening light.".repeat(2);
  Object.defineProperty(textPaste, "clipboardData", { value: { items: [], getData: () => longText } });
  d.body.dispatchEvent(textPaste);
  await tick();
  assert.equal($("[name=text]").value, longText);
  await act("close-modal");
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(d.activeElement.id, "search");
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true }));
  assert.equal($("#modal").open, true);
  await act("close-modal");
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  const first = w.testState.lib.prompts[0];
  const second = { ...first, id: "20261104-130000-abcd", title: "Other prompt", results: [], favorite: false };
  const single = { ...first, id: "20261104-130000-abce", title: "One result", results: [], favorite: false };
  const result = (n) => ({
    id: `20261104-130000-${n.toString(16).padStart(4, "0")}`,
    file: `${n}.png`,
    path: `/tmp/Prompt Library/original-${n}.png`,
    thumbnail: `/tmp/Prompt Library/.thumbs/${n}.jpg`,
    sourcePhotos: [],
    chatUrl: "",
    note: "",
    model: "ChatGPT",
    favorite: false,
    createdAt: new Date(2026, 10, 4, 13, 0, 10 - n).toISOString(),
  });
  first.results = [0, 1, 2, 3, 4].map(result);
  single.results = [result(9)];
  w.testState.lib.prompts.push(second, single);
  w.testState.assetPaths.length = 0;
  await click("#reload");
  const gridCard = (id) => $(`.prompt-card[data-prompt-id="${id}"]`);
  assert.equal(gridCard(first.id).querySelector(".prompt-card-meta").textContent, w.promptCardMeta(first));
  assert.equal(gridCard(first.id).querySelectorAll(".stack-photo").length, 3);
  assert.equal(gridCard(first.id).querySelector(".result-count").textContent, "5");
  assert.equal(gridCard(second.id).querySelectorAll(".placeholder").length, 1);
  assert.equal(gridCard(second.id).querySelectorAll(".result-count").length, 0);
  assert.equal(gridCard(single.id).querySelectorAll(".single-result").length, 1);
  assert.equal(gridCard(single.id).querySelectorAll(".result-stack,.result-count").length, 0);
  assert.deepEqual(
    [...w.testState.assetPaths],
    [0, 1, 2, 9].map((n) => `/tmp/Prompt Library/.thumbs/${n}.jpg`),
  );
  assert.equal(d.querySelectorAll("button button").length, 0);

  // Tauri sends physical coordinates. Retina hit tests must use CSS pixels, including
  // when the final drop differs from the most recent drag-over target.
  Object.defineProperty(w, "devicePixelRatio", { value: 2, configurable: true });
  let lastPoint;
  d.elementFromPoint = (x, y) => {
    lastPoint = { x, y };
    return x < 100
      ? gridCard(first.id).querySelector(".stack-photo")
      : x < 200
        ? gridCard(second.id).querySelector("h3")
        : $("#main");
  };
  const drag = (event, x, paths = []) =>
    w.testState.listeners[`tauri://drag-${event}`]({ payload: { position: { x, y: 100 }, paths } });
  drag("enter", 100);
  assert.deepEqual(lastPoint, { x: 50, y: 50 });
  assert.equal(gridCard(first.id).classList.contains("is-drop-target"), true);
  drag("over", 300);
  assert.equal(gridCard(first.id).classList.contains("is-drop-target"), false);
  assert.equal(gridCard(second.id).classList.contains("is-drop-target"), true);
  drag("drop", 100, ["/tmp/grid-result.jpg"]);
  await wait(() => $("#modal").open, "grid drop form");
  assert.equal(d.querySelectorAll(".is-drop-target").length, 0);
  assert.equal($("[name=chatUrl]").value, "https://chatgpt.com/c/test");
  assert.ok($("[name=sources]"));
  await save();
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").at(-1).args.promptId, first.id);
  assert.equal(d.querySelectorAll(".prompt-card").length, 3);
  assert.equal($(".prompt-text"), null);
  drag("enter", 100);
  w.testState.listeners["tauri://drag-leave"]({ payload: {} });
  assert.equal(d.querySelectorAll(".is-drop-target").length, 0);

  // The sibling + button picks for its own card and does not activate prompt detail.
  await click(`.prompt-card[data-prompt-id="${second.id}"] .card-add-result`);
  await wait(() => $("#modal").open, "grid picker form");
  await save();
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").at(-1).args.promptId, second.id);
  assert.equal(gridCard(second.id).querySelectorAll(".single-result").length, 1);
  assert.equal($(".prompt-text"), null);

  // Hover wins over keyboard selection; leaving restores the focused/selected target.
  gridCard(second.id).querySelector(".prompt-card-open").focus();
  gridCard(first.id).dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
  d.body.dispatchEvent(paste);
  await wait(() => $("#modal").open, "hovered card image paste");
  await save();
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").at(-1).args.promptId, first.id);
  gridCard(second.id).querySelector(".prompt-card-open").focus();
  gridCard(second.id).dispatchEvent(new w.MouseEvent("mouseout", { bubbles: true, relatedTarget: $("#main") }));
  d.body.dispatchEvent(paste);
  await wait(() => $("#modal").open, "focused card image paste");
  await save();
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").at(-1).args.promptId, second.id);
  assert.equal(gridCard(second.id).querySelectorAll(".stack-photo").length, 2);
  assert.equal(gridCard(second.id).querySelector(".result-count").textContent, "2");

  // Dropping onto grid whitespace cannot silently add to the last selected card.
  const importCount = w.testState.calls.filter((c) => c.cmd === "add_results").length;
  drag("drop", 500, ["/tmp/not-targeted.png"]);
  await tick();
  assert.equal($("#modal").open, false);
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").length, importCount);
  $("#search").value = "no match";
  $("#search").dispatchEvent(new w.Event("input"));
  d.body.dispatchEvent(paste);
  await tick();
  assert.equal($("#modal").open, false);
  assert.equal(w.testState.calls.filter((c) => c.cmd === "add_results").length, importCount);
  // Real-use regressions: photo linking, batch updates, any-tag matching, and clean strips.
  const photo = (suffix, name, tags) => ({
    id: `20261104-140000-${suffix}`,
    file: `${suffix}.png`,
    originalName: name,
    tags,
    note: "",
    createdAt: new Date().toISOString(),
    path: `/tmp/Prompt Library/sources/${suffix}.png`,
    thumbnail: `/tmp/Prompt Library/.thumbs/${suffix}.jpg`,
  });
  const otherPhoto = photo("0001", "Pet.png", ["pet"]);
  const matchingGroup = photo("0002", "Group.png", ["group"]);
  const matchingSingle = photo("0003", "Single.png", ["single"]);
  w.testState.lib.sources = [matchingGroup, matchingSingle, otherPhoto];
  first.needs = ["pet"]; // legacy needs are kept on disk but no longer shown or used
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  await click("#reload");
  await click(`.prompt-card[data-prompt-id="${first.id}"] [data-action=prompt]`);
  assert.equal($("#suggested-photos"), null);
  assert.doesNotMatch($("#toolbar").textContent + $("#main .page-header")?.textContent, /\bpet\b/);

  // Try with another photo: all photos, AND tag filter, search, select + Cmd-C copies the original.
  assert.equal($("#try-panel"), null, "collapsed by default");
  await act("toggle-try");
  const tryIds = () => [...d.querySelectorAll("#try-grid .try-card")].map((c) => c.dataset.id);
  assert.deepEqual(tryIds(), [matchingGroup.id, matchingSingle.id, otherPhoto.id], "every photo, not just matches");
  await click('#try-chips [data-tag="pet"]');
  assert.deepEqual(tryIds(), [otherPhoto.id]);
  await click('#try-chips [data-tag="group"]');
  assert.deepEqual(tryIds(), [], "selected tags combine with AND");
  assert.match($("#try-grid").textContent, /No photos match/);
  await click('#try-chips [data-tag="pet"]');
  assert.deepEqual(tryIds(), [matchingGroup.id]);
  await click('#try-chips [data-tag=""]');
  $("#try-search").value = "sing";
  $("#try-search").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.deepEqual(tryIds(), [matchingSingle.id]);
  await click(`#try-grid [data-id="${matchingSingle.id}"]`);
  assert.equal($("#modal").open, false, "clicking selects instead of opening the inspector");
  assert.ok($(`#try-grid [data-id="${matchingSingle.id}"]`).classList.contains("selected"));
  w.testState.calls.length = 0;
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
  await tick();
  assert.ok(w.testState.calls.some((c) => c.cmd === "copy_image_to_clipboard" && c.args.path === matchingSingle.path));
  await act("copy-prompt");
  assert.equal(w.testState.copied, first.text);
  $("#try-search").value = "";
  $("#try-search").dispatchEvent(new w.Event("input", { bubbles: true }));
  await act("toggle-try");
  assert.equal($("#try-panel"), null);

  await act("edit-prompt");
  assert.doesNotMatch($("#dialog-form").textContent, /needs/i);
  await act("close-modal");
  await act("add-result-menu");
  await click("#context-menu [data-action=pick-results]");
  assert.deepEqual(
    [...d.querySelectorAll(".source-option input")].map((el) => el.value),
    [matchingGroup.id, matchingSingle.id, otherPhoto.id],
  );
  assert.equal(d.querySelectorAll(".source-option-photo img").length, 3);
  assert.deepEqual([...d.querySelectorAll(".source-option input:checked")].map((el) => el.value), [matchingSingle.id], "the photo picked in Try is pre-linked");
  const visible = () => [...d.querySelectorAll(".source-option")].filter((el) => !el.hidden).map((el) => el.querySelector("input").value);
  await click('.source-picker [data-picker-tag="group"]');
  assert.deepEqual(visible(), [matchingGroup.id], "tag chip filters the picker");
  await click('.source-picker [data-picker-tag="pet"]');
  assert.deepEqual(visible(), [], "chips combine with AND");
  assert.equal($(".picker-empty").hidden, false);
  await click('.source-picker [data-picker-tag="pet"]');
  assert.deepEqual(visible(), [matchingGroup.id], "clicking a chip again removes it");
  await click(".source-option:nth-child(1)");
  assert.equal(d.querySelectorAll(".source-option input:checked").length, 2, "hidden photos stay checked");
  assert.equal($(".picker-count").textContent, "2 selected");
  await click('.source-picker [data-picker-tag=""]');
  assert.equal(visible().length, 3);
  $(".picker-search").value = "pet";
  $(".picker-search").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.deepEqual(visible(), [otherPhoto.id], "search filters by name and tags");
  $(".picker-search").value = "";
  $(".picker-search").dispatchEvent(new w.Event("input", { bubbles: true }));
  console.log("PASS: result photo picker filters by tags and name");
  await save();
  const newResult = first.results[0];
  assert.deepEqual([...newResult.sourcePhotos], [matchingGroup.id, matchingSingle.id]);
  await click(`.result-card[data-id="${newResult.id}"]`);
  assert.equal(d.querySelectorAll(".linked-source img").length, 2);
  await act("light-source");
  assert.match($("#modal-content h2").textContent, /Group/);
  await act("close-modal");
  await click(`.result-card[data-id="${newResult.id}"]`);
  await act("edit-result");
  assert.equal(d.querySelectorAll(".source-option input:checked").length, 2);
  await click(".source-option:nth-child(3)");
  await save();
  assert.equal(newResult.sourcePhotos.length, 3);
  await act("close-lightbox");

  first.results.forEach((r, i) =>
    Object.assign(r, {
      chatUrl: `https://chatgpt.com/c/${i}`,
      model: `Model ${i}`,
      note: `Keep note ${i}`,
      favorite: i % 2 === 0,
      name: `Named result ${i}`,
    }),
  );
  const before = first.results.map((r) => ({ ...r, sourcePhotos: [...r.sourcePhotos] }));
  await click("#reload");
  await act("select-results");
  assert.ok($("#toolbar [data-action=prompt-menu]"));
  assert.equal($("#main .page-header"), null);
  const resultButtons = [...d.querySelectorAll(".result-card")];
  resultButtons[0].click();
  await tick();
  d.querySelectorAll(".result-card")[1].click();
  await tick();
  assert.equal(d.querySelectorAll(".result-card[aria-pressed=true]").length, 2);
  await act("set-result-sources");
  for (const input of d.querySelectorAll(".source-option input")) input.checked = input.value === matchingGroup.id;
  await save();
  for (let i = 0; i < first.results.length; i++) {
    const r = first.results[i];
    assert.deepEqual([...r.sourcePhotos], i < 2 ? [matchingGroup.id] : [...before[i].sourcePhotos]);
    for (const key of ["chatUrl", "model", "note", "favorite", "name"]) assert.equal(r[key], before[i][key]);
  }
  await act("select-results");
  // Cmd-click starts selection; Shift-click adds the contiguous range, without opening a lightbox.
  d.querySelectorAll(".result-card")[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true, metaKey: true }));
  await tick();
  d.querySelectorAll(".result-card")[2].dispatchEvent(new w.MouseEvent("click", { bubbles: true, shiftKey: true }));
  await tick();
  assert.equal(d.querySelectorAll(".result-card[aria-pressed=true]").length, 3);
  assert.equal($("#lightbox").open, false);
  await act("set-result-sources");
  for (const input of d.querySelectorAll("[name=sources]")) input.checked = false;
  await save();
  assert.ok(first.results.slice(0, 3).every((r) => r.sourcePhotos.length === 0));
  await act("select-results");

  first.needs = ["landscape"];
  await click("#reload");
  assert.doesNotMatch($("#main").textContent, /Suggested photos|No matching photos yet/);

  // Live refresh preserves the detail view/scroll and avoids self-event redraws.
  const emitChange = () => w.testState.listeners["library-changed"]({ payload: w.testState.lib.root });
  $("#main").scrollTop = 123;
  first.title = "Changed by CLI";
  emitChange();
  await wait(() => $("#toolbar h1")?.textContent === "Changed by CLI", "external refresh");
  assert.equal($("#main").scrollTop, 123);
  const sameHeader = $("#toolbar h1");
  emitChange();
  await tick();
  assert.equal($("#toolbar h1"), sameHeader, "unchanged watcher snapshot must not redraw");
  await act("edit-prompt");
  input("title", "Unsaved draft");
  first.title = "Deferred external change";
  emitChange();
  await tick();
  assert.equal($("#dialog-form [name=title]").value, "Unsaved draft");
  assert.equal($("#toolbar h1").textContent, "Changed by CLI");
  await act("close-modal");
  await wait(() => $("#toolbar h1")?.textContent === "Deferred external change", "deferred dialog refresh");
  await click(".result-card");
  first.title = "Deferred lightbox change";
  emitChange();
  await tick();
  assert.equal($("#toolbar h1").textContent, "Deferred external change");
  await act("close-lightbox");
  await wait(() => $("#toolbar h1")?.textContent === "Deferred lightbox change", "deferred lightbox refresh");
  const oldHeader = $("#toolbar h1");
  first.title = "Wrong library event";
  w.testState.listeners["library-changed"]({ payload: "/different/library" });
  await tick();
  assert.equal($("#toolbar h1"), oldHeader);
  await act("edit-prompt");
  assert.ok($(".dialog-header .form-actions [type=submit][form=dialog-form]"));
  assert.equal($("#dialog-form .form-actions"), null);
  assert.ok($(".dialog-heading #modal-error"));
  input("title", "Keyboard saved");
  $("textarea[name=text]").dispatchEvent(new w.KeyboardEvent("keydown", {key: "Enter", metaKey: true, bubbles: true, cancelable: true}));
  await wait(() => !$("#modal").open, "Cmd+Enter save");
  assert.equal(first.title, "Keyboard saved");
  // Independent prompt categories, photo tags, filters, and manager commands.
  await click('#tags [data-tag="watercolor"]');
  assert.equal($('#tags .active').dataset.tag, 'watercolor');
  await click('#nav-sources');
  assert.equal($('#vocabulary-label').textContent, 'Tags');
  assert.equal($('#tags .active').dataset.tag, '');
  await click('#tags [data-tag="single"]');
  await click('#nav-prompts');
  assert.equal($('#tags .active').dataset.tag, 'watercolor');
  await click('#favorites');
  assert.equal($('#vocabulary-label').textContent, 'Categories');
  assert.equal($('#tags .active').dataset.tag, 'watercolor');
  // Clicking Prompts while Favorites is on leaves Favorites, from Prompts and via Photos.
  await click('#nav-prompts');
  assert.ok($('#nav-prompts').classList.contains('active'));
  assert.ok(!$('#favorites').classList.contains('active'));
  await click('#favorites');
  await click('#nav-sources');
  await click('#nav-prompts');
  assert.ok($('#nav-prompts').classList.contains('active'));
  assert.ok(!$('#favorites').classList.contains('active'));
  await click('#manage-tags');
  assert.match($('#modal').textContent, /Manage categories/);
  input('newTag', 'temporary category'); await save();
  const categoryRow = name => [...d.querySelectorAll('.tag-row')].find(r => r.querySelector('.tag-name')?.textContent === name);
  categoryRow('temporary category').querySelector('[data-tag-op=rename]').click();
  $('#rename-tag').value = 'watercolor'; $('#rename-tag').dispatchEvent(new w.Event('input'));
  await click('[data-tag-op=confirm]'); await click('[data-tag-op=confirm]');
  await wait(() => !w.testState.lib.categories.includes('temporary category'), 'category merged');
  assert.ok(w.testState.lib.tags.includes('single'));
  assert.ok(first.needs.includes('landscape'));
  categoryRow('watercolor').querySelector('[data-tag-op=remove]').click();
  await click('[data-tag-op=confirm]');
  await wait(() => !w.testState.lib.categories.includes('watercolor'), 'category removed');
  assert.equal($('#tags .active').dataset.tag, '');
  await act('close-modal');
  await click('#nav-sources');
  assert.equal($('#tags .active').dataset.tag, 'single');
  await click('#tags [data-tag=""]');
  console.log('PASS: independent sidebar vocabularies, Favorites categories, per-view filters, category add/merge/remove and photo-tag isolation');
  await click("#nav-sources");
  await click("#manage-tags");
  await wait(() => !!$("#tag-list"), "tag manager");
  input("newTag", "C++");
  await save();
  const tagRow = name => [...d.querySelectorAll(".tag-row")].find(r => r.querySelector(".tag-name")?.textContent === name);
  assert.ok(tagRow("C++"));
  tagRow("C++").querySelector('[data-tag-op="rename"]').click();
  $("#rename-tag").value = "single";
  $("#rename-tag").dispatchEvent(new w.Event("input"));
  assert.match($(".tag-confirm").textContent, /merge/);
  await click('[data-tag-op="confirm"]');
  assert.equal($('[data-tag-op="confirm"]').textContent, "Confirm merge");
  await click('[data-tag-op="confirm"]');
  await wait(() => !!tagRow("single"), "merged");
  assert.ok(!w.testState.lib.tags.includes("C++"));
  tagRow("single").querySelector('[data-tag-op="remove"]').click();
  assert.match($(".tag-row.editing").textContent, /Photos, prompts and results are kept/);
  await click('[data-tag-op="cancel"]');
  assert.ok(w.testState.lib.tags.includes("single"));
  tagRow("single").querySelector('[data-tag-op="remove"]').click();
  w.testState.tagError = "Stopped: 1 records already updated";
  await click('[data-tag-op="confirm"]');
  await wait(() => $("#modal-error").textContent.includes("already updated"), "partial failure visible");
  w.testState.tagError = null;
  tagRow("single").querySelector('[data-tag-op="remove"]').click();
  await click('[data-tag-op="confirm"]');
  await wait(() => !w.testState.lib.tags.includes("single"), "removed");
  assert.ok(w.testState.lib.prompts.every(p => !p.needs.includes("single")));
  await act("close-modal");
  await click('#tags [data-tag="pet"]');
  await click("#manage-tags");
  await wait(() => !!tagRow("pet"), "rename filter tag");
  tagRow("pet").querySelector('[data-tag-op="rename"]').click();
  $("#rename-tag").value = "animal";
  $("#rename-tag").dispatchEvent(new w.Event("input"));
  await click('[data-tag-op="confirm"]');
  await wait(() => !!tagRow("animal"), "renamed");
  assert.equal($('#tags .active').dataset.tag, "animal");
  tagRow("animal").querySelector('[data-tag-op="remove"]').click();
  await click('[data-tag-op="confirm"]');
  await wait(() => !w.testState.lib.tags.includes("animal"), "removed filter tag");
  assert.equal($('#tags .active').dataset.tag, "");
  await act("close-modal");
  console.log("PASS: header actions, Cmd+Enter, tag add/rename/merge/remove/cancel, active filter updates, partial failure visibility");
  console.log("PASS: live refresh, unchanged snapshot, scroll/detail preservation, dialog/lightbox deferral, stale-library events");
  // Folder navigation, flat filtering, multi-select moves, video previews and legacy names.
  await click("#nav-sources");
  $("#search").value = ""; $("#search").dispatchEvent(new w.Event("input"));
  await click('[data-action="filter"][data-tag=""]');
  assert.ok($(".folder-card")); assert.equal($(".source-card"), null);
  await act("new-folder"); input("name", "Family"); await save();
  const fid = w.testState.lib.folders[0].id;
  await click(`[data-action="open-folder"][data-id="${fid}"]`);
  assert.match($("h1").textContent, /Photos.*Family/);
  await act("pick-sources"); await wait(() => $("#modal").open, "folder import"); await save();
  assert.equal(w.testState.lib.sources[0].folder, fid);
  await act("select-sources"); await act("source"); await act("move-sources");
  assert.equal($("#dialog-form select"), null);
  await click('.folder-trigger span');
  assert.equal($('.folder-trigger').getAttribute('aria-expanded'), 'true');
  await click('.control-popover [role=option]');
  await save();
  assert.equal(w.testState.lib.sources[0].folder, null);
  await act("source-root");
  $("#search").value = "Original"; $("#search").dispatchEvent(new w.Event("input"));
  assert.ok($(".source-card")); assert.equal($(".folder-card"), null);
  assert.equal($(".folder-label").textContent, "Unfiled");
  $("#search").value = ""; $("#search").dispatchEvent(new w.Event("input"));
  assert.ok($(".folder-card"));
  const movie = w.testState.lib.sources[0];
  Object.assign(movie, { kind: "video", name: "Clip.MOV", originalName: "Clip.MOV", file: `${movie.id}.MOV`, path: `${w.testState.lib.root}/sources/${movie.id}.MOV`, durationSeconds: 65 });
  await click("#reload"); await click('[data-action="open-folder"][data-id=""]');
  assert.match($(".video-badge").textContent, /1:05/);
  await click(`[data-action="source"][data-id="${movie.id}"]`);
  assert.equal($("[name=name]").value, "Clip"); assert.ok($("video[controls][preload=metadata]"));
  assert.equal($("video").autoplay, false);
  assert.equal($('[data-action="copy-image"]').textContent, "Copy video");
  input("name", "New.mov"); await save(); assert.equal(movie.name, "New");
  await act("source-root");
  await click(`[data-action="folder-menu"][data-id="${fid}"]`); await act("rename-folder"); input("name", "Home"); await save();
  assert.equal(w.testState.lib.folders[0].name, "Home");
  await click(`[data-action="folder-menu"][data-id="${fid}"]`); await act("delete-folder"); await save();
  assert.equal(w.testState.lib.folders.length, 0);
  const videoPrompt = w.testState.lib.prompts.find(p => p.results.length);
  const videoResult = videoPrompt.results[0];
  Object.assign(videoResult, { kind: "video", file: `${videoResult.id}.mp4`, name: "Result.mp4", durationSeconds: 12, thumbnail: null });
  await click("#reload"); await click("#nav-prompts");
  await click(`[data-action="prompt"][data-id="${videoPrompt.id}"]`);
  assert.ok($(".result-card .video-badge"));
  await click(`[data-action="result"][data-id="${videoResult.id}"]`);
  assert.ok($("#lightbox video[controls]"));
  assert.equal($('[data-action="copy-result"]').textContent, "Copy video");
  await act("copy-result"); await act("close-lightbox");
  Object.assign(movie, {kind: "audio", name: "Music", file: `${movie.id}.mp3`, thumbnail: null, durationSeconds: 125});
  Object.assign(videoResult, {kind: "audio", name: "Song", file: `${videoResult.id}.mp3`, thumbnail: null});
  await click("#reload"); await click("#nav-sources");
  await click('[data-action="open-folder"][data-id=""]');
  assert.ok($(".source-card .audio-placeholder"));
  assert.match($(".source-card .video-badge").textContent, /♪ 2:05/);
  await click(`[data-action="source"][data-id="${movie.id}"]`);
  assert.ok($("#modal audio[controls][preload=metadata]"));
  assert.equal($('[data-action="copy-image"]').textContent, "Copy audio");
  await act("close-modal"); await click("#nav-prompts");
  assert.ok($(".prompt-card .audio-placeholder"));
  await click(`[data-action="prompt"][data-id="${videoPrompt.id}"]`);
  assert.ok($(".result-card .audio-placeholder"));
  await click(`[data-action="result"][data-id="${videoResult.id}"]`);
  assert.ok($("#lightbox audio[controls][preload=metadata]"));
  assert.equal($('[data-action="copy-result"]').textContent, "Copy audio");
  await act("close-lightbox");
  // Returning to a large grid retains decoded image elements; unchanged cards also
  // survive search/filter refreshes and updates to other prompts.
  Object.defineProperty(w, "innerWidth", {value: 1100, configurable: true});
  Object.defineProperty(w, "innerHeight", {value: 720, configurable: true});
  const navigationPrompt = {...single, id: "navigation-prompt", title: "Navigation fixture", needs: ["single"], favorite: false, results: [result(90)]};
  w.testState.lib.prompts = [navigationPrompt, ...Array.from({length: 59}, (_, i) => ({...navigationPrompt, id: `navigation-${i}`, title: `Prompt ${i}`}))];
  w.testState.lib.sources = Array.from({length: 76}, (_, i) => ({...movie, id: `suggestion-${i}`, kind: undefined, name: `Photo ${i}`, tags: ["single"], thumbnail: `/tmp/poster-${i}.jpg`}));
  await click("#nav-prompts"); await click("#reload");
  const cachedCard = gridCard(navigationPrompt.id);
  const retainedImage = cachedCard.querySelector("img");
  assert.equal(retainedImage.getAttribute("loading"), "eager");
  assert.equal(gridCard("navigation-58").querySelector("img").getAttribute("loading"), "lazy");
  await click(`[data-action="prompt"][data-id="${navigationPrompt.id}"]`);
  assert.equal($("#suggested-photos"), null, "prompt detail has no suggested photos section");
  await act("back");
  assert.equal(gridCard(navigationPrompt.id), cachedCard);
  assert.equal(cachedCard.querySelector("img"), retainedImage);
  $("#search").value = "Navigation fixture"; $("#search").dispatchEvent(new w.Event("input"));
  assert.equal(gridCard(navigationPrompt.id), cachedCard);
  $("#search").value = ""; $("#search").dispatchEvent(new w.Event("input"));
  assert.equal(gridCard(navigationPrompt.id), cachedCard);
  navigationPrompt.title = "Updated fixture";
  const unchangedCard = gridCard("navigation-0");
  await click("#reload");
  assert.equal(gridCard(navigationPrompt.id).querySelector("h3").textContent, "Updated fixture");
  assert.equal(gridCard("navigation-0"), unchangedCard);
  await click("#nav-sources");
  assert.ok($(".new-folder-icon")); assert.equal($(".new-folder-label").textContent, "+ New folder");
  // Inspector controls use the real app save path, without touching a library on disk.
  await click('[data-action="open-folder"][data-id=""]');
  await act('source');
  assert.ok($('.item-inspector .inspector-preview'));
  const titleInput = $('.inline-name');
  titleInput.focus(); const initialTitle = titleInput.value;
  titleInput.value = 'Keep this';
  titleInput.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
  assert.equal($('#modal').open,true, 'inline Enter must not save the form');
  titleInput.focus(); titleInput.value='Revert this';
  titleInput.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(titleInput.value,'Keep this');
  titleInput.value=initialTitle;
  const preview = $('.inspector-preview img');
  Object.defineProperties(preview, {naturalWidth:{value:1024}, naturalHeight:{value:768}});
  preview.dispatchEvent(new w.Event('load'));
  assert.match($('.media-metadata').textContent,/1024×768/);
  await click('.folder-trigger');
  [...d.querySelectorAll('.control-popover [role=option]')].at(-1).click();
  const newFolder = $('.control-popover input'); newFolder.value='Inspector folder';
  newFolder.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(() => $('[name=folder]').value !== '', 'inline folder create/select');
  const createdFolder = $('[name=folder]').value;
  await save();
  assert.equal(w.testState.lib.sources[0].folder,createdFolder);
  assert.ok(w.testState.lib.folders.some(f=>f.id===createdFolder && f.name==='Inspector folder'));
  assert.equal($('.control-popover'),null);
  console.log('PASS: inspector media metadata, inline name key isolation, inline folder creation and persisted selection');
  // Multi-tag filter: click adds a tag, click again removes it, items must match every tag.
  await act("close-modal").catch(() => {});
  const mk = (n, tags) => ({...w.testState.lib.sources[0], id: `multi-${n}`, name: `Multi ${n}`, tags, folder: undefined});
  w.testState.lib.tags = [...new Set([...w.testState.lib.tags, "Libin", "Family"])];
  w.testState.lib.sources = [mk(1, ["Libin", "Family"]), mk(2, ["Libin"]), mk(3, ["Family"])];
  await click("#reload"); await click("#nav-sources");
  const shownIds = () => [...d.querySelectorAll(".source-card")].map(c => c.dataset.id).sort();
  await click('#tags [data-tag="Libin"]');
  assert.deepEqual(shownIds(), ["multi-1", "multi-2"]);
  await click('#tags [data-tag="Family"]');
  assert.deepEqual(shownIds(), ["multi-1"], "both tags must match");
  assert.equal(d.querySelectorAll("#tags .tag-filter.active").length, 2);
  await click('#tags [data-tag="Libin"]');
  assert.deepEqual(shownIds(), ["multi-1", "multi-3"], "second click removes only that tag");
  await click('#tags [data-tag="Family"]');
  assert.ok($(".folder-card"), "no tags selected returns to the folder grid");
  assert.equal($('#tags .active').dataset.tag, "");
  await click('#tags [data-tag="Libin"]'); await click('#tags [data-tag="Family"]');
  await click('#tags [data-tag=""]');
  assert.equal(d.querySelectorAll("#tags .tag-filter.active").length, 1, "All clears every tag");
  console.log("PASS: multi-tag filter toggles, AND matching and All clears");
  // JSDOM cannot emulate native WebKit control painting; verify that controls
  // explicitly opt out of it and that the document declares a light base scheme.
  // Isolated in-memory fixtures for motion / Undo / keyboard / palette contracts.
  await act('close-modal');
  if ($('#lightbox').open) await act('close-lightbox');
  const lib = w.testState.lib;
  lib.folders = [{id:'folder-a', name:'Alpha folder'}];
  lib.tags = ['Alpha tag']; lib.categories = ['Alpha category'];
  lib.sources = Array.from({length:5}, (_, i) => ({id:`photo-${i}`, name:`Alpha photo ${i}`, file:`photo-${i}.png`, originalName:`photo-${i}.png`, path:`/tmp/photo-${i}.png`, thumbnail:`/tmp/thumb-${i}.png`, tags:['Alpha tag'], folder:'folder-a', note:'', createdAt:'2026-11-05'}));
  lib.prompts = ['Alpha prefix', 'The Alpha word', 'xAlpha substring', 'Other'].map((title,i) => ({id:`prompt-${i}`,title,text:'test',needs:[],categories:i===3?['Other']:['Style'],favorite:i===0,notes:'',updatedAt:`2026-11-0${i+1}`,results:[0,1].map(j => ({id:`result-${i}-${j}`,path:`/tmp/result-${i}-${j}.png`,thumbnail:`/tmp/rthumb-${i}-${j}.png`,createdAt:'2026-11-05',sourcePhotos:['photo-0'],model:'',note:'',favorite:false}))}));
  const keypress = (el,key,extra={}) => el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
  const cmd = key => keypress(d.activeElement || d.body,key,{metaKey:true});
  const searchPalette = text => { $('#palette-search').value=text; $('#palette-search').dispatchEvent(new w.Event('input')); };
  const trashCalls = () => w.testState.calls.filter(c => c.cmd==='trash_item');
  $('#search').value=''; $('#search').dispatchEvent(new w.Event('input'));
  await click('#reload'); await click('#nav-prompts');
  // Clear an earlier test's category filter.
  await click('[data-action=filter][data-tag=""]');
  let cards = [...d.querySelectorAll('.prompt-card-open')];
  assert.equal(cards.length,4);
  cards.forEach((card,i) => card.getBoundingClientRect=()=>({top:Math.floor(i/2)*100,left:(i%2)*100,width:90,height:90}));
  cards[0].focus();
  keypress(cards[0],'ArrowRight'); assert.equal(d.activeElement,cards[1]);
  keypress(cards[1],'ArrowDown'); assert.equal(d.activeElement,cards[3]);
  keypress(cards[3],'ArrowUp'); assert.equal(d.activeElement,cards[1]);
  keypress(cards[1],'Home'); assert.equal(d.activeElement,cards[0]);
  keypress(cards[0],'End'); assert.equal(d.activeElement,cards[3]);
  assert.equal(cards.filter(c=>c.tabIndex===0).length,1);
  assert.ok([...d.querySelectorAll('.card-add-result')].every(c=>c.tabIndex===-1));
  keypress(cards[3],' '); assert.ok($('#lightbox').open);
  keypress(d.activeElement,' '); assert.equal($('#lightbox').open,false); assert.equal(d.activeElement,cards[3]);
  keypress(cards[3],'Enter'); await tick(); assert.match($('#toolbar-heading').textContent,/Other/);
  // Results and Try photos use the same roving contract, with Space previews.
  const results = [...d.querySelectorAll('#main .result-card')];
  results[0].focus(); keypress(results[0],'End'); assert.equal(d.activeElement,results[1]);
  keypress(results[1],' '); assert.ok($('#lightbox').open); keypress(d.activeElement,'Escape');
  assert.equal(d.activeElement,results[1]);
  if (!$('#try-grid')) await act('toggle-try');
  const tryCards = [...d.querySelectorAll('.try-card')];
  tryCards[0].focus(); keypress(tryCards[0],'ArrowRight'); assert.equal(d.activeElement,tryCards[1]);
  keypress(tryCards[1],' '); assert.match($('#lightbox-content').textContent,/Alpha photo 1/);
  keypress(d.activeElement,'Escape'); assert.equal(d.activeElement,tryCards[1]);
  cmd('2'); assert.ok($('#nav-sources').classList.contains('active'));
  const folderCard=$('[data-action=open-folder]'); folderCard.focus(); keypress(folderCard,'Enter'); await tick();
  const photos=[...d.querySelectorAll('#main .source-card')];
  photos[0].focus(); keypress(photos[0],'End'); assert.equal(d.activeElement,photos[4]);
  keypress(photos[4],' '); assert.ok($('#lightbox').open); keypress(d.activeElement,'Escape'); assert.equal(d.activeElement,photos[4]);
  keypress(photos[4],'Enter'); await tick(); assert.ok($('#modal').open);
  cmd('1'); assert.ok($('#nav-sources').classList.contains('active'),'dialog blocks view shortcut');
  await act('close-modal'); mainFocus();
  cmd('3'); assert.ok($('#favorites').classList.contains('active'));
  cmd('1'); assert.ok($('#nav-prompts').classList.contains('active'));
  function mainFocus() { $('#main').focus(); }
  // Palette ranking, cap, safe labels, focus return and all five destinations.
  $('#search').focus(); const paletteOrigin=d.activeElement; cmd('k'); assert.ok($('#palette').open);
  assert.equal(d.activeElement,$('#palette-search'));
  assert.match($('#palette-results [role=option]').textContent,/Other/,'recent prompts sorted by updatedAt');
  searchPalette('alpha');
  assert.deepEqual([...d.querySelectorAll('#palette-results [role=group]')].map(g=>g.getAttribute('aria-label')),['Prompts','Photos','Categories','Tags','Folders']);
  assert.deepEqual([...d.querySelectorAll('#palette-results [role=group]')][0].querySelectorAll('[role=option]').length,3);
  assert.match($('#palette-option-0').textContent,/Alpha prefix/);
  assert.match($('#palette-option-1').textContent,/The Alpha word/);
  assert.match($('#palette-option-2').textContent,/xAlpha substring/);
  keypress($('#palette-search'),'ArrowDown'); assert.equal($('#palette-search').getAttribute('aria-activedescendant'),'palette-option-1');
  keypress($('#palette-search'),'Escape'); assert.equal(d.activeElement,paletteOrigin);
  for (const [term, expected] of [['Alpha prefix','prompt'],['Alpha photo 0','photo'],['Alpha category','category'],['Alpha tag','tag'],['Alpha folder','folder']]) {
    mainFocus(); cmd('k'); searchPalette(term);
    const groupLabel=({prompt:'Prompts',photo:'Photos',category:'Categories',tag:'Tags',folder:'Folders'})[expected];
    const row=$(`#palette-results [role=group][aria-label="${groupLabel}"] [role=option]`);
    assert.ok(row,expected);
    const target=Number(row.dataset.paletteIndex);
    for(let i=0;i<target;i++) keypress($('#palette-search'),'ArrowDown');
    keypress($('#palette-search'),'Enter'); await tick();
    assert.equal($('#palette').open,false);
    if(expected==='photo') { assert.ok($('#modal').open); await act('close-modal'); }
    if(expected==='prompt') assert.match($('#toolbar-heading').textContent,/Alpha prefix/);
    if(expected==='category'||expected==='tag') assert.ok($(`[data-action=filter][data-tag="${term}"].active`));
    if(expected==='folder') assert.match($('#toolbar-heading').textContent,/Alpha folder/);
  }
  // Photos: immediate hiding, watcher filtering, text undo isolation, button undo.
  await click('[data-action=source][data-id=photo-0]');
  const beforeTrash=trashCalls().length;
  await act('delete-source'); assert.equal($('#modal').open,false);
  assert.equal($('#main [data-id=photo-0]'),null); assert.equal($('#source-count').textContent,'4');
  assert.equal(trashCalls().length,beforeTrash);
  w.dispatchEvent(new w.Event('beforeunload')); assert.equal(trashCalls().length,beforeTrash,'quitting does not commit');
  w.testState.listeners['library-changed']({payload:lib.root}); await tick();
  assert.equal($('#main [data-id=photo-0]'),null);
  $('#search').focus(); cmd('z'); await tick(); assert.ok($('[data-action=undo-trash]'));
  mainFocus(); cmd('z'); await tick(); assert.equal($('#source-count').textContent,'5');
  assert.equal(trashCalls().length,beforeTrash);
  await click('[data-action=source][data-id=photo-0]'); await act('delete-source');
  await act('undo-trash'); assert.equal(trashCalls().length,beforeTrash);
  await click('[data-action=source][data-id=photo-0]'); await act('delete-source');
  await expireTrash(); assert.equal(trashCalls().length,beforeTrash+1);
  assert.deepEqual(JSON.parse(JSON.stringify(trashCalls().at(-1).args)),{kind:'source',id:'photo-0',promptId:null});
  await expireTrash(); assert.equal(trashCalls().length,beforeTrash+1);
  // Second Trash commits the previous item; failure restores the hidden item.
  await click('[data-action=source][data-id=photo-1]'); await act('delete-source');
  await click('[data-action=source][data-id=photo-2]'); await act('delete-source');
  assert.equal(trashCalls().at(-1).args.id,'photo-1');
  w.testState.trashError='Trash unavailable'; await expireTrash();
  assert.match($('#toast').textContent,/Trash unavailable/); assert.ok($('#main [data-id=photo-2]'));
  w.testState.trashError=null;
  // Prompt deletion navigates back; undo restores the prompt without IPC.
  mainFocus(); cmd('1'); await click('[data-action=filter][data-tag=""]');
  await click('[data-action=prompt][data-id=prompt-0]'); await act('prompt-menu'); await act('delete-prompt');
  assert.equal($('#main [data-action=prompt][data-id=prompt-0]'),null);
  await act('undo-trash'); assert.ok($('#main [data-action=prompt][data-id=prompt-0]'));
  // Removing a lightbox result advances, and undo restores its list.
  await click('[data-action=prompt][data-id=prompt-0]'); await click('#main .result-card');
  await act('delete-result'); assert.ok($('#lightbox').open); assert.equal($('[data-action=undo-trash]').closest('dialog'),$('#lightbox'),'Undo remains in modal focus scope'); assert.match($('#lightbox .dialog-header').textContent,/1 \/ 1/);
  await act('undo-trash'); assert.match($('#lightbox .dialog-header').textContent,/2/);
  await act('delete-result'); await act('delete-result'); assert.equal($('#lightbox').open,false);
  await act('undo-trash');
  // A library switch flushes the final pending entry before set_library.
  mainFocus(); cmd('2'); await click('[data-action=filter][data-tag="Alpha tag"]');
  if (!$('[data-action=source]')) await click('[data-action=open-folder][data-id=folder-a]');
  await click('[data-action=source]'); await act('delete-source');
  const callStart=w.testState.calls.length;
  await click('#switch-library');
  const commands=w.testState.calls.slice(callStart).map(c=>c.cmd);
  assert.ok(commands.indexOf('trash_item') < commands.indexOf('set_library'));
  // Cached-complete and error images are never left transparent.
  const completeImage=d.createElement('img'); Object.defineProperty(completeImage,'complete',{value:true});
  $('#main').append(completeImage); await tick(); assert.ok(!completeImage.classList.contains('image-loading'));
  const brokenImage=d.createElement('img'); Object.defineProperty(brokenImage,'complete',{value:false});
  $('#main').append(brokenImage); await tick(); brokenImage.dispatchEvent(new w.Event('error'));
  assert.ok(!brokenImage.classList.contains('image-loading'));
  // Result FLIP honors reduced motion and missing geometry.
  mainFocus(); cmd('1'); await click('[data-action=filter][data-tag=""]');
  await click('[data-action=prompt][data-id=prompt-1]'); await click('#main .result-card');
  const previewImg=$('img.lightbox-image');
  Object.defineProperty(previewImg,'complete',{value:true});
  previewImg.getBoundingClientRect=()=>({left:100,top:100,width:400,height:400});
  let animationCount=0; previewImg.animate=()=>{animationCount++;};
  const originCard={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
  w.matchMedia=()=>({matches:true}); w.animateResult(originCard);
  await new Promise(r=>setTimeout(r,30)); assert.equal(animationCount,0);
  w.matchMedia=()=>({matches:false}); w.animateResult(originCard);
  await new Promise(r=>setTimeout(r,30)); assert.equal(animationCount,1);
  w.animateResult(null); await new Promise(r=>setTimeout(r,30)); assert.equal(animationCount,1);
  await act('close-lightbox');
  // Large groups remain bounded, and mouse hover/click activates the highlighted row.
  const savedCategories=[...lib.categories], savedTags=[...lib.tags], savedFolders=[...lib.folders];
  lib.sources.push({...lib.sources[0],id:'cap-photo-1',name:'Alpha extra 1'}, {...lib.sources[0],id:'cap-photo-2',name:'Alpha extra 2'});
  for(let i=0;i<12;i++) { lib.categories.push(`Alpha category ${i}`); lib.tags.push(`Alpha tag ${i}`); lib.folders.push({id:`extra-${i}`,name:`Alpha folder ${i}`}); }
  await click('#reload'); mainFocus(); cmd('k'); searchPalette('alpha');
  assert.equal(d.querySelectorAll('#palette [role=option]').length,30);
  for(const group of d.querySelectorAll('#palette [role=group]')) assert.ok(group.querySelectorAll('[role=option]').length<=8);
  const mouseRow=$('#palette-option-1'); mouseRow.dispatchEvent(new w.MouseEvent('mouseover',{bubbles:true}));
  assert.equal($('#palette-search').getAttribute('aria-activedescendant'),mouseRow.id);
  mouseRow.click(); assert.equal($('#palette').open,false); assert.match($('#toolbar-heading').textContent,/The Alpha word/);
  lib.categories=savedCategories; lib.tags=savedTags; lib.folders=savedFolders;

  console.log('PASS: deferred Trash/Undo/timeout/second action/watcher/failure/library switch; grid arrows/Home/End/Enter/Space/focus; Cmd+1–3; palette grouping/ranking/keyboard destinations/focus; complete/error images');

  const style = d.createElement("style");
  style.textContent = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  d.head.append(style);
  assert.equal(w.getComputedStyle(d.documentElement).colorScheme, "light");
  assert.equal(w.getComputedStyle($("#toolbar button" )).appearance, "none");
  console.log("PASS: retained prompt/image nodes, eager first screen, changed-record refresh, no suggested photos section, folder content and explicit light control scheme");
  console.log("PASS: toolbar search, Photos label, tag expansion persistence, audio tiles and source/result players");
  console.log("PASS: folder grid, breadcrumb, import membership, Move to, cross-folder filters, rename/delete, extension-free names, source/result video cards and playback controls");

  console.log(
    "PASS: first run, source import/tag/edit/copy, exact prompt text, safe HTML, matching photos, result defaults, drop, lightbox arrows, chat, favorites/search, context menu, Trash, missing references, image/text paste, Cmd+F and Cmd+N, 0/1/2/5-result cards, thumbnail cap/order, Retina drop targeting/highlights, card picker, hovered/focused paste, stale-target rejection, try-with-a-photo panel (all photos, AND tags, search, ⌘C, pre-linking), lightbox source previews, bulk link/clear preserving other metadata, Cmd/Shift selection, any-tag matching, fallback strip, and tooltip/reveal cleanup.",
  );
} finally {
  w.close();
}
