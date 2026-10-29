// Run with Playwright Core installed (or set PLAYWRIGHT_CORE_PATH).
// Set GALLERY_BASELINE_REF to a Git ref for an optional old/new rendering comparison.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core")); } catch {}
const root = path.resolve(__dirname, "..");
const baseline = process.env.GALLERY_BASELINE_REF
  ? execFileSync("git", ["show", `${process.env.GALLERY_BASELINE_REF}:js/preview_load_image.js`], { cwd: root, encoding: "utf8" })
  : null;

async function fixture(browser, count, legacy = false, { mtimeDelay = 0, nested = false } = {}) {
  const state = {
    filenames: Array.from({ length: count }, (_, index) => `image-${String(index).padStart(5, "0")}.png`),
    mtimes: {}, images: 0, operations: 0, directories: [], imagePaths: [],
  };
  if (nested) {
    state.directories = ["album", "album/deep", "empty"];
    state.filenames.push("album/image-00000.png", "album/deep/细节 #.png");
  }
  state.filenames.forEach((name, index) => { state.mtimes[name] = index; });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (data, type = "application/json", status = 200) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(typeof data === "string" ? data : JSON.stringify(data));
    };
    if (url.pathname === "/") return send(`<!doctype html><html><head><style>
      body { margin: 0; background: #111; } button, input, select { font-family: sans-serif; }
      </style></head><body><script type="module">
      import { app } from "/scripts/app.js";
      await import("/extensions/funcode/preview_load_image.js${legacy ? "?legacy=1" : ""}");
      localStorage.setItem("FunCode.LoadImagePreviewNode.previewWidth", "280");
      localStorage.setItem("FunCode.LoadImagePreviewNode.previewHeight", "280");
      const widget = { name: "image", value: "image-00000.png", options: { values: ${JSON.stringify(state.filenames)} }, callback(value) { window.selected = value; } };
      const otherWidget = { name: "image", value: "image-00000.png", options: { values: ["image-00000.png"] } };
      const node = { comfyClass: "LoadImageFunCodeNode", widgets: [widget], setDirtyCanvas() {},
        addWidget(type, label, value, callback) { window.openGallery = callback; } };
      app.graph._nodes = [node, { comfyClass: "LoadImage", widgets: [otherWidget], setDirtyCanvas() {} }];
      await window.extension.nodeCreated(node);
      window.fixture = { widget, otherWidget, started: performance.now() };
      window.openGallery();
      </script></body></html>`, "text/html");
    if (url.pathname === "/scripts/app.js") return send(
      "export const app = { graph: { _nodes: [] }, registerExtension(extension) { window.extension = extension; } };", "text/javascript");
    if (url.pathname === "/scripts/api.js") return send(
      "export const api = { apiURL: url => url, fetchApi: (url, options) => fetch(url, options) };", "text/javascript");
    if (url.pathname === "/extensions/funcode/preview_load_image.js") return send(
      url.searchParams.has("legacy") ? baseline : fs.readFileSync(path.join(root, "js/preview_load_image.js"), "utf8"), "text/javascript");
    if (url.pathname === "/extensions/funcode/preview_image_grid.js") return send(
      fs.readFileSync(path.join(root, "js/preview_image_grid.js"), "utf8"), "text/javascript");
    if (url.pathname === "/object_info/LoadImageFunCodeNode") return send({
      LoadImageFunCodeNode: { input: { required: { image: [state.filenames, {}] } } },
    });
    if (url.pathname === "/funcode/input_files_mtime") {
      if (mtimeDelay) await new Promise(resolve => setTimeout(resolve, mtimeDelay));
      return send({ mtimes: state.mtimes });
    }
    if (url.pathname === "/funcode/input_images") {
      if (mtimeDelay) await new Promise(resolve => setTimeout(resolve, mtimeDelay));
      const directory = url.searchParams.get("directory") || "";
      if (directory && !state.directories.includes(directory)) return send({ error: "Directory not found." }, "application/json", 404);
      const parentOf = name => name.slice(0, Math.max(0, name.lastIndexOf("/")));
      return send({
        directory, files: state.filenames.filter(name => parentOf(name) === directory),
        directories: state.directories.filter(name => parentOf(name) === directory), mtimes: state.mtimes,
      });
    }
    if (url.pathname === "/view") {
      state.images++;
      const directory = url.searchParams.get("subfolder");
      const filename = url.searchParams.get("filename");
      const relative = directory ? `${directory}/${filename}` : filename;
      state.imagePaths.push(relative);
      if (!state.filenames.includes(relative) || filename.includes("/")) return send("Missing image", "text/plain", 404);
      return send('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#456e8c"/><circle cx="50" cy="50" r="25" fill="#a4cfbc"/></svg>', "image/svg+xml");
    }
    if (url.pathname.startsWith("/funcode/input_image/")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      state.operations++;
      if (url.pathname.endsWith("/rename")) {
        const parent = payload.filename.slice(0, Math.max(0, payload.filename.lastIndexOf("/")));
        const renamed = parent ? `${parent}/${payload.new_name}` : payload.new_name;
        if (state.filenames.includes(renamed)) return send({ error: "A file with that name already exists." }, "application/json", 409);
        state.filenames = state.filenames.map(name => name === payload.filename ? renamed : name).sort();
        state.mtimes[renamed] = state.mtimes[payload.filename];
        delete state.mtimes[payload.filename];
        return send({ filename: renamed, mtime: state.mtimes[renamed] });
      }
      if (url.pathname.endsWith("/delete")) {
        state.filenames = state.filenames.filter(name => name !== payload.filename);
        state.deleted = payload.filename;
        return send({ filename: payload.filename, token: "fixture-trash-token" });
      }
      state.filenames.push(state.deleted);
      return send({ filename: state.deleted, mtime: state.mtimes[state.deleted] });
    }
    send("Not found", "text/plain", 404);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") logs.push(message.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(count => window.fixture?.widget.options.values.length === count &&
      [...document.querySelectorAll("button")].some(button => button.textContent === "Refresh" && !button.disabled), state.filenames.length, { timeout: 8000 });
  } catch (error) {
    console.error("Browser fixture failed:", { count, legacy, errors, logs, body: await page.locator("body").innerText() });
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return {
    page, state, errors,
    async metrics() {
      const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(item => [item.name, item.value]));
      return {
        cards: await page.locator("img").count(),
        layoutMs: Math.round(metrics.LayoutDuration * 1000),
        scriptMs: Math.round(metrics.ScriptDuration * 1000),
        heapMB: Math.round(metrics.JSHeapUsedSize / 1024 / 1024 * 10) / 10,
        nodes: metrics.Nodes,
      };
    },
    async close() { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test("real Chromium: bounded cards, scroll/resize anchors and file controls", { skip: !chromium }, async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());

  await t.test("browse directories, preview nested namesakes, mutate and undo across directories", async () => {
    const ui = await fixture(browser, 2, false, { nested: true });
    const { page } = ui;
    try {
      assert.equal(await page.locator(".funcode-gallery-card").first().getAttribute("data-directory"), "album");
      await page.locator('.funcode-gallery-card[data-directory="album"]').click();
      await page.waitForSelector('.funcode-gallery-card[data-filename="album/image-00000.png"]');
      assert.equal(await page.locator(".funcode-gallery-viewport").count(), 1);
      const nested = page.locator('.funcode-gallery-card[data-filename="album/image-00000.png"]');
      await page.waitForFunction(() => document.querySelector('[data-filename="album/image-00000.png"] img')?.naturalWidth > 0);
      assert.ok(ui.state.imagePaths.includes("album/image-00000.png"));
      await page.evaluate(() => { window.fixture.widget.value = "album/image-00000.png"; });
      await nested.hover();
      page.once("dialog", dialog => dialog.accept("renamed"));
      await nested.getByRole("button", { name: "Rename: album/image-00000.png", exact: true }).click();
      await page.waitForSelector('[data-filename="album/renamed.png"]');
      assert.equal(await page.evaluate(() => window.fixture.widget.value), "album/renamed.png");
      assert.equal(await page.evaluate(() => window.fixture.otherWidget.value), "image-00000.png");
      const renamed = page.locator('[data-filename="album/renamed.png"]');
      await renamed.hover();
      page.once("dialog", dialog => dialog.accept());
      await renamed.getByRole("button", { name: "Delete: album/renamed.png", exact: true }).click();
      await page.waitForFunction(() => window.fixture.widget.value === "");
      await page.getByRole("button", { name: "Up", exact: true }).click();
      await page.waitForSelector('.funcode-gallery-card[data-directory="album"]');
      await page.getByRole("button", { name: "Undo Delete", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("button[aria-current='location']")?.textContent === "input" &&
        [...document.querySelectorAll("button")].some(button => button.textContent === "Undo Delete" && button.hidden));
      assert.equal(await page.locator('[data-filename="album/renamed.png"]').count(), 0);
      assert.ok(await page.evaluate(() => window.fixture.widget.options.values.includes("album/renamed.png")));
      await page.locator('.funcode-gallery-card[data-directory="empty"]').click();
      await page.waitForFunction(() => document.querySelector("[role=status]").textContent.includes("No images or folders"));
      assert.equal(await page.locator(".funcode-gallery-card").count(), 0);
      await page.getByRole("navigation").getByRole("button", { name: "input", exact: true }).click();
      await page.locator('.funcode-gallery-card[data-directory="album"]').click();
      await page.waitForSelector('.funcode-gallery-card[data-directory="album/deep"]');
      if (process.env.GALLERY_DIRECTORY_SCREENSHOT) await page.screenshot({ path: process.env.GALLERY_DIRECTORY_SCREENSHOT });
      await page.locator('.funcode-gallery-card[data-directory="album/deep"]').click();
      const deep = page.locator('.funcode-gallery-card[data-filename="album/deep/细节 #.png"]');
      await deep.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-filename="album/deep/细节 #.png"] img')?.naturalWidth > 0);
      await deep.locator("img").click();
      assert.equal(await page.evaluate(() => window.fixture.widget.value), "album/deep/细节 #.png");
      assert.equal(await page.locator(".funcode-gallery-viewport").count(), 0);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  });

  await t.test("cached filenames and delayed modification times never send a newly opened gallery to the bottom", async () => {
    const ui = await fixture(browser, 1000, false, { mtimeDelay: 100 });
    const { page } = ui;
    try {
      const viewport = page.locator(".funcode-gallery-viewport");
      assert.equal(await viewport.evaluate(element => element.scrollTop), 0);
      assert.equal(await page.locator(".funcode-gallery-card").first().getAttribute("data-filename"), "image-00999.png");

      // Refreshing at the top should show newly added files instead of following the former first file.
      for (let index = 0; index < 40; index++) {
        const filename = `new-${index}.png`;
        ui.state.filenames.push(filename);
        ui.state.mtimes[filename] = 2000 + index;
      }
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Refreshing…"));
      await page.waitForFunction(() => document.querySelector(".funcode-gallery-card")?.dataset.filename === "new-39.png");
      assert.equal(await viewport.evaluate(element => element.scrollTop), 0);

      // A genuine user scroll should still be preserved by manual refresh.
      await viewport.evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await viewport.evaluate(element => element.scrollTop);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Refreshing…"));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await viewport.evaluate(element => element.scrollTop), before);

      await page.keyboard.press("Escape");
      await page.evaluate(() => window.openGallery());
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Refreshing…"));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator(".funcode-gallery-viewport").evaluate(element => element.scrollTop), 0);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  });

  await t.test("DOM and initial rendering metrics across gallery sizes", async () => {
    const results = [];
    for (const count of [100, 1000, 10000]) {
      const ui = await fixture(browser, count);
      try {
        const modern = await ui.metrics();
        assert.ok(modern.cards <= 32, `${count} files created ${modern.cards} cards`);
        assert.deepEqual(ui.errors, []);
        const row = { files: count, virtual: modern };
        if (baseline) {
          const old = await fixture(browser, count, true);
          try {
            row.previous = await old.metrics();
            assert.equal(row.previous.cards, count);
            assert.deepEqual(old.errors, []);
          } finally { await old.close(); }
        }
        results.push(row);
      } finally { await ui.close(); }
    }
    console.log("Gallery rendering metrics:", JSON.stringify(results));
  });

  await t.test("fast scroll, viewport resizing, dimensions and filter preserve correct content", async () => {
    const ui = await fixture(browser, 10000);
    const { page } = ui;
    try {
      const first = await page.locator(".funcode-gallery-card").first().getAttribute("data-filename");
      await page.evaluate(() => {
        const viewport = document.querySelector(".funcode-gallery-viewport");
        viewport.scrollTop = viewport.scrollHeight / 2;
      });
      await page.waitForFunction(first => !document.querySelector(`[data-filename="${first}"]`), first);
      assert.ok(await page.locator(".funcode-gallery-card").count() <= 36);
      const anchor = await page.evaluate(() => {
        const viewport = document.querySelector(".funcode-gallery-viewport");
        return [...document.querySelectorAll(".funcode-gallery-card")]
          .find(item => item.offsetTop <= viewport.scrollTop && item.offsetTop + item.offsetHeight + 15 > viewport.scrollTop).dataset.filename;
      });
      const numbers = page.locator('input[type="number"]');
      await numbers.nth(0).fill("600");
      await numbers.nth(1).fill("200");
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page.waitForFunction(anchor => {
        const viewport = document.querySelector(".funcode-gallery-viewport");
        const card = document.querySelector(`[data-filename="${anchor}"]`);
        return card && card.offsetTop <= viewport.scrollTop && card.offsetTop + card.offsetHeight + 15 > viewport.scrollTop;
      }, anchor);
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.waitForFunction(anchor => !!document.querySelector(`[data-filename="${anchor}"]`), anchor);
      await page.getByPlaceholder("Filter").fill("image-00000");
      await page.waitForFunction(() => document.querySelectorAll(".funcode-gallery-card").length === 1);
      assert.equal(await page.locator(".funcode-gallery-card img").evaluate(img => img.style.width), "600px");
      assert.equal(await page.locator(".funcode-gallery-viewport").evaluate(element => element.scrollTop), 0);
      if (process.env.GALLERY_SCREENSHOT) await page.screenshot({ path: process.env.GALLERY_SCREENSHOT });
      await page.locator(".funcode-gallery-card img").click();
      assert.equal(await page.evaluate(() => window.fixture.widget.value), "image-00000.png");
      assert.equal(await page.locator(".funcode-gallery-viewport").count(), 0);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  });

  await t.test("rename/delete/undo use delegated buttons and sync live nodes", async () => {
    const ui = await fixture(browser, 2);
    const { page } = ui;
    try {
      const card = page.locator('[data-filename="image-00000.png"]');
      await card.hover();
      page.once("dialog", dialog => dialog.accept("renamed"));
      await card.getByRole("button", { name: "Rename: image-00000.png", exact: true }).click();
      await page.waitForFunction(() => window.fixture.widget.value === "renamed.png");
      assert.equal(await page.evaluate(() => window.fixture.otherWidget.value), "renamed.png");
      const renamed = page.locator('[data-filename="renamed.png"]');
      await renamed.hover();
      page.once("dialog", dialog => dialog.accept());
      await renamed.getByRole("button", { name: "Delete: renamed.png", exact: true }).click();
      await page.waitForFunction(() => window.fixture.widget.value === "");
      await page.getByRole("button", { name: "Undo Delete", exact: true }).click();
      await page.waitForFunction(() => !!document.querySelector('[data-filename="renamed.png"]'));
      assert.equal(ui.state.operations, 3);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".funcode-gallery-viewport").count(), 0);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  });
});
