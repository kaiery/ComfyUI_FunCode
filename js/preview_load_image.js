import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "FunCode.LoadImagePreviewNode",
    async nodeCreated(node) {
        if (node.comfyClass !== "LoadImagePreviewNode") return;

        // Find the image widget
        const imageWidget = node.widgets.find(w => w.name === "image");
        if (!imageWidget) return;

        // Create a button to open the gallery
        const btn = node.addWidget("button", "🖼️ Open Gallery", null, () => {
            showGallery(imageWidget, node);
        });
        
        // Adjust node size to fit the new button
        // node.setSize([node.size[0], node.size[1] + 30]);
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Optional: specific logic for node definition
    }
});

function showGallery(widget, node) {
    // 1. Create Overlay
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

    // 2. Header
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
    closeBtn.onclick = () => document.body.removeChild(overlay);

    header.appendChild(title);
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    // 3. Grid Container
    const container = document.createElement("div");
    Object.assign(container.style, {
        flex: "1",
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "15px",
        paddingRight: "10px"
    });

    // 4. Populate Items
    const images = widget.options.values || [];
    
    // Sort images? They should be sorted from Python
    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'];

    images.forEach(filename => {
        // Filter out non-image files
        if (!supportedExtensions.some(ext => filename.toLowerCase().endsWith(ext))) {
            return;
        }

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

        if (widget.value === filename) {
            item.style.borderColor = "#4CAF50";
            item.style.backgroundColor = "#2e3b2e";
        }

        item.onmouseenter = () => item.style.backgroundColor = "#333";
        item.onmouseleave = () => {
            if (widget.value === filename) item.style.backgroundColor = "#2e3b2e";
            else item.style.backgroundColor = "#222";
        };

        const img = document.createElement("img");
        img.src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input`);
        img.alt = filename;
        Object.assign(img.style, {
            width: "100%",
            height: "140px",
            objectFit: "contain",
            marginBottom: "8px",
            borderRadius: "4px"
        });
        
        // Handle image load error
        img.onerror = () => {
            img.src = ""; // Clear or set placeholder
            img.alt = "Failed to load";
        };

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

        item.onclick = () => {
            widget.value = filename;
            if (widget.callback) widget.callback(filename);
            
            // Trigger node update/preview
            node.setDirtyCanvas(true, true);
            
            document.body.removeChild(overlay);
        };

        container.appendChild(item);
    });

    overlay.appendChild(container);
    
    // Close on Escape
    const escListener = (e) => {
        if (e.key === "Escape") {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            document.removeEventListener("keydown", escListener);
        }
    };
    document.addEventListener("keydown", escListener);
    
    // Cleanup listener when removed
    // (A bit hacky, but overlay is removed by logic above)

    document.body.appendChild(overlay);
}
