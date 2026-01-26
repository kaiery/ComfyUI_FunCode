import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

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
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(maxSize, Math.max(minSize, Math.round(n)));
    };

    // 从本地存储读取上次设置，找不到则使用默认值
    let previewWidth = normalizeSize(localStorage.getItem(storageKeyWidth), defaultWidth);
    let previewHeight = normalizeSize(localStorage.getItem(storageKeyHeight), defaultHeight);

    // 预览尺寸控制区
    const controls = document.createElement("div");
    Object.assign(controls.style, {
        display: "flex",
        alignItems: "center",
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

    controls.appendChild(widthLabel);
    controls.appendChild(widthRange);
    controls.appendChild(widthInput);
    controls.appendChild(heightLabel);
    controls.appendChild(heightRange);
    controls.appendChild(heightInput);
    controls.appendChild(applyBtn);

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

    // 图片网格容器
    const container = document.createElement("div");
    Object.assign(container.style, {
        flex: "1",
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(120, previewWidth + 20)}px, 1fr))`,
        gap: "15px",
        paddingRight: "10px"
    });

    // 预览列表与支持的格式
    const images = widget.options.values || [];
    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'];

    // 通过 /view 请求缩略图尺寸
    const buildImageUrl = (filename, width, height) => {
        const sizeParams = width && height ? `&width=${encodeURIComponent(width)}&height=${encodeURIComponent(height)}` : "";
        return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input${sizeParams}`);
    };

    // 交叉观察器用于懒加载
    const imageEntries = [];
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            if (!img.src) img.src = img.dataset.src || "";
            observer.unobserve(img);
        });
    }, { root: container, rootMargin: "200px" });

    let immediateLoadCount = 0;

    images.forEach(filename => {
        // 跳过非图片文件
        if (!supportedExtensions.some(ext => filename.toLowerCase().endsWith(ext))) {
            return;
        }

        // 单个图片卡片
        const item = document.createElement("div");
        Object.assign(item.style, {
            cursor: "pointer",
            backgroundColor: "#222",
            border: "2px solid transparent",
            borderRadius: "6px",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transition: "all 0.2s"
        });

        // 选中态高亮
        if (widget.value === filename) {
            item.style.borderColor = "#4CAF50";
            item.style.backgroundColor = "#2e3b2e";
        }

        item.onmouseenter = () => item.style.backgroundColor = "#333";
        item.onmouseleave = () => {
            if (widget.value === filename) item.style.backgroundColor = "#2e3b2e";
            else item.style.backgroundColor = "#222";
        };

        // 预览缩略图
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.dataset.src = buildImageUrl(filename, previewWidth, previewHeight);
        img.alt = filename;
        Object.assign(img.style, {
            width: `${previewWidth}px`,
            height: `${previewHeight}px`,
            objectFit: "contain",
            marginBottom: "8px",
            borderRadius: "4px"
        });

        // 失败时清空避免残影
        img.onerror = () => {
            img.src = "";
            img.alt = "Failed to load";
        };

        // 先加载一批缩略图，其余交由观察器加载
        if (immediateLoadCount < 12) {
            img.src = img.dataset.src || "";
            immediateLoadCount += 1;
        } else {
            observer.observe(img);
        }

        // 文件名标签
        const lbl = document.createElement("div");
        lbl.textContent = filename;
        lbl.title = filename;
        Object.assign(lbl.style, {
            fontSize: "12px",
            color: "#eee",
            width: "100%",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
        });

        item.appendChild(img);
        item.appendChild(lbl);

        // 选中图片并关闭弹窗
        item.onclick = () => {
            widget.value = filename;
            if (widget.callback) widget.callback(filename);

            node.setDirtyCanvas(true, true);

            cleanup();
        };

        container.appendChild(item);
        imageEntries.push({ img, filename });
    });

    overlay.appendChild(container);

    // 统一更新尺寸并同步到控件/存储
    // 统一更新尺寸并刷新已加载缩略图
    const updatePreviewSize = (width, height) => {
        previewWidth = normalizeSize(width, defaultWidth);
        previewHeight = normalizeSize(height, defaultHeight);
        container.style.gridTemplateColumns = `repeat(auto-fill, minmax(${Math.max(120, previewWidth + 20)}px, 1fr))`;
        imageEntries.forEach(({ img, filename }) => {
            img.style.width = `${previewWidth}px`;
            img.style.height = `${previewHeight}px`;
            img.dataset.src = buildImageUrl(filename, previewWidth, previewHeight);
            if (img.src) img.src = img.dataset.src || "";
        });
        widthInput.value = String(previewWidth);
        heightInput.value = String(previewHeight);
        widthRange.value = String(previewWidth);
        heightRange.value = String(previewHeight);
        localStorage.setItem(storageKeyWidth, String(previewWidth));
        localStorage.setItem(storageKeyHeight, String(previewHeight));
    };

    // Apply 按钮与输入联动
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

    // 清理事件与观察器
    const cleanup = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        document.removeEventListener("keydown", escListener);
        observer.disconnect();
    };

    closeBtn.onclick = cleanup;

    const escListener = (e) => {
        if (e.key === "Escape") {
            cleanup();
        }
    };
    document.addEventListener("keydown", escListener);

    updatePreviewSize(previewWidth, previewHeight);

    document.body.appendChild(overlay);
}
