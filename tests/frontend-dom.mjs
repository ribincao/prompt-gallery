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
w.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
w.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
w.eval(`(${installMockBridge.toString()})();`);
// Load the UI modules into the same DOM realm before the app entry point.
for (const file of ["prompt-cards.js", "result-tools.js"]) {
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
  await click("#nav-sources");
  await act("pick-sources");
  await wait(() => $("#modal").open, "import");
  $("[name=tags][value=single]").checked = true;
  await save();
  assert.equal(w.testState.lib.sources[0].tags[0], "single");
  await act("source");
  await act("copy-image");
  input("note", "A reference photo");
  await save();
  assert.equal(w.testState.lib.sources[0].note, "A reference photo");
  assert.ok(w.testState.calls.some((c) => c.cmd === "copy_image_to_clipboard"));
  await click("#nav-prompts");
  await act("new-prompt");
  input("title", "Portrait <test>");
  const text = "  Illustrate this portrait.\nKeep the person recognizable.\n";
  input("text", text);
  $("[name=needs][value=single]").checked = true;
  await save();
  assert.equal($("#main h1").textContent, "Portrait <test>");
  assert.equal(d.querySelectorAll(".source-mini").length, 1);
  assert.equal(d.querySelectorAll("test").length, 0);
  await act("copy-prompt");
  assert.equal(w.testState.copied, text);
  await act("source");
  await act("close-modal");
  await act("pick-results");
  assert.equal($("[name=chatUrl]").value, "https://chatgpt.com/c/test");
  assert.equal($("[name=sources]").checked, true);
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].sourcePhotos.length, 1);
  await act("result");
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
  $(".source-card").dispatchEvent(
    new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }),
  );
  assert.equal($("#context-menu").hidden, false);
  await click("#context-menu [data-action=source]");
  await act("delete-source");
  await save();
  assert.equal(w.testState.lib.sources.length, 0);
  await click("#nav-prompts");
  await act("prompt");
  await act("result");
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
  await click("#favorites");
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
  w.testState.lib.sources = [otherPhoto, matchingGroup, matchingSingle];
  first.needs = ["single", "group"];
  $("#search").value = "";
  $("#search").dispatchEvent(new w.Event("input"));
  await click("#reload");
  await click(`.prompt-card[data-prompt-id="${first.id}"] [data-action=prompt]`);
  assert.equal(d.querySelectorAll(".source-mini").length, 2);
  assert.equal(d.querySelectorAll(".source-card[title],.source-mini [data-action=reveal]").length, 0);
  await act("edit-prompt");
  assert.match($("#dialog-form").textContent, /Show source photos tagged with any of these/);
  await act("close-modal");
  await act("pick-results");
  assert.deepEqual(
    [...d.querySelectorAll(".source-option input")].map((el) => el.value),
    [matchingGroup.id, matchingSingle.id, otherPhoto.id],
  );
  assert.equal(d.querySelectorAll(".source-option-photo img").length, 3);
  await click(".source-option:nth-child(1)");
  await click(".source-option:nth-child(2)");
  assert.equal(d.querySelectorAll(".source-option input:checked").length, 2);
  await save();
  const newResult = first.results[0];
  assert.deepEqual([...newResult.sourcePhotos], [matchingGroup.id, matchingSingle.id]);
  await click(`.result-card[data-id="${newResult.id}"]`);
  assert.equal(d.querySelectorAll(".linked-source img").length, 2);
  await act("light-source");
  assert.match($("#modal-content h2").textContent, /Group.png/);
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
    }),
  );
  const before = first.results.map((r) => ({ ...r, sourcePhotos: [...r.sourcePhotos] }));
  await click("#reload");
  await act("select-results");
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
    for (const key of ["chatUrl", "model", "note", "favorite"]) assert.equal(r[key], before[i][key]);
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
  assert.match($("#main").textContent, /No matching photos yet/);
  await act("show-all-sources");
  assert.equal(d.querySelectorAll(".source-mini").length, 3);
  assert.equal(d.querySelectorAll(".source-mini [data-action=reveal]").length, 0);
  console.log(
    "PASS: first run, source import/tag/edit/copy, exact prompt text, safe HTML, matching photos, result defaults, drop, lightbox arrows, chat, favorites/search, context menu, Trash, missing references, image/text paste, Cmd+F and Cmd+N, 0/1/2/5-result cards, thumbnail cap/order, Retina drop targeting/highlights, card picker, hovered/focused paste, stale-target rejection, matching-first thumbnail toggles, lightbox source previews, bulk link/clear preserving other metadata, Cmd/Shift selection, any-tag matching, fallback strip, and tooltip/reveal cleanup.",
  );
} finally {
  w.close();
}
