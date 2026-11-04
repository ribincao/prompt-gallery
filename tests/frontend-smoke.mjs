import { installMockBridge } from "./mock-bridge.mjs";
// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/frontend-smoke.mjs.
// Uses an isolated browser and mocked IPC; native integration still needs the macOS checklist.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const server = createServer(async (req, res) => {
  const file = req.url === "/" ? "/index.html" : req.url;
  if (!["/index.html", "/styles.css", "/app.js", "/prompt-cards.js", "/result-tools.js"].includes(file)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
  );
  res.end(await readFile(resolve(root, "src", file.slice(1))));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installMockBridge);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Choose a library folder" }).click();
  await page.getByRole("heading", { name: "Your next idea starts here" }).waitFor();
  await page.locator("#nav-sources").click();
  await page.getByRole("button", { name: "+ Add photos" }).click();
  await page.getByRole("heading", { name: "Tag your photo", exact: true }).waitFor();
  await page.getByLabel("single", { exact: true }).check();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await page.locator(".source-card").click();
  await page.getByRole("button", { name: "Copy image", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => testState.calls.filter((c) => c.cmd === "copy_image_to_clipboard"))).length,
    1,
  );
  await page.getByLabel("Note", { exact: true }).fill("A reference photo");
  await page.getByRole("button", { name: "Save photo details" }).click();
  await page.locator("#nav-prompts").click();
  await page.getByRole("button", { name: "+ New prompt" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Portrait <test>");
  const text = "  Turn the photo into a gentle illustrated portrait.\nKeep the person recognizable.\n";
  await page.getByLabel("Prompt text", { exact: true }).fill(text);
  await page.getByLabel("single", { exact: true }).check();
  await page.getByRole("button", { name: "Create prompt", exact: true }).click();
  await page.getByRole("heading", { name: "Portrait <test>", exact: true }).waitFor();
  assert.equal(await page.locator(".source-mini").count(), 1);
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  assert.equal(await page.evaluate(() => testState.copied), text);
  await page.locator(".source-card").click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "+ Add result" }).click();
  assert.equal(await page.getByLabel("Chat URL", { exact: true }).inputValue(), "https://chatgpt.com/c/test");
  assert.equal(await page.getByLabel("Original.png", { exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "Add results", exact: true }).click();
  await page.locator("[data-action=result]").click();
  await page.getByRole("button", { name: "Open chat ↗" }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => testState.listeners["tauri://drag-drop"]({ payload: { paths: ["/tmp/second.jpg"] } }));
  await page.getByRole("button", { name: "Add results", exact: true }).click();
  await page.locator("[data-action=result]").first().click();
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator("#lightbox-content").innerText(), /2 \/ 2/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add to favorites", exact: true }).click();
  await page.getByRole("button", { name: "‹ All prompts" }).click();
  await page.locator("#favorites").click();
  assert.equal(await page.locator("[data-action=prompt]").count(), 1);
  await page.locator("#search").fill("no-match");
  assert.equal(await page.locator("[data-action=prompt]").count(), 0);
  await page.locator("#search").fill("");
  await page.locator("#nav-sources").click();
  await page.locator(".source-card").click({ button: "right" });
  await page.locator("#context-menu").getByRole("button", { name: "Edit tags" }).click();
  await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await page.locator("#nav-prompts").click();
  await page.locator("[data-action=prompt]").click();
  await page.locator("[data-action=result]").first().click();
  assert.match(await page.locator("#lightbox-content").innerText(), /Source photo missing/);
  await page.keyboard.press("Escape");
  await page.locator("#nav-sources").click();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "pasted.png", { type: "image/png" }),
    );
    document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  });
  await page.getByRole("heading", { name: "Tag your photo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await page.screenshot({ path: "/tmp/prompt-gallery-sources.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/prompt-gallery-dark.png" });
  await page.setViewportSize({ width: 800, height: 560 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => { testState.lib.tags = Array.from({length: 15}, (_, i) => `tag-${i + 1}`); });
  await page.locator("#reload").click();
  await page.locator("#nav-prompts").click();
  await page.getByRole("button", {name: "+ New prompt", exact: true}).click();
  const geometry = () => {
    const modal = document.querySelector("#modal"), form = document.querySelector("#dialog-form");
    const header = document.querySelector(".dialog-heading");
    const r = header.getBoundingClientRect();
    return {modalScroll: modal.scrollHeight > modal.clientHeight, bodyScroll: form.scrollHeight > form.clientHeight + 1, headerTop: r.top, headerBottom: r.bottom};
  };
  await page.waitForTimeout(50);
  let layout = await page.evaluate(geometry);
  assert.equal(layout.modalScroll, false);
  assert.equal(layout.bodyScroll, false, JSON.stringify(layout));
  await page.screenshot({path: "/tmp/prompt-gallery-new-prompt-1200.png"});
  await page.locator('[name=text]').fill("A long prompt line.\n".repeat(40));
  assert.ok(await page.locator('[name=text]').evaluate(e => e.scrollHeight > e.clientHeight));
  await page.setViewportSize({width: 800, height: 560});
  await page.locator("#dialog-form").evaluate(e => e.scrollTop = e.scrollHeight);
  layout = await page.evaluate(geometry);
  assert.equal(layout.modalScroll, false);
  assert.ok(layout.headerTop >= 0 && layout.headerBottom < 560);
  assert.ok(layout.bodyScroll);
  await page.screenshot({path: "/tmp/prompt-gallery-new-prompt-small.png"});
  await page.keyboard.press("Escape");
  await page.locator("#manage-tags").click();
  await page.locator("#tag-list").waitFor();
  assert.ok(await page.locator("#tag-list").evaluate(e => e.scrollHeight > e.clientHeight));
  assert.equal((await page.evaluate(geometry)).modalScroll, false);
  assert.equal((await page.evaluate(geometry)).bodyScroll, false);
  await page.screenshot({path: "/tmp/prompt-gallery-tags-small.png"});
  await page.keyboard.press("Escape");
  await page.setViewportSize({width: 1200, height: 800});
  await page.emulateMedia({colorScheme: "light"});
  await page.getByRole("button", {name: "+ New prompt", exact: true}).click();
  await page.locator('[name=title]').fill("Enter saves");
  await page.locator('[name=title]').press("Enter");
  await page.locator("#modal").waitFor({state: "hidden"});
  assert.equal(await page.locator("#main h1").innerText(), "Enter saves");
  console.log("PASS: 15-tag prompt fits 1200x800; long text scrolls internally; header stays visible at 800x560; tag list scrolls alone; Enter submits; Escape closes");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: first run, import/tag/edit source, create/copy prompt, matching photos, result form defaults, drop, lightbox navigation, open chat, favorites/search, context menu, Trash, missing sources, image paste, light/dark and minimum size.",
  );
} finally {
  await browser.close();
  server.close();
}
