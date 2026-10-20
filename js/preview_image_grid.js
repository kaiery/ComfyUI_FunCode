// Only visible rows and a small buffer own DOM nodes and image requests.
export class VirtualImageGrid {
    constructor(viewport, { getState, getImageUrl, onSelect, onAction }) {
        this.viewport = viewport;
        this.getState = getState;
        this.getImageUrl = getImageUrl;
        this.files = [];
        this.cards = new Map();
        this.columns = 1;
        this.stride = getState().height + 65;
        this.frame = null;
        this.anchor = null;
        this.disposed = false;

        Object.assign(viewport.style, {
            flex: "1", minHeight: "0", position: "relative",
            overflow: "auto", overflowAnchor: "none", paddingRight: "10px"
        });
        const style = document.createElement("style");
        style.textContent = `
            .funcode-gallery-card { background: #222; }
            .funcode-gallery-card.is-selected { background: #2e3b2e; border-color: #4CAF50 !important; }
            .funcode-gallery-card:hover { background: #333; }
            .funcode-gallery-card:focus-visible { outline: 2px solid #9ecbff; outline-offset: -2px; }
            .funcode-gallery-actions { opacity: 0; pointer-events: none; transition: opacity .12s; }
            .funcode-gallery-card:hover .funcode-gallery-actions,
            .funcode-gallery-card:focus-within .funcode-gallery-actions { opacity: 1; pointer-events: auto; }
            @media (hover: none) { .funcode-gallery-actions { opacity: 1; pointer-events: auto; } }
        `;
        viewport.appendChild(style);
        this.content = document.createElement("div");
        this.content.className = "funcode-gallery-content";
        this.content.style.position = "relative";
        viewport.appendChild(this.content);

        this.onScroll = () => this.schedule();
        viewport.addEventListener("scroll", this.onScroll, { passive: true });
        this.resizeObserver = new ResizeObserver(() => this.schedule());
        this.resizeObserver.observe(viewport);
        this.content.addEventListener("click", (event) => {
            const item = event.target.closest(".funcode-gallery-card");
            if (!item || !this.content.contains(item)) return;
            const button = event.target.closest("button[data-action]");
            if (button) {
                event.stopPropagation();
                if (!button.disabled && !this.getState().busy) onAction(button.dataset.action, item.dataset.filename);
                return;
            }
            if (!this.getState().busy) onSelect(item.dataset.filename);
        });
        this.content.addEventListener("keydown", (event) => {
            if (event.target.classList.contains("funcode-gallery-card") && ["Enter", " "].includes(event.key)) {
                event.preventDefault();
                if (!this.getState().busy) onSelect(event.target.dataset.filename);
            }
        });
    }

    captureAnchor() {
        const index = Math.floor(this.viewport.scrollTop / this.stride) * this.columns;
        return { filename: this.files[index], index, offset: (this.viewport.scrollTop % this.stride) / this.stride };
    }

    setFiles(files, { preservePosition = true, renamedFrom, renamedTo } = {}) {
        // At the top, preserve offset zero rather than following the former first file
        // to its new position when cached filenames are reordered by modification time.
        if (preservePosition && this.viewport.scrollTop > 0) {
            this.anchor ||= this.captureAnchor();
            if (renamedFrom && this.anchor.filename === renamedFrom) this.anchor.filename = renamedTo;
        } else {
            this.anchor = null;
            this.viewport.scrollTop = 0;
        }
        this.files = files;
        this.schedule();
    }

    resize() {
        this.anchor ||= this.captureAnchor();
        this.schedule();
    }

    setBusy(busy) {
        for (const card of this.cards.values()) {
            card.buttons.forEach(button => { button.disabled = busy; });
        }
    }

    schedule() {
        if (this.disposed || this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.render();
        });
    }

    createCard(filename) {
        const item = document.createElement("div");
        item.className = "funcode-gallery-card";
        item.dataset.filename = filename;
        item.tabIndex = 0;
        item.setAttribute("role", "group");
        item.setAttribute("aria-label", filename);
        Object.assign(item.style, {
            position: "absolute", boxSizing: "border-box", cursor: "pointer",
            border: "2px solid transparent", borderRadius: "6px", padding: "10px",
            display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden"
        });
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = filename;
        Object.assign(img.style, {
            flexShrink: "0", objectFit: "contain", marginBottom: "8px", borderRadius: "4px"
        });
        img.onerror = () => {
            img.removeAttribute("src");
            img.alt = "Failed to load";
        };
        const label = document.createElement("div");
        label.textContent = filename;
        label.title = filename;
        Object.assign(label.style, {
            fontSize: "12px", height: "18px", lineHeight: "18px", flexShrink: "0",
            color: "#eee", width: "100%", textAlign: "center", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis"
        });
        const actions = document.createElement("div");
        actions.className = "funcode-gallery-actions";
        Object.assign(actions.style, {
            position: "absolute", top: "4px", right: "4px", display: "flex", gap: "4px"
        });
        for (const [action, text] of [["rename", "Rename"], ["delete", "Delete"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.action = action;
            button.textContent = text;
            button.title = `${text}: ${filename}`;
            button.setAttribute("aria-label", `${text}: ${filename}`);
            Object.assign(button.style, {
                padding: "4px 6px", borderRadius: "4px", border: "1px solid #666",
                background: action === "delete" ? "#752e2e" : "#333", color: "#fff",
                fontSize: "12px", cursor: "pointer"
            });
            actions.appendChild(button);
        }
        item.appendChild(img);
        item.appendChild(label);
        item.appendChild(actions);
        return { item, img, buttons: Array.from(actions.children) };
    }

    render() {
        if (this.disposed) return;
        const { width, height, selected, busy } = this.getState();
        const gap = 15;
        const availableWidth = Math.max(1, this.viewport.clientWidth - 10);
        const minWidth = Math.max(120, width + 24);
        const columns = Math.max(1, Math.floor((availableWidth + gap) / (minWidth + gap)));
        const cardWidth = Math.max(minWidth, (availableWidth - (columns - 1) * gap) / columns);
        const cardHeight = height + 50;
        const stride = cardHeight + gap;
        const anchor = this.anchor || (columns !== this.columns ? this.captureAnchor() : null);
        this.anchor = null;
        this.columns = columns;
        this.stride = stride;
        const rows = Math.ceil(this.files.length / columns);
        const totalHeight = Math.max(0, rows * stride - gap);
        this.content.style.height = `${totalHeight}px`;
        this.content.style.width = `${columns * (cardWidth + gap) - gap}px`;
        if (anchor) {
            const found = this.files.indexOf(anchor.filename);
            const index = found >= 0 ? found : Math.min(anchor.index, Math.max(0, this.files.length - 1));
            this.viewport.scrollTop = Math.floor(index / columns) * stride + anchor.offset * stride;
        }
        this.viewport.scrollTop = Math.max(0, Math.min(this.viewport.scrollTop, totalHeight - this.viewport.clientHeight));
        const startRow = Math.max(0, Math.floor(this.viewport.scrollTop / stride) - 2);
        const endRow = Math.min(rows, Math.ceil((this.viewport.scrollTop + this.viewport.clientHeight) / stride) + 2);
        const start = startRow * columns;
        const end = Math.min(this.files.length, endRow * columns);
        const needed = new Set(this.files.slice(start, end));
        for (const [filename, card] of this.cards) {
            if (!needed.has(filename)) {
                card.item.remove();
                this.cards.delete(filename);
            }
        }
        let next = this.content.firstElementChild;
        for (let index = start; index < end; index++) {
            const filename = this.files[index];
            let card = this.cards.get(filename);
            if (!card) {
                card = this.createCard(filename);
                this.cards.set(filename, card);
            }
            // Keep keyboard order aligned with visual order without remounting retained cards.
            if (card.item !== next) this.content.insertBefore(card.item, next);
            next = card.item.nextElementSibling;
            Object.assign(card.item.style, {
                left: `${(index % columns) * (cardWidth + gap)}px`,
                top: `${Math.floor(index / columns) * stride}px`,
                width: `${cardWidth}px`, height: `${cardHeight}px`
            });
            card.item.classList.toggle("is-selected", selected === filename);
            card.img.style.width = `${width}px`;
            card.img.style.height = `${height}px`;
            const url = this.getImageUrl(filename, width, height);
            if (card.img.dataset.src !== url) {
                card.img.alt = filename;
                card.img.dataset.src = url;
                card.img.src = url;
            }
            card.buttons.forEach(button => { button.disabled = busy; });
        }
    }

    dispose() {
        this.disposed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.viewport.removeEventListener("scroll", this.onScroll);
        this.cards.clear();
    }
}
