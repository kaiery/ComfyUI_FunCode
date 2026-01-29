import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { fabric } from "./lib/fabric-slim.min.js";
import { queueManager } from "./queue_shortcut.js";

const instances = new Map();
let eventsReady = false;

const initEvents = () => {
    if (eventsReady) return;
    api.addEventListener("funcode_canvas_update", async (event) => {
        const data = event.detail;
        if (!data || !data.node_id) return;
        const instance = instances.get(String(data.node_id));
        if (!instance) return;
        await instance.ensureReady();
        if (data.canvas_data) {
            await instance.maybeApplyCanvasData(data.canvas_data);
        }
        await instance.exportToServer();
    });
    eventsReady = true;
};

class FunCanvas {
    constructor(node) {
        this.node = node;
        this.canvas = null;
        this.fabric = null;
        this.canvasWidth = 512;
        this.canvasHeight = 512;
        this.displayWidth = 512;
        this.displayHeight = 512;
        this.controlHeight = 120; // Increased estimate for 3-row layout
        this.container = document.createElement("div");
        this.container.style.position = "relative";
        this.container.style.width = "100%";
        this.container.style.height = "100%";
        this.container.style.display = "flex";
        this.container.style.flexDirection = "column";
        this.displayWrapper = document.createElement("div");
        this.displayWrapper.style.position = "relative";
        this.displayWrapper.style.flex = "1";
        this.displayWrapper.style.width = "100%";
        this.displayWrapper.style.display = "flex";
        this.displayWrapper.style.justifyContent = "center";
        this.displayWrapper.style.alignItems = "center";
        this.displayWrapper.style.overflow = "hidden"; // Ensure content doesn't spill out
        this.canvasWrapper = document.createElement("div");
        this.canvasWrapper.style.position = "relative";
        this.displayWrapper.appendChild(this.canvasWrapper);
        this.container.appendChild(this.displayWrapper);
        this.controlPanel = document.createElement("div");
        this.controlPanel.style.position = "relative";
        this.controlPanel.style.width = "100%";
        this.controlPanel.style.flexShrink = "0";
        this.controlPanel.style.display = "flex";
        this.controlPanel.style.flexDirection = "column"; // Stack rows vertically
        this.controlPanel.style.gap = "4px"; // Gap between rows
        this.controlPanel.style.marginTop = "6px";
        this.container.appendChild(this.controlPanel);
        this.layers = new Map();
        this.nextLayerId = 1;
        this.backgroundImage = null;
        this.backgroundColor = "#000000";
        this.currentCanvasData = null;
        this.pendingCanvasData = null;
        this.lastPayloadString = null;
        this.textPanel = null;
        this.resizeObserver = null;
        this.isHovering = false; // Track hover state for shortcut safety
        this.ready = this.init();
    }

    async init() {
        this.fabric = fabric;
        
        // Patch initHiddenTextarea to ensure fixed positioning and prevent layout shifts
        if (this.fabric.IText && this.fabric.IText.prototype && !this.fabric.IText.prototype._patchedInitHiddenTextarea) {
            const originalInitHiddenTextarea = this.fabric.IText.prototype.initHiddenTextarea;
            this.fabric.IText.prototype.initHiddenTextarea = function() {
                const result = originalInitHiddenTextarea.call(this);
                if (this.hiddenTextarea) {
                    this.hiddenTextarea.style.position = "fixed";
                    this.hiddenTextarea.style.top = "0";
                    this.hiddenTextarea.style.left = "0";
                    this.hiddenTextarea.style.opacity = "0";
                    this.hiddenTextarea.style.width = "1px";
                    this.hiddenTextarea.style.height = "1px";
                    this.hiddenTextarea.style.zIndex = "-9999";
                    // Ensure it is in body to avoid container scroll issues
                    if (this.hiddenTextarea.parentNode !== document.body) {
                        document.body.appendChild(this.hiddenTextarea);
                    }
                }
                return result;
            };
            this.fabric.IText.prototype._patchedInitHiddenTextarea = true;
        }

        // Customize global control handles
        // You can adjust these values to change the appearance of the selection handles
        this.fabric.Object.prototype.transparentCorners = false;
        this.fabric.Object.prototype.cornerColor = '#ffffff';
        this.fabric.Object.prototype.cornerStrokeColor = '#000000';
        this.fabric.Object.prototype.borderColor = '#00c3ff';
        this.fabric.Object.prototype.cornerSize = 20; // Increased from 12 to 16 for better visibility
        this.fabric.Object.prototype.padding = 16;    // Click padding
        this.fabric.Object.prototype.cornerStyle = 'circle';
        this.fabric.Object.prototype.borderDashArray = [6, 6]; // Thicker dashes
        this.fabric.Object.prototype.borderScaleFactor = 6;    // Thicker border line
        this.fabric.Object.prototype.cornerStrokeWidth = 6;    // Thicker corner stroke

        const canvasElement = document.createElement("canvas");
        this.canvas = new this.fabric.Canvas(canvasElement, {
            width: this.canvasWidth,
            height: this.canvasHeight,
            preserveObjectStacking: true,
            selection: true,
            backgroundColor: this.backgroundColor // Set initial background color
        });
        this.canvasWrapper.appendChild(this.canvas.wrapperEl);
        this.buildControls();
        this.bindEvents();
        
        // Use ResizeObserver for robust layout handling
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === this.displayWrapper) {
                    this.updateScale(entry.contentRect.width, entry.contentRect.height);
                }
            }
        });
        this.resizeObserver.observe(this.displayWrapper);

        this.updateDisplayFromNodeSize(this.node.size);
        // Do not force render here, wait for DOM attachment in onAdded
    }

    async ensureReady() {
        await this.ready;
    }

    buildControls() {
        const commonHeight = "28px";
        const commonStyle = (el) => {
             el.style.height = commonHeight;
             el.style.boxSizing = "border-box";
             el.style.verticalAlign = "middle"; // Ensure vertical alignment
        };

        this.layerSelect = document.createElement("select");
        this.layerSelect.style.padding = "4px 6px";
        this.layerSelect.title = "Select Active Layer";
        this.layerSelect.onchange = () => {
            const id = Number(this.layerSelect.value);
            const obj = this.layers.get(id);
            if (obj) {
                // Fabric.js requires setting the active object and then rendering
                this.canvas.setActiveObject(obj);
                this.canvas.requestRenderAll();
                // Explicitly log for debugging
                console.log("[FunCode] Layer selected via dropdown:", id, obj);
            } else {
                // If "Layer" placeholder or invalid ID is selected, clear selection
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
                console.log("[FunCode] Layer selection cleared via dropdown");
            }
        };

        this.loadBtn = document.createElement("button");
        this.loadBtn.textContent = "Load";
        this.loadBtn.title = "Load Image from Node";
        commonStyle(this.loadBtn);
        this.loadBtn.onclick = async () => {
            // Always use partial queue execution to ensure data format consistency (Base64 vs URL)
            // This prevents canvas reset when full queue is run subsequently.
            if (this.node.id) {
                console.log("[FunCode] Load: Triggering partial queue execution for node", this.node.id);
                try {
                    await queueManager.queueOutputNodes([this.node.id]);
                    console.log("[FunCode] Load: Partial queue execution triggered successfully");
                } catch (error) {
                    console.error("[FunCode] Load: Failed to trigger partial queue", error);
                }
                // The backend will send "funcode_canvas_update" event when done.
            } else {
                 console.log("[FunCode] Load: No node ID, fetching latest data");
                 await this.fetchAndApplyLatestData(true);
                 this.exportToServer();
            }
        };

        this.resetBtn = document.createElement("button");
        this.resetBtn.textContent = "Reset";
        this.resetBtn.title = "Clear Canvas";
        commonStyle(this.resetBtn);
        this.resetBtn.onclick = () => this.resetCanvas();

        this.textBtn = document.createElement("button");
        this.textBtn.textContent = "Text";
        this.textBtn.title = "Add Text Layer";
        commonStyle(this.textBtn);
        this.textBtn.onclick = () => this.openTextPanel();

        this.saveBtn = document.createElement("button");
        this.saveBtn.textContent = "Save";
        this.saveBtn.title = "Save to 'input/FunCodeCanvas'";
        commonStyle(this.saveBtn);
        this.saveBtn.onclick = () => this.saveCanvas();

        this.importBtn = document.createElement("button");
        this.importBtn.textContent = "Import";
        this.importBtn.title = "Import Image";
        commonStyle(this.importBtn);
        this.importBtn.onclick = () => this.openImportGallery();

        this.widthInput = document.createElement("input");
        this.widthInput.type = "number";
        this.widthInput.value = String(this.canvasWidth);
        this.widthInput.style.width = "80px";
        this.widthInput.title = "Canvas Width";
        commonStyle(this.widthInput);
        this.widthInput.onkeydown = (e) => {
            if (e.key === "Enter") this.applyCanvasSize();
        };

        this.heightInput = document.createElement("input");
        this.heightInput.type = "number";
        this.heightInput.value = String(this.canvasHeight);
        this.heightInput.style.width = "80px";
        this.heightInput.title = "Canvas Height";
        commonStyle(this.heightInput);
        this.heightInput.onkeydown = (e) => {
            if (e.key === "Enter") this.applyCanvasSize();
        };

        this.bgColorInput = document.createElement("input");
        this.bgColorInput.type = "color";
        this.bgColorInput.value = this.backgroundColor;
        this.bgColorInput.title = "Background Color";
        commonStyle(this.bgColorInput);
        // Fix for color input height discrepancy: remove padding and border
        this.bgColorInput.style.padding = "0";
        this.bgColorInput.style.border = "none";
        this.bgColorInput.style.width = "40px"; // Optional: set a fixed width for the color picker
        this.bgColorInput.oninput = () => {
            this.backgroundColor = this.bgColorInput.value;
            // Preview only, skip export to avoid lag
            this.applyBackgroundColor(true);
        };
        this.bgColorInput.onchange = () => {
             // Finalize selection, trigger export
             this.backgroundColor = this.bgColorInput.value;
             this.applyBackgroundColor(false);
        };

        this.applyBtn = document.createElement("button");
        this.applyBtn.textContent = "Apply";
        this.applyBtn.title = "Apply Size";
        commonStyle(this.applyBtn);
        this.applyBtn.onclick = () => this.applyCanvasSize();

        // Create 3 rows for organized layout
        const createRow = () => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.flexWrap = "wrap";
            row.style.gap = "6px";
            row.style.alignItems = "center";
            row.style.width = "100%";
            return row;
        };

        const row1 = createRow();
        const row2 = createRow();
        const row3 = createRow();

        // Row 1: Layer controls and Load/Reset
        row1.appendChild(this.layerSelect);
        row1.appendChild(this.loadBtn);
        row1.appendChild(this.resetBtn);

        // Row 2: Tools and I/O and BgColor
        row2.appendChild(this.textBtn);
        row2.appendChild(this.saveBtn);
        row2.appendChild(this.importBtn);
        row2.appendChild(this.bgColorInput);

        // Row 3: Canvas properties and Apply
        row3.appendChild(this.widthInput);
        row3.appendChild(this.heightInput);
        row3.appendChild(this.applyBtn);

        this.controlPanel.appendChild(row1);
        this.controlPanel.appendChild(row2);
        this.controlPanel.appendChild(row3);

        this.updateLayerSelector();
    }

    bindEvents() {
        if (this.hasBoundEvents) return;
        this.hasBoundEvents = true;

        this.canvas.on("selection:created", () => this.syncLayerSelect());
        this.canvas.on("selection:updated", () => this.syncLayerSelect());
        this.canvas.on("selection:cleared", () => this.syncLayerSelect());
        this.canvas.on("object:modified", () => {
            this.canvas.requestRenderAll();
            this.exportToServer();
        });
        
        // Track hover state on wrapper to prevent global shortcut conflicts
        this.canvasWrapper.addEventListener("mouseenter", () => {
            this.isHovering = true;
        });
        this.canvasWrapper.addEventListener("mouseleave", () => {
            this.isHovering = false;
        });
        
        // Handle right-click context menu
        // Combined logic: Prevent default AND trigger custom menu directly from contextmenu event
        // This is more reliable than mouse:down for right-clicks
        this.canvas.upperCanvasEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            
            // Find target manually using Fabric's API
            // findTarget(e, skipGroup) - usually available in standard fabric
            const target = this.canvas.findTarget(e, false);
            
            if (target && !target.isBackground) {
                // Select the object under cursor if not already selected
                const active = this.canvas.getActiveObject();
                if (active !== target) {
                    this.canvas.setActiveObject(target);
                    this.canvas.requestRenderAll();
                }
                this.openContextMenu(e);
            }
        });

        // Mouse down logic for left click only (or other interactions)
        // Right click logic moved to contextmenu listener above
        /*
        this.canvas.on("mouse:down", (opt) => {
            // Right click logic removed
        });
        */
        
        // Store listener reference to avoid memory leaks if we implement cleanup later
        // For now, checking DOM presence is enough to prevent zombie listeners from acting
        this._keydownListener = (e) => {
            // Check if canvas is still valid and in DOM
            if (!this.canvas || !this.canvas.upperCanvasEl || !document.body.contains(this.canvas.upperCanvasEl)) {
                return;
            }

            // Fix: Ignore keydown events coming from input/textarea elements
            const tagName = e.target.tagName.toLowerCase();
            if (tagName === "input" || tagName === "textarea" || e.target.isContentEditable) {
                return;
            }

            if (e.key === "Delete" || e.key === "Backspace") {
                // Only act if the mouse is hovering over the canvas wrapper
                // OR if we are sure the canvas has focus. 
                // Since we don't track hover strictly, checking for active object is a good proxy,
                // BUT user might want to delete something they just selected even if mouse moved away.
                // The capture phase listener prevents default behavior efficiently.
                
                const obj = this.canvas.getActiveObject();
                if (obj && !obj.isBackground) {
                    this.removeObject(obj);
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            }
        };

        document.addEventListener("keydown", this._keydownListener, true);
    }

    updateScale(containerW, containerH) {
        if (!containerW || !containerH) return;
        // Use full available space minus small padding
        const scale = Math.min(
            (containerW - 10) / this.canvasWidth, 
            (containerH - 10) / this.canvasHeight
        );
        
        this.canvasWrapper.style.width = `${this.canvasWidth}px`;
        this.canvasWrapper.style.height = `${this.canvasHeight}px`;
        this.canvasWrapper.style.transform = `scale(${scale})`;
        this.canvasWrapper.style.transformOrigin = "center center"; 
        
        // Update displayWidth/Height for other logic
        this.displayWidth = Math.round(this.canvasWidth * scale);
        this.displayHeight = Math.round(this.canvasHeight * scale);
        
        this.node.setDirtyCanvas(true, true);
    }

    updateDisplayFromNodeSize(size) {
        // Fallback/Initial calculation
        const controlH = this.controlPanel ? this.controlPanel.offsetHeight : 70;
        const availableWidth = Math.max(120, size[0] - 20);
        const availableHeight = Math.max(120, size[1] - controlH - 20);
        const scale = Math.min(availableWidth / this.canvasWidth, availableHeight / this.canvasHeight);
        this.displayWidth = Math.round(this.canvasWidth * scale);
        this.displayHeight = Math.round(this.canvasHeight * scale);
    }

    applyCanvasSize() {
        const w = Math.max(16, Number(this.widthInput.value || this.canvasWidth));
        const h = Math.max(16, Number(this.heightInput.value || this.canvasHeight));
        this.setCanvasSize(w, h);
    }

    setCanvasSize(w, h, skipExport = false) {
        const oldW = this.canvasWidth;
        const oldH = this.canvasHeight;
        if (w === oldW && h === oldH) return;
        const sx = w / oldW;
        const sy = h / oldH;
        this.canvasWidth = w;
        this.canvasHeight = h;
        this.canvas.setDimensions({ width: w, height: h });
        
        // Fix: Re-apply background color explicitly using setBackgroundColor API
        // Direct property assignment might be insufficient after setDimensions in some fabric versions
        const bgColor = this.backgroundColor || "#000000";
        this.canvas.setBackgroundColor(bgColor, () => {
             this.canvas.renderAll();
        });
        // Also set property synchronously just in case
        this.canvas.backgroundColor = bgColor;

        this.canvas.getObjects().forEach(obj => {
            if (obj.isBackground) return;
            // Only update position to maintain relative placement, do NOT scale content
            // obj.scaleX *= sx; 
            // obj.scaleY *= sy;
            obj.left *= sx;
            obj.top *= sy;
            obj.setCoords();
        });
        this.widthInput.value = String(w);
        this.heightInput.value = String(h);
        
        // Ensure background image is centered if it exists
        if (this.backgroundImage) {
            const img = this.backgroundImage;
            img.originX = "center";
            img.originY = "center";
            img.left = w / 2;
            img.top = h / 2;
            img.setCoords();
        }

        if (this.displayWrapper) {
             this.updateScale(this.displayWrapper.clientWidth, this.displayWrapper.clientHeight);
        } else {
             this.updateDisplayFromNodeSize(this.node.size);
        }
        this.canvas.requestRenderAll();
        if (!skipExport) this.exportToServer();
    }

    applyBackgroundColor(skipExport = false) {
        // Direct assignment is faster and synchronous for simple hex colors
        this.canvas.backgroundColor = this.backgroundColor;
        this.canvas.requestRenderAll();
        if (!skipExport) this.exportToServer();
    }

    async applyCanvasData(data, forceReset = false) {
        this.lastPayloadString = JSON.stringify(data);
        this.currentCanvasData = data;
        if (!data) return;
        
        if (forceReset) {
            this.layers.clear();
            this.backgroundImage = null;
            this.canvas.clear(); // Aggressive clear to ensure clean state
            this.canvas.setBackgroundColor(this.backgroundColor, () => {
                 this.canvas.requestRenderAll();
            });
        }
        
        if (data.background && data.background.image) {
            await this.setBackground(data.background.image, data.background.size, true);
        }
        if (Array.isArray(data.layers)) {
            for (const layer of data.layers) {
                if (!layer || !layer.image) continue;
                await this.addLayerFromData(layer);
            }
        }
        this.updateLayerSelector();
        this.canvas.requestRenderAll();
        // Multiple safety renders to catch async loading/decoding
        setTimeout(() => this.canvas.requestRenderAll(), 50);
        setTimeout(() => this.canvas.requestRenderAll(), 200);
    }

    isCanvasEmpty() {
        return !this.backgroundImage && this.layers.size === 0;
    }

    scanGraphForInputs() {
        console.log("[FunCode] scanGraphForInputs started");
        // Find the connected CanvasDataFunCodeNode
        const dataInput = this.node.inputs?.find(i => i.name === "canvas_data");
        if (!dataInput) {
            console.log("[FunCode] canvas_data input not found");
            return null;
        }
        if (!dataInput.link) {
            console.log("[FunCode] canvas_data not linked");
            return null;
        }

        const linkId = dataInput.link;
        const graph = app.graph;
        const link = graph.links[linkId];
        if (!link) {
            console.log("[FunCode] link not found in graph");
            return null;
        }

        const dataNode = graph.getNodeById(link.origin_id);
        if (!dataNode) {
            console.log("[FunCode] dataNode not found");
            return null;
        }
        console.log("[FunCode] Found dataNode:", dataNode.type, dataNode.title);

        if (dataNode.type !== "CanvasDataFunCodeNode") {
            console.log("[FunCode] dataNode type mismatch:", dataNode.type);
            return null;
        }

        const payload = { background: null, layers: [] };
        let hasData = false;

        // Helper to get image URL from a connected node
        const getImageUrl = (inputName) => {
            const input = dataNode.inputs?.find(i => i.name === inputName);
            if (!input || !input.link) return null;
            const l = graph.links[input.link];
            if (!l) return null;
            const srcNode = graph.getNodeById(l.origin_id);
            if (!srcNode) return null;

            console.log("[FunCode] Checking input", inputName, "SrcNode:", srcNode.type, srcNode.title);

            // Generic check for image widget
            // Look for any widget that holds a string ending in an image extension
            // This covers LoadImage, LoadImageMask, and potentially custom loaders
            if (srcNode.widgets) {
                for (const w of srcNode.widgets) {
                    if (typeof w.value === "string") {
                        const val = w.value.toLowerCase();
                        if (val.match(/\.(png|jpg|jpeg|webp|bmp|gif|tiff)$/)) {
                             console.log("[FunCode] Found image widget:", w.name, w.value);
                             return api.apiURL(`/view?filename=${encodeURIComponent(w.value)}&type=input`);
                        }
                    }
                }
            }
            return null;
        };

        // 1. Background
        const bgUrl = getImageUrl("bg_image");
        if (bgUrl) {
            payload.background = { id: 0, image: bgUrl, size: null }; // Size will be auto-detected
            hasData = true;
        }

        // 2. Layers
        // CanvasDataFunCodeNode inputs are dynamically named "overlayx" (previously "overlay_x")
        if (dataNode.inputs) {
            dataNode.inputs.forEach(input => {
                if (input.name.startsWith("overlay")) {
                    const layerUrl = getImageUrl(input.name);
                    if (layerUrl) {
                        // Extract id from "overlay1", "overlay2", etc.
                        // Handle potential legacy "overlay_1" just in case
                        let idStr = input.name.replace("overlay", "");
                        if (idStr.startsWith("_")) idStr = idStr.substring(1);
                        const id = parseInt(idStr);
                        
                        if (!isNaN(id)) {
                            payload.layers.push({ id: id, image: layerUrl, size: null });
                            hasData = true;
                        }
                    }
                }
            });
        }

        // Sort layers by ID
        payload.layers.sort((a, b) => a.id - b.id);

        return hasData ? payload : null;
    }

    async maybeApplyCanvasData(data) {
        const payloadString = JSON.stringify(data);
        if (!this.currentCanvasData || this.isCanvasEmpty() || this.lastPayloadString !== payloadString) {
            await this.applyCanvasData(data, true);
            return;
        }
        this.currentCanvasData = data;
        this.lastPayloadString = payloadString;
    }

    async fetchAndApplyLatestData(forceReset = false) {
        const nodeId = this.node.id != null ? String(this.node.id) : null;
        if (!nodeId) return;
        const res = await api.fetchApi(`/funcode/canvas_payload?node_id=${encodeURIComponent(nodeId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.payload) {
            await this.applyCanvasData(data.payload, forceReset);
        }
    }

    async applyPendingCanvasData() {
        if (!this.pendingCanvasData) return;
        const { data, forceReset } = this.pendingCanvasData;
        this.pendingCanvasData = null;
        await this.applyCanvasData(data, forceReset);
    }

    async setBackground(dataUrl, size, skipExport = false) {
        await new Promise((resolve) => {
            this.fabric.Image.fromURL(dataUrl, (img) => {
                img.selectable = false;
                img.evented = false;
                img.isBackground = true;
                this.backgroundImage = img;
                this.canvas.setBackgroundImage(img, () => {
                    if (size && size.width && size.height) {
                        this.setCanvasSize(Number(size.width), Number(size.height), true);
                    } else if (img.width && img.height) {
                        // If explicit size is missing (frontend scan), use image dimensions
                        this.setCanvasSize(img.width, img.height, true);
                    } else {
                        // Default behavior: center image if no explicit mode logic
                        if (this.backgroundImage) {
                            const img = this.backgroundImage;
                            img.originX = "center";
                            img.originY = "center";
                            img.left = this.canvasWidth / 2;
                            img.top = this.canvasHeight / 2;
                            img.setCoords();
                            this.canvas.requestRenderAll();
                            if (!skipExport) this.exportToServer();
                        }
                    }
                    resolve();
                });
            }, { crossOrigin: "anonymous" });
        });
        // applyBackgroundMode(true) was here, removed
        if (!skipExport) this.exportToServer();
    }

    async addLayerFromData(layer) {
        await new Promise((resolve) => {
            this.fabric.Image.fromURL(layer.image, (img) => {
                const id = layer.id || this.nextLayerId++;
                // Sync nextLayerId to avoid conflicts with loaded IDs
                if (layer.id && layer.id >= this.nextLayerId) {
                    this.nextLayerId = layer.id + 1;
                }
                
                img.layerId = id;
                img.isBackground = false;
                img.originX = "center";
                img.originY = "center";
                img.left = this.canvasWidth / 2;
                img.top = this.canvasHeight / 2;
                this.canvas.add(img);
                this.layers.set(id, img);
                img.setCoords();
                this.canvas.requestRenderAll(); // Force render per layer
                resolve();
            }, { crossOrigin: "anonymous" });
        });
    }

    clearLayers(skipExport = false) {
        this.layers.forEach(obj => this.canvas.remove(obj));
        this.layers.clear();
        this.updateLayerSelector();
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        if (!skipExport) this.exportToServer();
    }

    resetCanvas(skipExport = false) {
        this.currentCanvasData = null; // Clear cached data
        this.layers.clear();
        this.updateLayerSelector();
        this.backgroundImage = null;
        
        // Synchronously clear everything first
        this.canvas.clear();
        
        // Reset background properties synchronously
        this.canvas.backgroundImage = null;
        this.canvas.backgroundColor = this.backgroundColor;
        
        this.canvas.requestRenderAll();
        if (!skipExport) this.exportToServer();
    }

    updateLayerSelector() {
        // Remember current selection if possible
        const currentVal = this.layerSelect.value;
        
        this.layerSelect.innerHTML = "";
        
        const items = Array.from(this.layers.entries()).sort((a, b) => a[0] - b[0]);
        // Filter out background layers
        const overlayItems = items.filter(([id, obj]) => !obj.isBackground);

        if (overlayItems.length > 0) {
            // Only add placeholder/reset option if there are actual layers to select
            const placeholder = document.createElement("option");
            placeholder.textContent = "- Select Layer -";
            placeholder.value = "";
            this.layerSelect.appendChild(placeholder);

            overlayItems.forEach(([id, obj]) => {
                const opt = document.createElement("option");
                opt.value = String(id);
                // Updated naming: overlay1, overlay2... (no underscore)
                opt.textContent = obj.type === "i-text" ? `Text ${id}` : `overlay${id}`;
                this.layerSelect.appendChild(opt);
            });
            
            // Try to restore selection if it still exists
            if (currentVal && this.layers.has(Number(currentVal))) {
                this.layerSelect.value = currentVal;
            } else {
                // If the previously selected layer is gone, or value was empty, sync with active object
                this.syncLayerSelect();
            }
        } else {
             // If no layers, clear selection or show empty state
             this.layerSelect.value = "";
        }
    }

    syncLayerSelect() {
        const obj = this.canvas.getActiveObject();
        if (obj && obj.layerId) {
            this.layerSelect.value = String(obj.layerId);
        } else {
            this.layerSelect.value = "";
        }
    }

    removeObject(obj, skipExport = false) {
        if (!obj) return;
        
        // Handle multi-selection (ActiveSelection)
        if (obj.type === 'activeSelection' && typeof obj.getObjects === 'function') {
            const objects = obj.getObjects(); // Get references BEFORE discard
            this.canvas.discardActiveObject(); // Discard to break the group
            
            // Now remove each object individually
            [...objects].forEach(subObj => {
                this.removeObject(subObj, true); 
            });
            
            this.canvas.renderAll(); // Force sync render
            if (!skipExport) this.exportToServer();
            return;
        }

        // Handle single object
        if (obj.layerId) this.layers.delete(obj.layerId);
        
        // Critical: Discard active object before removal to prevent "ghost" artifacts
        // and ensure the canvas state is clean.
        if (this.canvas.getActiveObject() === obj) {
            this.canvas.discardActiveObject();
        }
        
        this.canvas.remove(obj);
        this.updateLayerSelector();
        this.canvas.renderAll(); // Force sync render
        
        if (!skipExport) this.exportToServer();
    }

    openContextMenu(e) {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.isBackground) return;

        if (this.contextMenu) {
            if (this.contextMenu.parentNode) this.contextMenu.parentNode.removeChild(this.contextMenu);
            this.contextMenu = null;
        }

        e.preventDefault();

        // Styles
        const menuStyle = "position: fixed; background: #2a2a2a; color: #fff; padding: 4px 0; border-radius: 4px; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); min-width: 160px; font-family: sans-serif; font-size: 13px; border: 1px solid #444;";
        const itemStyle = "padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; position: relative; transition: background 0.1s;";
        const submenuStyle = "position: absolute; left: 100%; top: -4px; background: #2a2a2a; padding: 4px 0; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); min-width: 150px; display: none; border: 1px solid #444;";

        const menu = document.createElement("div");
        menu.style.cssText = menuStyle;
        
        // Adjust position to prevent off-screen
        let left = e.pageX;
        let top = e.pageY;
        if (left + 160 > window.innerWidth) left -= 160;
        if (top + 200 > window.innerHeight) top -= 200;
        
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        const createItem = (text, onClick, hasSubmenu = false) => {
            const item = document.createElement("div");
            item.style.cssText = itemStyle;
            item.textContent = text;
            
            if (hasSubmenu) {
                const arrow = document.createElement("span");
                arrow.textContent = "▸";
                arrow.style.marginLeft = "10px";
                arrow.style.color = "#888";
                item.appendChild(arrow);
            }

            item.onmouseenter = () => {
                item.style.background = "#3a3a3a";
                if (hasSubmenu) {
                    const sub = item.querySelector(".funcode-submenu");
                    if (sub) sub.style.display = "block";
                }
            };
            item.onmouseleave = () => {
                item.style.background = "transparent";
                if (hasSubmenu) {
                    const sub = item.querySelector(".funcode-submenu");
                    if (sub) sub.style.display = "none";
                }
            };

            if (onClick) {
                item.onclick = (ev) => {
                    ev.stopPropagation();
                    if (!hasSubmenu) {
                        onClick();
                        closeMenu();
                    }
                };
            }
            return item;
        };

        const createSubmenu = (parentItem, items) => {
            const sub = document.createElement("div");
            sub.className = "funcode-submenu";
            sub.style.cssText = submenuStyle;
            items.forEach(({text, action}) => {
                sub.appendChild(createItem(text, action));
            });
            parentItem.appendChild(sub);
        };

        const closeMenu = () => {
            if (menu.parentNode) menu.parentNode.removeChild(menu);
            this.contextMenu = null;
        };

        // 1. Transform
        const transformItem = createItem("Transform", null, true);
        createSubmenu(transformItem, [
            { text: "Flip Horizontal", action: () => { 
                console.log("[FunCode] Action: Flip Horizontal");
                obj.set('flipX', !obj.flipX); 
                obj.setCoords(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Flip Vertical", action: () => { 
                console.log("[FunCode] Action: Flip Vertical");
                obj.set('flipY', !obj.flipY); 
                obj.setCoords(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Center", action: () => { 
                console.log("[FunCode] Action: Center");
                obj.center(); 
                obj.setCoords(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Center Horizontal", action: () => { 
                console.log("[FunCode] Action: Center Horizontal");
                obj.centerH(); 
                obj.setCoords(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Center Vertical", action: () => { 
                console.log("[FunCode] Action: Center Vertical");
                obj.centerV(); 
                obj.setCoords(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
        ]);
        menu.appendChild(transformItem);

        // 2. Layer
        const layerItem = createItem("Layer", null, true);
        createSubmenu(layerItem, [
            { text: "Bring Forward", action: () => { 
                console.log("[FunCode] Action: Bring Forward");
                obj.bringForward(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Send Backward", action: () => { 
                console.log("[FunCode] Action: Send Backward");
                obj.sendBackwards(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Bring to Front", action: () => { 
                console.log("[FunCode] Action: Bring to Front");
                obj.bringToFront(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
            { text: "Send to Back", action: () => { 
                console.log("[FunCode] Action: Send to Back");
                obj.sendToBack(); 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }},
        ]);
        menu.appendChild(layerItem);

        // 3. Blend Mode
        const blendItem = createItem("Blend Mode", null, true);
        const blends = [
            ["Normal", "source-over"],
            ["Multiply", "multiply"],
            ["Screen", "screen"],
            ["Overlay", "overlay"],
            ["Lighten", "lighten"],
            ["Darken", "darken"],
            ["Hard Light", "hard-light"],
            ["Soft Light", "soft-light"],
            ["Difference", "difference"],
            ["Exclusion", "exclusion"]
        ];
        createSubmenu(blendItem, blends.map(b => ({
            text: b[0],
            action: () => { 
                console.log("[FunCode] Action: Blend Mode", b[0]);
                obj.globalCompositeOperation = b[1]; 
                this.canvas.renderAll(); 
                this.exportToServer(); 
            }
        })));
        menu.appendChild(blendItem);

        // 4. Opacity
        const opacityItem = createItem("Opacity", () => {
            console.log("[FunCode] Action: Open Opacity Panel");
            this.openOpacityPanel(obj);
        });
        menu.appendChild(opacityItem);

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Close on click outside
        setTimeout(() => {
            const clickListener = () => {
                closeMenu();
                document.removeEventListener("click", clickListener);
                document.removeEventListener("contextmenu", contextListener);
            };
            const contextListener = (ev) => {
                 if (ev.target !== menu && !menu.contains(ev.target)) {
                     closeMenu();
                     document.removeEventListener("click", clickListener);
                     document.removeEventListener("contextmenu", contextListener);
                 }
            };
            document.addEventListener("click", clickListener);
            document.addEventListener("contextmenu", contextListener);
        }, 10);
    }


    openOpacityPanel(obj) {
        if (!obj) return;
        
        // Remove existing panel if any
        if (this.opacityPanel) {
            document.body.removeChild(this.opacityPanel);
            this.opacityPanel = null;
        }

        const originalOpacity = obj.opacity !== undefined ? obj.opacity : 1;

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.left = "50%";
        panel.style.top = "60%"; // Slightly lower than center
        panel.style.transform = "translate(-50%, -50%)";
        panel.style.backgroundColor = "#2a2a2a";
        panel.style.border = "1px solid #444";
        panel.style.padding = "15px";
        panel.style.borderRadius = "8px";
        panel.style.zIndex = "10001";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.gap = "10px";
        panel.style.minWidth = "250px";
        panel.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
        panel.style.color = "#fff";
        panel.style.fontFamily = "sans-serif";

        // Row 1: Value Display
        const valueRow = document.createElement("div");
        valueRow.style.textAlign = "center";
        valueRow.textContent = `Opacity: ${Math.round(originalOpacity * 100)}%`;
        panel.appendChild(valueRow);

        // Row 2: Slider
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.value = Math.round(originalOpacity * 100);
        slider.style.width = "100%";
        slider.title = "Drag to adjust opacity / 拖动调整透明度";
        slider.oninput = (e) => {
            const val = Number(e.target.value) / 100;
            obj.set("opacity", val);
            this.canvas.renderAll();
            valueRow.textContent = `Opacity: ${e.target.value}%`;
        };
        panel.appendChild(slider);

        // Row 3: Buttons
        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "space-between";
        btnRow.style.gap = "10px";

        const commonBtnStyle = (btn) => {
            btn.style.flex = "1";
            btn.style.padding = "6px 0";
            btn.style.cursor = "pointer";
            btn.style.border = "1px solid #555";
            btn.style.borderRadius = "4px";
            btn.style.backgroundColor = "#3a3a3a";
            btn.style.color = "#fff";
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.title = "Revert changes / 取消";
        commonBtnStyle(cancelBtn);
        cancelBtn.onclick = () => {
            obj.set("opacity", originalOpacity);
            this.canvas.renderAll();
            document.body.removeChild(panel);
            this.opacityPanel = null;
        };

        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = "Confirm";
        confirmBtn.title = "Apply changes / 确定";
        commonBtnStyle(confirmBtn);
        confirmBtn.onclick = () => {
            // Opacity already set during slide, just close and export
            this.exportToServer();
            document.body.removeChild(panel);
            this.opacityPanel = null;
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        panel.appendChild(btnRow);

        document.body.appendChild(panel);
        this.opacityPanel = panel;
    }

    openTextPanel() {
        if (this.textPanel) {
            // Toggle visibility if already exists
            this.textPanel.style.display = this.textPanel.style.display === "none" ? "flex" : "none";
            return;
        }
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.top = "100%";
        panel.style.left = "0";
        panel.style.width = "100%"; // Match node width
        panel.style.boxSizing = "border-box";
        panel.style.background = "#2a2a2a"; // Match context menu style
        panel.style.color = "#fff";
        panel.style.padding = "10px";
        panel.style.zIndex = "100";
        panel.style.border = "1px solid #444";
        panel.style.borderTop = "none";
        panel.style.borderRadius = "0 0 8px 8px";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.gap = "8px";
        panel.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";

        // Helper to create rows
        const createRow = () => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.gap = "6px";
            row.style.alignItems = "center";
            row.style.flexWrap = "wrap";
            return row;
        };

        const addBtn = document.createElement("button");
        addBtn.textContent = "+ Add Text";
        addBtn.style.flex = "1";
        addBtn.style.cursor = "pointer";
        addBtn.onclick = () => this.addTextLayer();

        // Font & Size
        const row1 = createRow();
        const fontSelect = document.createElement("select");
        fontSelect.style.flex = "2";
        ["Arial","Helvetica","Times New Roman","Courier New","Verdana","Georgia","Impact","Trebuchet MS"].forEach(f => {
            const opt = document.createElement("option");
            opt.value = f;
            opt.textContent = f;
            fontSelect.appendChild(opt);
        });

        const sizeSelect = document.createElement("select");
        sizeSelect.style.flex = "1";
        [12,16,20,24,28,32,40,48,64,72,96].forEach(s => {
            const opt = document.createElement("option");
            opt.value = String(s);
            opt.textContent = String(s);
            sizeSelect.appendChild(opt);
        });
        // Set default size to 32 to match addTextLayer
        sizeSelect.value = "32"; 

        row1.appendChild(fontSelect);
        row1.appendChild(sizeSelect);

        // Colors
        const row2 = createRow();
        
        const colorLabel = document.createElement("span");
        colorLabel.textContent = "Color:";
        colorLabel.style.fontSize = "12px";
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = "#ffffff";
        
        const bgLabel = document.createElement("span");
        bgLabel.textContent = "Bg:";
        bgLabel.style.fontSize = "12px";
        bgLabel.style.marginLeft = "8px";
        const bgInput = document.createElement("input");
        bgInput.type = "color";
        bgInput.value = "#000000";
        
        const bgTransparentBtn = document.createElement("button");
        bgTransparentBtn.textContent = "🚫";
        bgTransparentBtn.title = "Transparent Background";
        bgTransparentBtn.style.padding = "0 4px";
        bgTransparentBtn.onclick = () => {
             const obj = this.canvas.getActiveObject();
             if (obj && obj.type === "i-text") {
                 obj.set("backgroundColor", "");
                 obj.dirty = true; // Force cache update
                 if (obj.isEditing) {
                     obj.initDimensions();
                     obj.setCoords();
                     this.canvas.clearContext(this.canvas.contextTop); // Clear top context if editing
                 }
                 this.canvas.renderAll(); // Synchronous render
                 this.exportToServer();
             }
        };

        row2.appendChild(colorLabel);
        row2.appendChild(colorInput);
        row2.appendChild(bgLabel);
        row2.appendChild(bgInput);
        row2.appendChild(bgTransparentBtn);

        // Styles
        const row3 = createRow();
        const createStyleBtn = (text, prop, activeVal, inactiveVal) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.style.flex = "1";
            btn.style.fontSize = "12px";
            btn.dataset.active = "0";
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const isActive = btn.dataset.active === "1";
                btn.dataset.active = isActive ? "0" : "1";
                btn.style.background = isActive ? "" : "#555";
                
                const obj = this.canvas.getActiveObject();
                if (obj && obj.type === "i-text") {
                    obj.set(prop, isActive ? inactiveVal : activeVal);
                    obj.dirty = true;
                    if (obj.isEditing) {
                         obj.initDimensions();
                         obj.setCoords();
                         this.canvas.clearContext(this.canvas.contextTop);
                    }
                    this.canvas.renderAll();
                    this.exportToServer();
                }
            };
            return btn;
        };

        const boldBtn = createStyleBtn("B", "fontWeight", "bold", "normal");
        const italicBtn = createStyleBtn("I", "fontStyle", "italic", "normal");
        const underlineBtn = createStyleBtn("U", "underline", true, false);

        row3.appendChild(boldBtn);
        row3.appendChild(italicBtn);
        row3.appendChild(underlineBtn);

        // Spacing & Stroke
        const row4 = createRow();
        const letterInput = document.createElement("input");
        letterInput.type = "number";
        letterInput.placeholder = "Char Spacing";
        letterInput.value = "0";
        letterInput.step = "50"; // Increased step from 10 to 50 for better visibility (0.05em per step)
        letterInput.style.width = "50px";
        
        const lineInput = document.createElement("input");
        lineInput.type = "number";
        lineInput.placeholder = "Line Height";
        lineInput.value = "1.2";
        lineInput.step = "0.1";
        lineInput.style.width = "50px";
        
        row4.appendChild(document.createTextNode("Space:"));
        row4.appendChild(letterInput);
        row4.appendChild(document.createTextNode("Line:"));
        row4.appendChild(lineInput);

        const apply = () => {
            const obj = this.canvas.getActiveObject();
            // Allow editing even if multiple objects are selected (if all are text), but standard is single
            if (!obj || obj.type !== "i-text") return;
            
            const props = {
                fontFamily: fontSelect.value,
                fontSize: Number(sizeSelect.value),
                fill: colorInput.value,
                charSpacing: Number(letterInput.value),
                lineHeight: Number(lineInput.value)
            };
            
            if (document.activeElement === bgInput) {
                props.backgroundColor = bgInput.value;
            }

            // Apply styles
            obj.set(props);
            
            // Force dirty to ensure render
            obj.dirty = true;
            
            // If in editing mode, we might need to update the cursor/textarea style or force a refresh
            if (obj.isEditing) {
                // initDimensions calculates new size based on font/size changes
                obj.initDimensions(); 
                obj.setCoords();
                this.canvas.clearContext(this.canvas.contextTop);
            }

            // Use synchronous render for immediate feedback
            this.canvas.renderAll();
            this.exportToServer();
        };

        [fontSelect,sizeSelect,colorInput,bgInput,letterInput,lineInput].forEach(el => {
            el.oninput = apply;
            el.onchange = apply;
        });

        // Sync UI with selection
        const syncUI = () => {
            const obj = this.canvas.getActiveObject();
            if (!obj || obj.type !== "i-text") return;
            
            fontSelect.value = obj.fontFamily || "Arial";
            sizeSelect.value = String(obj.fontSize || 32);
            colorInput.value = obj.fill || "#ffffff";
            
            if (obj.backgroundColor) {
                bgInput.value = obj.backgroundColor;
            }
            
            letterInput.value = obj.charSpacing || 0;
            lineInput.value = obj.lineHeight || 1.2;

            const updateBtn = (btn, val) => {
                const isActive = val;
                btn.dataset.active = isActive ? "1" : "0";
                btn.style.background = isActive ? "#555" : "";
            };

            updateBtn(boldBtn, obj.fontWeight === "bold");
            updateBtn(italicBtn, obj.fontStyle === "italic");
            updateBtn(underlineBtn, obj.underline);
        };

        this.canvas.on("selection:created", syncUI);
        this.canvas.on("selection:updated", syncUI);

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close Panel";
        closeBtn.style.marginTop = "6px";
        closeBtn.onclick = () => {
             this.textPanel.style.display = "none";
        };

        panel.appendChild(addBtn);
        panel.appendChild(row1);
        panel.appendChild(row2);
        panel.appendChild(row3);
        panel.appendChild(row4);
        panel.appendChild(closeBtn);

        // Append to container (relative to node) instead of body
        this.container.appendChild(panel);
        this.textPanel = panel;
    }

    addTextLayer() {
        // Ensure unique ID
        let id = this.nextLayerId;
        while (this.layers.has(id)) {
            id++;
        }
        this.nextLayerId = id + 1;

        const text = new this.fabric.IText("文字", {
            left: this.canvasWidth / 2,
            top: this.canvasHeight / 2,
            originX: "center",
            originY: "center",
            fontSize: 72,
            fill: "#ffffff",
            backgroundColor: "" // Ensure transparent background by default
        });
        text.layerId = id;
        text.isBackground = false;
        this.canvas.add(text);
        text.setCoords(); // Ensure coordinates are calculated
        this.canvas.setActiveObject(text);
        this.layers.set(id, text);
        this.updateLayerSelector();
        
        // Force synchronous render to ensure immediate visibility
        this.canvas.renderAll();
        
        // Double check render in next frame to handle any race conditions
        setTimeout(() => {
             this.canvas.renderAll();
        }, 0);

        // Auto-export when adding text
        this.exportToServer();
    }

    async exportToServer() {
        const dataUrl = this.canvas.toDataURL({ format: "png" });
        const nodeId = this.node.id != null ? String(this.node.id) : null;
        if (!nodeId) return;
        await api.fetchApi("/funcode/canvas_export", {
            method: "POST",
            body: JSON.stringify({ node_id: nodeId, image_b64: dataUrl })
        });
    }

    async saveCanvas() {
        const dataUrl = this.canvas.toDataURL({ format: "png" });
        const name = `canvas_${Date.now()}.png`;
        await api.fetchApi("/funcode/canvas_save", {
            method: "POST",
            body: JSON.stringify({ image_b64: dataUrl, filename: name })
        });
    }

    async openImportGallery() {
        const res = await api.fetchApi("/funcode/canvas_list", { method: "GET" });
        const data = await res.json();
        const files = Array.isArray(data.files) ? data.files : [];
        this.showGallery(files, async (filename) => {
            // Fix: Use correct view URL logic for loading image into canvas
            const parts = filename.split("/");
            const realFilename = parts.pop();
            const subfolder = parts.join("/");
            const url = api.apiURL(`/view?filename=${encodeURIComponent(realFilename)}&type=input&subfolder=${encodeURIComponent(subfolder)}`);
            
            await new Promise((resolve) => {
                this.fabric.Image.fromURL(url, (img) => {
                    this.resetCanvas();
                    // Import as BACKGROUND if it's an imported merged image
                    // This aligns with "Import" usually meaning "Load this as my base"
                    // And allows drawing/overlaying on top of it.
                    
                    img.selectable = false;
                    img.evented = false;
                    img.isBackground = true;
                    this.backgroundImage = img;
                    
                    // Auto-resize canvas to match imported image
                    if (img.width && img.height) {
                        this.setCanvasSize(img.width, img.height, true);
                    }

                    this.canvas.setBackgroundImage(img, () => {
                         // Center the image
                        img.originX = "center";
                        img.originY = "center";
                        img.left = this.canvasWidth / 2;
                        img.top = this.canvasHeight / 2;
                        
                        // Fix: Force background color update if it was transparent
                        if (!this.canvas.backgroundColor) {
                            this.canvas.setBackgroundColor(this.backgroundColor || "#000000", () => {
                                this.canvas.renderAll();
                            });
                        } else {
                            this.canvas.renderAll();
                        }
                        
                        this.exportToServer();
                        resolve();
                    });
                }, { crossOrigin: "anonymous" });
            });
        });
    }

    showGallery(filenames, onSelect) {
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.background = "rgba(0,0,0,0.85)";
        overlay.style.zIndex = "10000";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.padding = "20px";
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.style.color = "#fff";
        const title = document.createElement("div");
        title.textContent = "Canvas Gallery";
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        closeBtn.onclick = () => document.body.removeChild(overlay);
        header.appendChild(title);
        header.appendChild(closeBtn);
        const container = document.createElement("div");
        container.style.flex = "1";
        container.style.overflowY = "auto";
        container.style.display = "grid";
        container.style.gridTemplateColumns = "repeat(auto-fill, minmax(160px, 1fr))";
        container.style.gridAutoRows = "min-content"; // Fix: Prevent items from stretching to fill height
        container.style.gap = "12px";
        container.style.alignContent = "start"; // Fix: Pack items to start vertically
        filenames.forEach(name => {
            const item = document.createElement("div");
            item.style.background = "#222";
            item.style.padding = "8px";
            item.style.borderRadius = "6px";
            item.style.cursor = "pointer";
            const img = document.createElement("img");
        img.style.width = "100%";
        img.style.height = "120px";
        img.style.objectFit = "contain";
        // Fix: Use correct view URL format for files in input directory
        // The filename format from backend is "FunCodeCanvas/filename.png"
        // But the /view endpoint expects "subfolder" and "filename" separately if possible,
        // OR a relative path. For input folder, passing just filename usually works if it's flat.
        // However, we are in a subfolder "FunCodeCanvas".
        // Let's try splitting it manually.
        const parts = name.split("/");
        const realFilename = parts.pop();
        const subfolder = parts.join("/");
        img.src = api.apiURL(`/view?filename=${encodeURIComponent(realFilename)}&type=input&subfolder=${encodeURIComponent(subfolder)}`);
            const label = document.createElement("div");
            label.textContent = name.split("/").pop();
            label.style.color = "#fff";
            label.style.fontSize = "12px";
            label.style.textAlign = "center";
            item.appendChild(img);
            item.appendChild(label);
            item.onclick = async () => {
                await onSelect(name);
                document.body.removeChild(overlay);
            };
            container.appendChild(item);
        });
        overlay.appendChild(header);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
    }

    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.canvas) {
            this.canvas.dispose();
        }
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

app.registerExtension({
    name: "FunCode.CanvasNodes",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "CanvasDataFunCodeNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const res = onNodeCreated?.apply(this, arguments);
                this.properties = this.properties || {};
                if (!this.properties.overlayCount) this.properties.overlayCount = 1;
                const syncInputs = () => {
                    const overlays = (this.inputs || []).filter(i => i.name.startsWith("overlay"));
                    let count = overlays.length;
                    while (count < this.properties.overlayCount) {
                        const idx = count + 1;
                        this.addInput(`overlay${idx}`, "IMAGE");
                        count += 1;
                    }
                    while (count > this.properties.overlayCount) {
                        // Find input with current max index (e.g. overlay5)
                        const inputName = `overlay${count}`;
                        const index = this.inputs.findIndex(i => i.name === inputName || i.name === `overlay_${count}`);
                        if (index >= 0) this.removeInput(index);
                        count -= 1;
                    }
                    // Force resize to fit content after modifying inputs
                    const size = this.computeSize();
                    this.setSize([this.size[0], size[1]]);
                };
                this.syncInputs = syncInputs;
                this.syncInputs();
                const addBtn = this.addWidget("button", "Add Overlay", null, () => {
                    if (this.properties.overlayCount < 10) {
                        this.properties.overlayCount += 1;
                        this.syncInputs();
                        this.setDirtyCanvas(true, true);
                    }
                });
                const removeBtn = this.addWidget("button", "Remove Overlay", null, () => {
                    if (this.properties.overlayCount > 1) {
                        this.properties.overlayCount -= 1;
                        this.syncInputs();
                        this.setDirtyCanvas(true, true);
                    }
                });
                addBtn.serialize = false;
                removeBtn.serialize = false;
                return res;
            };
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(o) {
                onConfigure?.apply(this, arguments);
                this.properties = this.properties || {};
                if (o?.properties?.overlayCount) this.properties.overlayCount = o.properties.overlayCount;
                setTimeout(() => {
                    if (this.syncInputs) {
                        this.syncInputs();
                    } else {
                        // Fallback if syncInputs wasn't attached (e.g. if onNodeCreated logic differs)
                        const overlays = (this.inputs || []).filter(i => i.name.startsWith("overlay"));
                        let count = overlays.length;
                        while (count < this.properties.overlayCount) {
                            const idx = count + 1;
                            this.addInput(`overlay${idx}`, "IMAGE");
                            count += 1;
                        }
                    }
                }, 0);
            };
        }
        if (nodeData.name === "CanvasEditorFunCodeNode") {
            const onAdded = nodeType.prototype.onAdded;
            nodeType.prototype.onAdded = function() {
                onAdded?.apply(this, arguments);
                initEvents();
                const element = document.createElement("div");
                element.style.position = "relative";
                element.style.width = "100%";
                element.style.height = "100%";
                this.canvasElement = element;
                this.canvasInstance = new FunCanvas(this);
                this.addDOMWidget("canvas", "canvas", element);
                this.canvasInstance.ensureReady().then(() => {
                    element.appendChild(this.canvasInstance.container);
                    // Use a reasonable minimum size, not tied to canvas content
                    const minWidth = 200;
                    const minHeight = 200;
                    element.style.minWidth = `${minWidth}px`;
                    element.style.minHeight = `${minHeight}px`;
                    // Don't override computeSize to force large dimensions. 
                    // Let ComfyUI handle resizing, or provide a minimal computeSize.
                    // this.computeSize = () => [minWidth, minHeight]; 
                    // If we want to set an initial size that fits the canvas, we can do it once:
                    if (!this.size || this.size[0] < minWidth || this.size[1] < minHeight) {
                        this.size = [
                            Math.max(this.canvasInstance.displayWidth + 20, minWidth), 
                            Math.max(this.canvasInstance.displayHeight + this.canvasInstance.controlHeight + 20, minHeight)
                        ];
                    }
                    this.canvasInstance.updateDisplayFromNodeSize(this.size);
                    this.canvasInstance.applyPendingCanvasData();
                    if (!this.canvasInstance.currentCanvasData) {
                        // Wait for a frame to ensure Fabric canvas is properly initialized in DOM
                        requestAnimationFrame(() => {
                             this.canvasInstance.applyBackgroundColor(false); // Apply color
                             this.canvasInstance.canvas.requestRenderAll();   // Render visual
                             this.canvasInstance.exportToServer();            // Sync to backend
                             // Also try to fetch just in case, but rely on local default
                             this.canvasInstance.fetchAndApplyLatestData(true);
                        });
                    } else {
                         // If data exists, re-apply it to ensure visibility
                         this.canvasInstance.applyCanvasData(this.canvasInstance.currentCanvasData, true);
                    }
                    this.setDirtyCanvas(true, true);
                });
                instances.set(String(this.id), this.canvasInstance);
            };
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                onRemoved?.apply(this, arguments);
                const key = String(this.id);
                const inst = instances.get(key);
                if (inst) {
                    inst.dispose();
                    instances.delete(key);
                }
            };
        }
    }
});
