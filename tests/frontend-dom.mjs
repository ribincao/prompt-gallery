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
  const originalTags = [...w.testState.lib.tags];
  w.testState.lib.tags.push(...Array.from({length: 8}, (_, i) => `extra-${i}`));
  await click("#reload");
  assert.equal(d.querySelectorAll("#tags .tag-dot").length, originalTags.length + 8, "all tags shown by default");
  assert.equal($("#more-tags").getAttribute("aria-expanded"), "true");
  await click("#more-tags");
  assert.equal(w.localStorage.getItem("gallery-tags-collapsed"), "true");
  assert.equal(d.querySelectorAll("#tags .tag-dot").length, 6);
  await click("#more-tags");
  assert.equal(w.localStorage.getItem("gallery-tags-collapsed"), "false");
  w.testState.lib.tags = originalTags;
  await click("#reload");
  await click("#nav-sources");
  await act("pick-sources");
  await wait(() => $("#modal").open, "import");
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
  assert.equal(d.querySelectorAll('.token-control').length, 2);
  assert.ok($('.token-control[data-name=needs]'));
  assert.ok($('.token-control[data-name=tags]'));
  assert.equal($('#dialog-form .checks'), null);
  input("title", "Portrait <test>");
  const text = "  Illustrate this portrait.\nKeep the person recognizable.\n";
  input("text", text);
  await addTag("needs", "single");
  await save();
  assert.equal($("#toolbar h1").textContent, "Portrait <test>");
  assert.equal($("#suggested-photos"), null);
  assert.equal(d.querySelectorAll("test").length, 0);
  await act("copy-prompt");
  assert.equal(w.testState.copied, text);
  await act("pick-results");
  assert.equal($("[name=chatUrl]").value, "https://chatgpt.com/c/test");
  assert.equal($("[name=sources]").checked, false, "nothing preselected without an opened photo");
  $("[name=sources]").click();
  assert.equal($("[name=sources]").checked, true);
  assert.equal($(".source-option-name").textContent, "Kujira <bucket>");
  await save();
  assert.equal(w.testState.lib.prompts[0].results[0].sourcePhotos.length, 1);
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
  await save();
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
  assert.equal($("#suggested-photos"), null);
  await act("edit-prompt");
  assert.match($("#dialog-form").textContent, /listed first when you link results/);
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
  assert.match($(".tag-row.editing").textContent, /Photos and prompts are kept/);
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
  assert.ok(w.testState.lib.prompts.every(p => !p.needs.includes("single") && !p.tags.includes("single")));
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
  // JSDOM cannot emulate native WebKit control painting; verify that controls
  // explicitly opt out of it and that the document declares a light base scheme.
  const style = d.createElement("style");
  style.textContent = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  d.head.append(style);
  assert.equal(w.getComputedStyle(d.documentElement).colorScheme, "light");
  assert.equal(w.getComputedStyle($("#toolbar button" )).appearance, "none");
  console.log("PASS: retained prompt/image nodes, eager first screen, changed-record refresh, no suggested photos section, folder content and explicit light control scheme");
  console.log("PASS: toolbar search, Photos label, tag expansion persistence, audio tiles and source/result players");
  console.log("PASS: folder grid, breadcrumb, import membership, Move to, cross-folder filters, rename/delete, extension-free names, source/result video cards and playback controls");

  console.log(
    "PASS: first run, source import/tag/edit/copy, exact prompt text, safe HTML, matching photos, result defaults, drop, lightbox arrows, chat, favorites/search, context menu, Trash, missing references, image/text paste, Cmd+F and Cmd+N, 0/1/2/5-result cards, thumbnail cap/order, Retina drop targeting/highlights, card picker, hovered/focused paste, stale-target rejection, matching-first thumbnail toggles, lightbox source previews, bulk link/clear preserving other metadata, Cmd/Shift selection, any-tag matching, fallback strip, and tooltip/reveal cleanup.",
  );
} finally {
  w.close();
}
