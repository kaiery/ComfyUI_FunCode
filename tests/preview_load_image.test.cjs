const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.src = "";
    this.scrollTop = 0;
    this.clientWidth = 1200;
    this.clientHeight = 600;
    this.className = "";
    this.classList = {
      contains: name => this.className.split(" ").includes(name),
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
    };
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, next) {
    child.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
  remove() { this.parent?.removeChild(this); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  closest(selector) {
    const matches = selector.startsWith(".") ? this.classList.contains(selector.slice(1))
      : selector === "button[data-action]" && this.tagName === "button" && this.dataset.action;
    return matches ? this : this.parent?.closest(selector) || null;
  }
  contains(child) { return this.children.includes(child) || this.children.some(item => item.contains(child)); }
  set innerHTML(value) { this.children = []; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  focus() {}
  emit(name, value) {
    this.value = value;
    return this.listeners[name]({ target: this });
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function openGallery(options = {}) {
  const body = new Element("body");
  const document = new Element("document");
  document.body = body;
  document.createElement = tag => new Element(tag);
  const requests = [];
  const server = {
    filenames: ["a.png", "z.png"],
    directories: [],
    mtimes: { "a.png": 10, "z.png": 20 },
    listStatus: 200,
    mtimeStatus: 200,
    gate: null,
    actionStatus: 200,
    ...options,
  };
  const widget = { name: "image", value: "a.png", options: { values: options.initialFilenames || ["stale.png"] } };
  const otherWidget = { name: "image", value: "a.png", options: { values: ["a.png", "z.png"] } };
  const otherNode = { comfyClass: "LoadImage", widgets: [otherWidget], setDirtyCanvas() {} };
  const dialogs = { prompt: null, confirm: true };
  const observers = [];
  let open;
  let extension;
  const node = {
    comfyClass: "LoadImageFunCodeNode",
    widgets: [widget],
    addWidget(type, label, value, callback) { open = callback; },
    setDirtyCanvas() {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../js/preview_load_image.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({
    app: { graph: { _nodes: [node, otherNode] }, registerExtension(value) { extension = value; } },
    api: {
      apiURL: url => url,
      async fetchApi(url, options) {
        requests.push({ url, options });
        if (server.gate) await server.gate;
        const isList = url.startsWith("/funcode/input_images?");
        if (isList && server.mtimeGate) await server.mtimeGate;
        if (url.startsWith("/funcode/input_image/")) {
          const payload = JSON.parse(options.body);
          let data;
          if (server.actionStatus !== 200) {
            data = { error: "A file with that name already exists." };
          } else if (url.endsWith("/rename")) {
            const parent = payload.filename.slice(0, Math.max(0, payload.filename.lastIndexOf("/")));
            const renamed = parent ? `${parent}/${payload.new_name}` : payload.new_name;
            server.filenames = server.filenames.map(name => name === payload.filename ? renamed : name);
            server.mtimes[renamed] = server.mtimes[payload.filename];
            data = { filename: renamed, mtime: server.mtimes[renamed] };
          } else if (url.endsWith("/delete")) {
            server.filenames = server.filenames.filter(name => name !== payload.filename);
            server.deleted = payload.filename;
            data = { filename: payload.filename, token: "test-token" };
          } else {
            server.filenames.push(server.deleted);
            data = { filename: server.deleted, mtime: server.mtimes[server.deleted] };
          }
          return { ok: server.actionStatus === 200, status: server.actionStatus, async json() { return data; } };
        }
        assert.ok(isList, `Unexpected request: ${url}`);
        const directory = new URL(url, "http://localhost").searchParams.get("directory");
        const parentOf = name => name.slice(0, Math.max(0, name.lastIndexOf("/")));
        const status = directory && !server.directories.includes(directory) ? 404 : server.listStatus;
        return {
          ok: status === 200,
          status,
          async json() {
            return {
              directory,
              files: server.filenames.filter(name => parentOf(name) === directory),
              directories: server.directories.filter(name => parentOf(name) === directory),
              mtimes: server.mtimeStatus === 200 ? { ...server.mtimes } : null,
            };
          },
        };
      },
    },
    document,
    localStorage: { getItem() { return options.storedSize === undefined ? "280" : options.storedSize; }, setItem() {} },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    AbortController,
    window: { prompt: () => dialogs.prompt, confirm: () => dialogs.confirm },
    requestAnimationFrame: callback => setImmediate(callback),
    cancelAnimationFrame: clearImmediate,
    setTimeout,
    clearTimeout,
    console: { warn() {}, error() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/preview_image_grid.js"), "utf8")
    .replace("export class VirtualImageGrid", "class VirtualImageGrid"), context);
  vm.runInContext(source, context);
  await extension.nodeCreated(node);
  open();
  const overlay = body.children[0];
  const header = overlay.children[0];
  const controls = header.children[1].children;
  const gallery = overlay.children[2];
  const content = gallery.children[1];
  const find = (tag, label) => controls.find(item => item.tagName === tag && (!label || item.textContent === label));
  await settle();
  return {
    server, requests, widget, document, body, gallery, content, dialogs, otherWidget, otherNode, observers,
    refresh: find("button", "Refresh"),
    undo: find("button", "Undo Delete"),
    up: header.children[3].children[0],
    breadcrumbs: header.children[3].children[1],
    sort: find("select"),
    filter: controls.find(item => item.placeholder === "Filter"),
    width: controls.find(item => item.type === "number"),
    height: controls.filter(item => item.type === "number")[1],
    size: controls.filter(item => item.type === "range")[2],
    apply: find("button", "Apply"),
    status: overlay.children[1],
    close: header.children[2],
    names: () => content.children.map(item => item.children[1].textContent),
    paths: () => content.children.map(item => item.dataset.filename),
    card: filename => content.children.find(item => item.dataset.filename === filename),
    async openDirectory(directory) {
      const card = content.children.find(item => item.dataset.directory === directory);
      content.listeners.click({ target: card.children[0] });
      await settle();
      await settle();
    },
    async action(action, filename) {
      const card = content.children.find(item => item.dataset.filename === filename);
      const target = card.children[2].children.find(button => button.dataset.action === action);
      let stopped = false;
      content.listeners.click({ target, stopPropagation() { stopped = true; } });
      await settle();
      await settle();
      assert.equal(stopped, true);
    },
  };
}

test("opening loads fresh input files and sorts newest modification first", async () => {
  const ui = await openGallery();
  assert.equal(ui.sort.value, "mtime_desc");
  assert.deepEqual(ui.names(), ["z.png", "a.png"]);
  assert.deepEqual(Array.from(ui.widget.options.values), ["a.png", "z.png"]);
  assert.equal(ui.widget.value, "a.png");
  assert.equal(ui.requests[0].url, "/funcode/input_images?directory=");
  assert.equal(ui.requests[0].options.cache, "no-store");
  assert.equal(ui.requests.length, 1);
  ui.close.onclick();
});

test("opening with cached filenames stays at the top when modification times reorder the list", async () => {
  const filenames = Array.from({ length: 1000 }, (_, index) => `image-${String(index).padStart(4, "0")}.png`);
  let release;
  const mtimeGate = new Promise(resolve => { release = resolve; });
  const ui = await openGallery({
    filenames, initialFilenames: filenames,
    mtimes: Object.fromEntries(filenames.map((name, index) => [name, index])), mtimeGate,
  });
  assert.equal(ui.gallery.scrollTop, 0);
  assert.equal(ui.names()[0], "image-0000.png");
  release();
  await settle();
  await settle();
  assert.equal(ui.gallery.scrollTop, 0);
  assert.equal(ui.names()[0], "image-0999.png");
  ui.close.onclick();
});

test("refresh detects added, deleted and overwritten files and renews thumbnail URLs", async () => {
  const ui = await openGallery();
  const oldUrl = ui.card("a.png").children[0].src;
  ui.server.filenames = ["a.png", "new.png"];
  ui.server.mtimes = { "a.png": 40, "new.png": 30 };
  const pending = ui.refresh.onclick();
  assert.equal(ui.refresh.disabled, true);
  await ui.refresh.onclick(); // Repeated clicks cannot launch another scan.
  await pending;
  await settle();
  assert.deepEqual(ui.names(), ["a.png", "new.png"]);
  assert.notEqual(ui.card("a.png").children[0].src, oldUrl);
  assert.deepEqual(Array.from(ui.widget.options.values), ["a.png", "new.png"]);
  assert.equal(ui.widget.value, "a.png");
  assert.equal(ui.refresh.disabled, false);
  assert.equal(ui.requests.length, 2);
  ui.close.onclick();
});

test("refresh preserves filter, chosen sorting and preview dimensions", async () => {
  const ui = await openGallery();
  ui.sort.emit("change", "mtime_asc");
  ui.filter.emit("input", "a");
  ui.width.value = "360";
  ui.apply.onclick();
  ui.server.filenames = ["a.png", "added.png", "z.png"];
  ui.server.mtimes = { "a.png": 50, "added.png": 30, "z.png": 60 };
  await ui.refresh.onclick();
  await settle();
  assert.deepEqual(ui.names(), ["added.png", "a.png"]);
  assert.equal(ui.sort.value, "mtime_asc");
  assert.equal(ui.filter.value, "a");
  assert.equal(ui.content.children[0].children[0].style.width, "360px");
  assert.equal(ui.widget.options.values.length, 3);
  ui.close.onclick();
});

test("failed list requests keep existing cards and allow retry", async () => {
  const ui = await openGallery();
  ui.server.listStatus = 500;
  await ui.refresh.onclick();
  await settle();
  assert.deepEqual(ui.names(), ["z.png", "a.png"]);
  assert.match(ui.status.textContent, /Could not refresh/);
  assert.equal(ui.refresh.disabled, false);
  ui.server.listStatus = 200;
  ui.server.filenames = [];
  await ui.refresh.onclick();
  await settle();
  assert.deepEqual(ui.names(), []);
  assert.equal(ui.widget.options.values.length, 0);
  assert.match(ui.status.textContent, /No images/);
  ui.close.onclick();
});

test("mtime failures still display fresh files with a visible warning", async () => {
  const ui = await openGallery();
  ui.server.mtimeStatus = 503;
  ui.server.filenames = ["new.png"];
  await ui.refresh.onclick();
  await settle();
  assert.deepEqual(ui.names(), ["new.png"]);
  assert.match(ui.status.textContent, /modification times could not be loaded/);
  ui.server.mtimeStatus = 200;
  await ui.refresh.onclick();
  assert.equal(ui.status.textContent, "");
  ui.close.onclick();
});

test("closing during refresh aborts requests and prevents late widget updates", async () => {
  const ui = await openGallery();
  let release;
  ui.server.gate = new Promise(resolve => { release = resolve; });
  ui.server.filenames = ["late.png"];
  const pending = ui.refresh.onclick();
  const signal = ui.requests[ui.requests.length - 1].options.signal;
  ui.close.onclick();
  assert.equal(signal.aborted, true);
  release();
  await pending;
  assert.equal(ui.body.children.length, 0);
  assert.deepEqual(Array.from(ui.widget.options.values), ["a.png", "z.png"]);
});

test("10,000 images mount only viewport rows and retain overlapping cards", async () => {
  const filenames = Array.from({ length: 10000 }, (_, index) => `image-${String(index).padStart(5, "0")}.png`);
  const ui = await openGallery({ filenames, mtimes: {} });
  assert.ok(ui.content.children.length <= 18);
  const retained = ui.content.children[3];
  const oldUrl = retained.children[0].src;
  const requestCount = ui.requests.length;
  ui.gallery.scrollTop = 50;
  for (let i = 0; i < 50; i++) ui.gallery.listeners.scroll();
  await settle();
  assert.equal(ui.card(retained.dataset.filename), retained);
  assert.equal(retained.children[0].src, oldUrl);
  assert.equal(ui.requests.length, requestCount);

  ui.gallery.scrollTop = 700000;
  ui.gallery.listeners.scroll();
  await settle();
  assert.ok(ui.content.children.length <= 21);
  assert.ok(ui.names().every(name => Number(name.slice(6, 11)) > 6000));
  assert.ok(!ui.names().includes("image-00000.png"));
  ui.gallery.scrollTop = 1e9;
  ui.gallery.listeners.scroll();
  await settle();
  assert.ok(ui.names().includes("image-09999.png"));
  ui.close.onclick();
  assert.equal(ui.observers[0].disconnected, true);
});

test("resizing preserves the first visible image and filtering resets the scroll range", async () => {
  const filenames = Array.from({ length: 1000 }, (_, index) => `image-${String(index).padStart(4, "0")}.png`);
  const ui = await openGallery({ filenames, mtimes: {} });
  ui.gallery.scrollTop = 345 * 100;
  ui.gallery.listeners.scroll();
  await settle();
  const anchor = "image-0300.png";
  ui.width.value = "600";
  ui.apply.onclick();
  await settle();
  assert.equal(Number.parseFloat(ui.card(anchor).style.top), ui.gallery.scrollTop);
  assert.equal(ui.card(anchor).children[0].style.width, "600px");
  ui.gallery.clientWidth = 1500;
  ui.observers[0].callback();
  await settle();
  assert.equal(Number.parseFloat(ui.card(anchor).style.top), ui.gallery.scrollTop);
  ui.filter.emit("input", "image-0999");
  await new Promise(resolve => setTimeout(resolve, 140));
  await settle();
  assert.deepEqual(ui.names(), ["image-0999.png"]);
  assert.equal(ui.gallery.scrollTop, 0);
  ui.close.onclick();
});

test("missing stored dimensions use 280px and the Size slider keeps the aspect ratio", async () => {
  const ui = await openGallery({ storedSize: null });
  assert.equal(ui.width.value, "280");
  ui.width.value = "400";
  ui.height.value = "200";
  ui.apply.onclick();
  ui.size.emit("input", "600");
  await settle();
  assert.equal(ui.width.value, "600");
  assert.equal(ui.height.value, "300");
  ui.close.onclick();
});

test("rename preserves extension and updates live image nodes without closing the gallery", async () => {
  const ui = await openGallery();
  const callbacks = [];
  ui.widget.callback = name => callbacks.push(name);
  ui.otherWidget.callback = name => callbacks.push(name);
  ui.dialogs.prompt = "renamed";
  await ui.action("rename", "a.png");
  assert.equal(ui.widget.value, "renamed.png");
  assert.equal(ui.otherWidget.value, "renamed.png");
  assert.deepEqual(callbacks, ["renamed.png", "renamed.png"]);
  assert.ok(ui.card("renamed.png"));
  assert.equal(ui.body.children.length, 1);
  assert.equal(ui.undo.hidden, true);
  assert.equal(ui.requests.length, 2); // No directory reload after local mutation.
  ui.close.onclick();
});

test("delete clears selected image references and Undo Delete restores the file option", async () => {
  const ui = await openGallery();
  await ui.action("delete", "a.png");
  assert.equal(ui.widget.value, "");
  assert.equal(ui.otherWidget.value, "");
  assert.equal(ui.otherNode.imgs.length, 0);
  assert.deepEqual(ui.names(), ["z.png"]);
  assert.equal(ui.undo.hidden, false);
  await ui.undo.onclick();
  await settle();
  assert.deepEqual(ui.names(), ["z.png", "a.png"]);
  assert.equal(ui.undo.hidden, true);
  assert.equal(ui.widget.value, ""); // Restore does not silently select a replacement.
  assert.ok(ui.otherWidget.options.values.includes("a.png"));
  ui.close.onclick();
});

test("cancelled operations and conflicts leave files and selection unchanged", async () => {
  const ui = await openGallery();
  ui.dialogs.confirm = false;
  await ui.action("delete", "a.png");
  await ui.action("rename", "a.png"); // prompt returns null
  assert.equal(ui.requests.length, 1);
  ui.dialogs.prompt = "z";
  ui.server.actionStatus = 409;
  await ui.action("rename", "a.png");
  assert.equal(ui.widget.value, "a.png");
  assert.deepEqual(ui.names(), ["z.png", "a.png"]);
  assert.match(ui.status.textContent, /already exists/);
  assert.equal(ui.refresh.disabled, false);
  ui.close.onclick();
});

test("mutations finish syncing live nodes if the gallery is closed during the request", async () => {
  const ui = await openGallery();
  let release;
  ui.server.gate = new Promise(resolve => { release = resolve; });
  ui.dialogs.prompt = "after-close";
  const action = ui.action("rename", "a.png");
  ui.close.onclick();
  assert.equal(ui.requests[1].options.signal, undefined);
  release();
  await action;
  assert.equal(ui.widget.value, "after-close.png");
  assert.equal(ui.otherWidget.value, "after-close.png");
  assert.equal(ui.body.children.length, 0);
});

test("delegated card selection and Esc still close the modal", async () => {
  const ui = await openGallery();
  ui.content.listeners.click({ target: ui.card("z.png").children[0] });
  assert.equal(ui.widget.value, "z.png");
  assert.equal(ui.body.children.length, 0);
  const next = await openGallery();
  next.document.listeners.keydown({ key: "Escape" });
  assert.equal(next.body.children.length, 0);
});

test("folder cards are first, have no file actions and open nested paths without selecting an image", async () => {
  const ui = await openGallery({
    filenames: ["a.png", "z.png", "album/a.png", "album/子目录/a.png"],
    directories: ["album", "album/子目录", "empty"],
    mtimes: { "a.png": 10, "z.png": 20, "album/a.png": 30, "album/子目录/a.png": 40 },
  });
  assert.deepEqual(ui.paths(), ["album/", "empty/", "z.png", "a.png"]);
  assert.equal(ui.card("album/").children[0].tagName, "div");
  assert.equal(ui.card("album/").children[2].children.length, 0);
  ui.width.value = "360";
  ui.apply.onclick();
  ui.filter.emit("input", "album");
  await ui.openDirectory("album");
  assert.equal(ui.filter.value, "");
  assert.equal(ui.widget.value, "a.png");
  assert.equal(ui.body.children.length, 1);
  assert.deepEqual(ui.paths(), ["album/子目录/", "album/a.png"]);
  assert.ok(ui.widget.options.values.includes("a.png"));
  assert.ok(ui.widget.options.values.includes("album/a.png"));
  await ui.openDirectory("album/子目录");
  assert.deepEqual(ui.paths(), ["album/子目录/a.png"]);
  assert.equal(ui.card("album/子目录/a.png").children[0].style.width, "360px");
  const url = new URL(ui.card("album/子目录/a.png").children[0].src, "http://localhost");
  assert.equal(url.searchParams.get("filename"), "a.png");
  assert.equal(url.searchParams.get("subfolder"), "album/子目录");
  assert.equal(ui.gallery.scrollTop, 0);
  await ui.up.onclick();
  await settle();
  assert.ok(ui.card("album/a.png"));
  await ui.breadcrumbs.children[0].onclick();
  await settle();
  assert.ok(ui.card("album/"));
  assert.equal(ui.up.disabled, true);
  await ui.openDirectory("empty");
  assert.deepEqual(ui.paths(), []);
  assert.match(ui.status.textContent, /No images or folders/);
  ui.close.onclick();
});

test("nested rename/delete/undo affect full relative paths and restore into the original directory", async () => {
  const ui = await openGallery({ filenames: ["a.png", "album/a.png"], directories: ["album"] });
  await ui.openDirectory("album");
  ui.widget.value = "album/a.png";
  ui.dialogs.prompt = "renamed";
  await ui.action("rename", "album/a.png");
  assert.equal(ui.widget.value, "album/renamed.png");
  assert.equal(ui.otherWidget.value, "a.png");
  assert.ok(ui.card("album/renamed.png"));
  const request = JSON.parse(ui.requests[2].options.body);
  assert.equal(request.filename, "album/a.png");
  assert.equal(request.new_name, "renamed.png");
  await ui.action("delete", "album/renamed.png");
  assert.equal(ui.widget.value, "");
  await ui.up.onclick();
  await settle();
  await ui.undo.onclick();
  await settle();
  assert.deepEqual(ui.paths(), ["album/", "a.png"]);
  assert.ok(ui.widget.options.values.includes("album/renamed.png"));
  await ui.openDirectory("album");
  assert.ok(ui.card("album/renamed.png"));
  ui.content.listeners.click({ target: ui.card("album/renamed.png").children[0] });
  assert.equal(ui.widget.value, "album/renamed.png");
  assert.equal(ui.body.children.length, 0);
});

test("failed directory navigation keeps the previous directory and its cards", async () => {
  const ui = await openGallery({ directories: ["gone"] });
  ui.server.directories = [];
  await ui.openDirectory("gone");
  assert.deepEqual(ui.paths(), ["gone/", "z.png", "a.png"]);
  assert.equal(ui.up.disabled, true);
  assert.equal(ui.breadcrumbs.children.length, 1);
  assert.match(ui.status.textContent, /Could not refresh/);
  ui.close.onclick();
});

test("10,000 directories share virtual rendering without creating thumbnail images", async () => {
  const directories = Array.from({ length: 10000 }, (_, index) => `folder-${String(index).padStart(5, "0")}`);
  const ui = await openGallery({ filenames: [], directories });
  assert.ok(ui.content.children.length <= 18);
  assert.ok(ui.content.children.every(card => card.children[0].tagName === "div"));
  ui.gallery.scrollTop = 1e9;
  ui.gallery.listeners.scroll();
  await settle();
  assert.ok(ui.paths().includes("folder-09999/"));
  assert.ok(ui.content.children.length <= 21);
  ui.close.onclick();
});
