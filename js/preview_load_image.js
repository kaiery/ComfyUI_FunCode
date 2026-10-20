import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { VirtualImageGrid } from "./preview_image_grid.js";

app.registerExtension({
    name: "FunCode.LoadImageFunCodeNode",
    async nodeCreated(node) {
        if (node.comfyClass !== "LoadImageFunCodeNode") return;

        // 获取图片选择器小部件
        const imageWidget = node.widgets.find(w => w.name === "image");
        if (!imageWidget) return;

        // 添加打开预览面板按钮
        const btn = node.addWidget("button", "🖼️ Open Gallery", null, () => {
            showGallery(imageWidget, node);
        });
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
    }
});

function showGallery(widget, node) {
    // 遮罩层
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0.85)",
        zIndex: "10000",
        display: "flex",
        flexDirection: "column",
        padding: "20px",
        boxSizing: "border-box",
        fontFamily: "sans-serif"
    });

    // 头部区域
    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
        marginBottom: "20px",
        color: "#fff"
    });

    const title = document.createElement("h2");
    title.textContent = "Image Gallery";
    title.style.margin = "0";

    // 预览尺寸持久化（仅弹窗内配置）
    const storageKeyWidth = "FunCode.LoadImagePreviewNode.previewWidth";
    const storageKeyHeight = "FunCode.LoadImagePreviewNode.previewHeight";
    const defaultWidth = 280;
    const defaultHeight = 280;
    const minSize = 64;
    const maxSize = 1024;

    const normalizeSize = (value, fallback) => {
        if (value === null || value === "") return fallback;
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(maxSize, Math.max(minSize, Math.round(n)));
    };

    // 从本地存储读取上次设置，找不到则使用默认值
    let previewWidth = normalizeSize(localStorage.getItem(storageKeyWidth), defaultWidth);
    let previewHeight = normalizeSize(localStorage.getItem(storageKeyHeight), defaultHeight);
    const getCurrentRatio = () => {
        const w = Number(previewWidth);
        const h = Number(previewHeight);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
        return w / h;
    };

    // 预览尺寸控制区
    const controls = document.createElement("div");
    Object.assign(controls.style, {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px"
    });

    const widthLabel = document.createElement("span");
    widthLabel.textContent = "W";
    Object.assign(widthLabel.style, {
        color: "#fff",
        fontSize: "12px"
    });

    // 宽度滑块与精确输入
    const widthRange = document.createElement("input");
    widthRange.type = "range";
    widthRange.min = String(minSize);
    widthRange.max = String(maxSize);
    widthRange.value = String(previewWidth);
    Object.assign(widthRange.style, {
        width: "120px"
    });

    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.min = String(minSize);
    widthInput.max = String(maxSize);
    widthInput.value = String(previewWidth);
    Object.assign(widthInput.style, {
        width: "80px",
        padding: "6px 8px",
        borderRadius: "4px",
        border: "1px solid #555",
        backgroundColor: "#222",
        color: "#fff"
    });

    const heightLabel = document.createElement("span");
    heightLabel.textContent = "H";
    Object.assign(heightLabel.style, {
        color: "#fff",
        fontSize: "12px"
    });

    // 高度滑块与精确输入
    const heightRange = document.createElement("input");
    heightRange.type = "range";
    heightRange.min = String(minSize);
    heightRange.max = String(maxSize);
    heightRange.value = String(previewHeight);
    Object.assign(heightRange.style, {
        width: "120px"
    });

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.min = String(minSize);
    heightInput.max = String(maxSize);
    heightInput.value = String(previewHeight);
    Object.assign(heightInput.style, {
        width: "80px",
        padding: "6px 8px",
        borderRadius: "4px",
        border: "1px solid #555",
        backgroundColor: "#222",
        color: "#fff"
    });

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    Object.assign(applyBtn.style, {
        padding: "6px 12px",
        cursor: "pointer",
        backgroundColor: "#4CAF50",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        fontSize: "13px"
    });

    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "Size";
    Object.assign(sizeLabel.style, {
        color: "#fff",
        fontSize: "12px"
    });

    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = String(minSize);
    sizeRange.max = String(maxSize);
    sizeRange.value = String(previewWidth);
    Object.assign(sizeRange.style, {
        width: "140px"
    });

    const sortSelect = document.createElement("select");
    Object.assign(sortSelect.style, {
        padding: "6px 8px",
        borderRadius: "4px",
        border: "1px solid #555",
        backgroundColor: "#222",
        color: "#fff",
        fontSize: "13px"
    });
    const sortOptions = [
        { value: "mtime_desc", label: "Sort: Modified (newest first)" },
        { value: "default", label: "Sort: Filename (original)" },
        { value: "ascii_asc", label: "Sort: ASCII A→Z" },
        { value: "ascii_desc", label: "Sort: ASCII Z→A" },
        { value: "mtime_asc", label: "Sort: Modified (oldest first)" },
    ];
    sortOptions.forEach(o => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sortSelect.appendChild(opt);
    });
    sortSelect.value = "mtime_desc";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.title = "Reload input images and modification times";
    Object.assign(refreshBtn.style, {
        padding: "6px 12px",
        cursor: "pointer",
        backgroundColor: "#444",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        fontSize: "13px"
    });

    const undoBtn = document.createElement("button");
    undoBtn.textContent = "Undo Delete";
    undoBtn.hidden = true;
    undoBtn.style.cssText = refreshBtn.style.cssText;

    const filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.placeholder = "Filter";
    Object.assign(filterInput.style, {
        width: "140px",
        padding: "6px 8px",
        borderRadius: "4px",
        border: "1px solid #555",
        backgroundColor: "#222",
        color: "#fff"
    });

    controls.appendChild(widthLabel);
    controls.appendChild(widthRange);
    controls.appendChild(widthInput);
    controls.appendChild(heightLabel);
    controls.appendChild(heightRange);
    controls.appendChild(heightInput);
    controls.appendChild(applyBtn);
    controls.appendChild(sizeLabel);
    controls.appendChild(sizeRange);
    controls.appendChild(sortSelect);
    controls.appendChild(filterInput);
    controls.appendChild(refreshBtn);
    controls.appendChild(undoBtn);

    // 关闭按钮
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close (Esc)";
    Object.assign(closeBtn.style, {
        padding: "8px 16px",
        cursor: "pointer",
        backgroundColor: "#444",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        fontSize: "14px"
    });

    header.appendChild(title);
    header.appendChild(controls);
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    Object.assign(status.style, {
        color: "#ddd",
        fontSize: "13px",
        marginBottom: "10px",
        display: "none"
    });
    overlay.appendChild(status);
    const showStatus = (message) => {
        status.textContent = message;
        status.style.display = message ? "block" : "none";
    };

    // 图片网格容器
    const container = document.createElement("div");
    container.className = "funcode-gallery-viewport";

    // 预览列表与支持的格式
    const images = widget.options.values || [];
    let originalImages = images.slice();
    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'];

    let sortMode = "mtime_desc";
    let filterText = "";
    let mtimeCache = Object.create(null);
    let imageVersion = Date.now();
    let refreshVersion = 0;
    let closed = false;
    let operationPending = false;
    const deletedImages = [];
    const requestController = new AbortController();

    // 通过 /view 请求缩略图尺寸
    const buildImageUrl = (filename, width, height) => {
        const sizeParams = width && height ? `&width=${encodeURIComponent(width)}&height=${encodeURIComponent(height)}` : "";
        return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input${sizeParams}&v=${encodeURIComponent(imageVersion)}`);
    };

    // 虚拟网格按需创建卡片；滚动时复用仍然可见的卡片。
    const grid = new VirtualImageGrid(container, {
        getState: () => ({
            width: previewWidth, height: previewHeight, selected: widget.value,
            busy: operationPending || refreshBtn.disabled
        }),
        getImageUrl: buildImageUrl,
        onSelect: (filename) => {
            widget.value = filename;
            if (widget.callback) widget.callback(filename);
            node.setDirtyCanvas(true, true);
            cleanup();
        },
        onAction: (action, filename) => { runFileAction(action, filename); }
    });
    overlay.appendChild(container);

    // Resize only mounted cards and preserve the first visible image.
    const updatePreviewSize = (width, height) => {
        grid.resize();
        previewWidth = normalizeSize(width, defaultWidth);
        previewHeight = normalizeSize(height, defaultHeight);
        widthInput.value = String(previewWidth);
        heightInput.value = String(previewHeight);
        widthRange.value = String(previewWidth);
        heightRange.value = String(previewHeight);
        sizeRange.value = String(previewWidth);
        localStorage.setItem(storageKeyWidth, String(previewWidth));
        localStorage.setItem(storageKeyHeight, String(previewHeight));
    };

    const applySize = () => {
        updatePreviewSize(widthInput.value, heightInput.value);
    };

    applyBtn.onclick = applySize;
    widthRange.addEventListener("input", (e) => {
        const value = e.target.value;
        widthInput.value = value;
        updatePreviewSize(value, heightInput.value);
    });
    heightRange.addEventListener("input", (e) => {
        const value = e.target.value;
        heightInput.value = value;
        updatePreviewSize(widthInput.value, value);
    });
    widthInput.addEventListener("input", (e) => {
        widthRange.value = e.target.value;
    });
    heightInput.addEventListener("input", (e) => {
        heightRange.value = e.target.value;
    });
    widthInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applySize();
    });
    heightInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applySize();
    });

    sizeRange.addEventListener("input", (e) => {
        const ratio = getCurrentRatio();
        const w = normalizeSize(e.target.value, defaultWidth);
        const h = normalizeSize(Math.round(w / (ratio || 1)), defaultHeight);
        updatePreviewSize(w, h);
    });

    const fetchMtimes = async (filenames) => {
        const res = await api.fetchApi("/funcode/input_files_mtime", {
            method: "POST",
            cache: "no-store",
            signal: requestController.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filenames })
        });
        if (!res.ok) throw new Error(`Modification times request failed (${res.status})`);
        const data = await res.json();
        const mtimes = data?.mtimes;
        if (!mtimes || typeof mtimes !== "object" || Array.isArray(mtimes)) {
            throw new Error("Invalid modification times response");
        }
        const cache = Object.create(null);
        Object.keys(mtimes).forEach(k => {
            const v = mtimes[k];
            if (typeof v === "number" && Number.isFinite(v)) cache[k] = v;
        });
        return cache;
    };

    const getFiltered = () => {
        const q = (filterText || "").trim().toLowerCase();
        if (!q) return originalImages.slice();
        return originalImages.filter(n => String(n).toLowerCase().includes(q));
    };

    const sortFiles = (list) => {
        if (sortMode === "ascii_asc") {
            return list.sort((a, b) => String(a).localeCompare(String(b)));
        }
        if (sortMode === "ascii_desc") {
            return list.sort((a, b) => String(b).localeCompare(String(a)));
        }
        if (sortMode === "mtime_asc") {
            return list.sort((a, b) => (mtimeCache[a] || 0) - (mtimeCache[b] || 0));
        }
        if (sortMode === "mtime_desc") {
            return list.sort((a, b) => (mtimeCache[b] || 0) - (mtimeCache[a] || 0));
        }
        return list;
    };

    const refreshGallery = (options) => {
        if (closed) return;
        const list = sortFiles(getFiltered()).filter(filename =>
            supportedExtensions.some(ext => filename.toLowerCase().endsWith(ext)));
        grid.setFiles(list, options);
    };

    const setBusy = (busy) => {
        refreshBtn.disabled = busy;
        undoBtn.disabled = busy;
        grid.setBusy(busy);
    };

    // 同步当前图中引用同一个 input 文件的加载图片节点。
    const syncImageWidgets = (oldName, newName) => {
        const nodes = new Set([node, ...(app.graph?._nodes || [])]);
        for (const current of nodes) {
            if (!["LoadImageFunCodeNode", "LoadImage"].includes(current.comfyClass)) continue;
            const image = current.widgets?.find(w => w.name === "image");
            if (!image) continue;
            if (Array.isArray(image.options?.values)) {
                const values = image.options.values.filter(name => name !== oldName);
                if (newName && !values.includes(newName)) values.push(newName);
                image.options.values = values.sort();
            }
            if (oldName && image.value === oldName) {
                image.value = newName || "";
                if (newName && image.callback) {
                    try { image.callback(newName); }
                    catch (error) { console.warn("FunCode gallery: image preview callback failed", error); }
                } else if (!newName) {
                    current.imgs = [];
                    current.imageIndex = null;
                }
            }
            current.setDirtyCanvas?.(true, true);
        }
    };

    const updateUndoButton = () => {
        undoBtn.hidden = deletedImages.length === 0;
        undoBtn.title = deletedImages.length ? `Restore: ${deletedImages[deletedImages.length - 1].filename}` : "";
    };

    const runFileAction = async (action, filename) => {
        if (closed || operationPending || refreshBtn.disabled) return;
        let payload;
        if (action === "rename") {
            const dot = filename.lastIndexOf(".");
            const stem = window.prompt(`Rename image (keep ${filename.slice(dot)}):`, filename.slice(0, dot));
            if (stem === null) return;
            if (!stem.trim()) { showStatus("Please enter a filename."); return; }
            const newName = stem.trim() + filename.slice(dot);
            if (newName === filename) return;
            payload = { filename, new_name: newName };
        } else if (action === "delete") {
            if (!window.confirm(`Move "${filename}" to recoverable trash?\nSaved workflows referencing this file will need another image.`)) return;
            payload = { filename };
        } else if (action === "restore" && deletedImages.length) {
            payload = { token: deletedImages[deletedImages.length - 1].token };
        } else {
            return;
        }

        operationPending = true;
        setBusy(true);
        showStatus("Updating image file…");
        try {
            // Do not abort a mutation on close: the server may already have committed it.
            const res = await api.fetchApi(`/funcode/input_image/${action}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `File operation failed (${res.status})`);
            if (typeof data?.filename !== "string" || (action === "delete" && typeof data.token !== "string")) {
                throw new Error("Invalid file operation response. Click Refresh to reload the image list.");
            }
            let message;
            if (action === "rename") {
                originalImages = originalImages.map(name => name === filename ? data.filename : name).sort();
                mtimeCache[data.filename] = data.mtime ?? mtimeCache[filename] ?? 0;
                delete mtimeCache[filename];
                syncImageWidgets(filename, data.filename);
                message = `Renamed to "${data.filename}". Saved workflows using the old name must be updated.`;
            } else if (action === "delete") {
                originalImages = originalImages.filter(name => name !== filename);
                delete mtimeCache[filename];
                deletedImages.push({ filename, token: data.token });
                syncImageWidgets(filename, null);
                message = `Moved "${filename}" to input/.funcode-trash. Use Undo Delete to restore. Select another image if needed.`;
            } else {
                deletedImages.pop();
                originalImages = [...new Set([...originalImages, data.filename])].sort();
                mtimeCache[data.filename] = data.mtime ?? 0;
                syncImageWidgets(null, data.filename);
                message = `Restored "${data.filename}".`;
            }
            if (!closed) {
                widget.options.values = originalImages.slice();
                updateUndoButton();
                refreshGallery({ renamedFrom: action === "rename" ? filename : null, renamedTo: data.filename });
                showStatus(message);
            }
        } catch (error) {
            console.error("FunCode gallery: file operation failed", error);
            if (!closed) showStatus(error.message || "File operation failed. Click Refresh to retry.");
        } finally {
            operationPending = false;
            if (!closed) setBusy(false);
        }
    };

    undoBtn.onclick = () => runFileAction("restore");

    // 重新读取节点的 INPUT_TYPES，获取 input 目录当前的图片列表。
    const reloadImages = async () => {
        if (closed || refreshBtn.disabled) return;
        setBusy(true);
        refreshBtn.textContent = "Refreshing…";
        showStatus("Loading input images…");
        try {
            const res = await api.fetchApi("/object_info/LoadImageFunCodeNode", {
                cache: "no-store",
                signal: requestController.signal
            });
            if (!res.ok) throw new Error(`Image list request failed (${res.status})`);
            const data = await res.json();
            if (closed) return;
            const filenames = data?.LoadImageFunCodeNode?.input?.required?.image?.[0];
            if (!Array.isArray(filenames) || !filenames.every(name => typeof name === "string")) {
                throw new Error("Invalid image list response");
            }

            let mtimes = Object.create(null);
            let warning = "";
            if (filenames.length) {
                try {
                    mtimes = await fetchMtimes(filenames);
                } catch (error) {
                    if (requestController.signal.aborted) return;
                    console.warn("FunCode gallery: failed to load modification times", error);
                    warning = "Images refreshed, but modification times could not be loaded. Click Refresh to retry.";
                }
            }
            if (closed) return;
            originalImages = filenames.slice();
            widget.options.values = filenames.slice();
            mtimeCache = mtimes;
            imageVersion = `${Date.now()}-${++refreshVersion}`;
            refreshGallery();
            showStatus(warning || (filenames.length ? "" : "No images in the input directory."));
        } catch (error) {
            if (closed || requestController.signal.aborted) return;
            console.error("FunCode gallery: failed to refresh images", error);
            showStatus("Could not refresh images. Check the ComfyUI connection and click Refresh to retry.");
        } finally {
            if (!closed) {
                setBusy(false);
                refreshBtn.textContent = "Refresh";
            }
        }
    };

    refreshBtn.onclick = reloadImages;

    sortSelect.addEventListener("change", (e) => {
        sortMode = e.target.value || "mtime_desc";
        refreshGallery({ preservePosition: false });
    });

    let filterTimer = null;
    filterInput.addEventListener("input", (e) => {
        filterText = e.target.value || "";
        if (filterTimer) clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
            refreshGallery({ preservePosition: false });
        }, 120);
    });

    // 清理事件、请求、动画帧和尺寸观察器。
    const cleanup = () => {
        closed = true;
        requestController.abort();
        if (filterTimer) clearTimeout(filterTimer);
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        document.removeEventListener("keydown", escListener);
        grid.dispose();
    };

    closeBtn.onclick = cleanup;

    const escListener = (e) => {
        if (e.key === "Escape") {
            cleanup();
        }
    };
    document.addEventListener("keydown", escListener);

    updatePreviewSize(previewWidth, previewHeight);

    refreshGallery();

    document.body.appendChild(overlay);
    reloadImages();
    requestAnimationFrame(() => {
        if (document.body.contains(overlay)) {
            filterInput.focus({ preventScroll: true });
        }
    });
}
