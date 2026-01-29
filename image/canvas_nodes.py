import os
import json
import base64
from io import BytesIO
import numpy as np
import torch
from PIL import Image
import folder_paths

try:
    import aiohttp.web
    from server import PromptServer

    if not hasattr(PromptServer.instance, '_funcode_canvas_storage'):
        PromptServer.instance._funcode_canvas_storage = {}

    @PromptServer.instance.routes.post("/funcode/canvas_export")
    async def funcode_canvas_export(request):
        data = await request.json()
        node_id = data.get('node_id')
        image_b64 = data.get('image_b64')
        if not node_id or not image_b64:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]
        try:
            img_bytes = base64.b64decode(image_b64)
            with BytesIO(img_bytes) as bio:
                img = Image.open(bio)
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                arr = np.array(img).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]
        except Exception:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        storage = PromptServer.instance._funcode_canvas_storage
        info = storage.get(node_id)
        if not info:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        info["image"] = tensor
        info["event"].set()
        return aiohttp.web.json_response({"status": "ok"})

    @PromptServer.instance.routes.post("/funcode/canvas_save")
    async def funcode_canvas_save(request):
        data = await request.json()
        image_b64 = data.get('image_b64')
        filename = data.get('filename') or "canvas.png"
        if not image_b64:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]
        try:
            img_bytes = base64.b64decode(image_b64)
            img = Image.open(BytesIO(img_bytes))
        except Exception:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, "FunCodeCanvas")
        os.makedirs(target_dir, exist_ok=True)
        safe_name = os.path.basename(filename)
        path = os.path.join(target_dir, safe_name)
        try:
            img.save(path, format="PNG")
        except Exception:
            return aiohttp.web.json_response({"status": "error"}, status=500)
        return aiohttp.web.json_response({"status": "ok", "path": f"FunCodeCanvas/{safe_name}"})

    @PromptServer.instance.routes.get("/funcode/canvas_list")
    async def funcode_canvas_list(request):
        input_dir = folder_paths.get_input_directory()
        target_dir = os.path.join(input_dir, "FunCodeCanvas")
        if not os.path.isdir(target_dir):
            return aiohttp.web.json_response({"files": []})
        exts = {'.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'}
        names = []
        for f in os.listdir(target_dir):
            p = os.path.join(target_dir, f)
            if os.path.isfile(p) and os.path.splitext(f)[1].lower() in exts:
                names.append(f"FunCodeCanvas/{f}")
        return aiohttp.web.json_response({"files": sorted(names)})

    @PromptServer.instance.routes.get("/funcode/canvas_payload")
    async def funcode_canvas_payload(request):
        node_id = request.query.get('node_id')
        if not node_id:
            return aiohttp.web.json_response({"status": "error"}, status=400)
        storage = PromptServer.instance._funcode_canvas_storage
        info = storage.get(node_id)
        payload = info.get("payload") if info else None
        return aiohttp.web.json_response({"status": "ok", "payload": payload})
except Exception:
    pass


def _tensor_to_b64(t):
    if len(t.shape) == 3:
        t = t.unsqueeze(0)
    arr = np.clip(t[0].cpu().numpy() * 255, 0, 255).astype(np.uint8)
    if arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=-1)
    buf = BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


class CanvasDataFunCodeNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bg_image": ("IMAGE",),
            },
            "optional": {
                "overlay1": ("IMAGE",),
                "overlay2": ("IMAGE",),
                "overlay3": ("IMAGE",),
                "overlay4": ("IMAGE",),
                "overlay5": ("IMAGE",),
                "overlay6": ("IMAGE",),
                "overlay7": ("IMAGE",),
                "overlay8": ("IMAGE",),
                "overlay9": ("IMAGE",),
                "overlay10": ("IMAGE",),
            }
        }

    CATEGORY = "FunCode/Canvas"
    RETURN_TYPES = ("CANVAS_DATA",)
    RETURN_NAMES = ("canvas_data",)
    FUNCTION = "build"

    def build(self, bg_image, **kwargs):
        data = {"background": None, "layers": []}
        bi = _tensor_to_b64(bg_image)
        h = int(bg_image.shape[1])
        w = int(bg_image.shape[2])
        data["background"] = {"id": 0, "image": bi, "size": {"height": h, "width": w}}
        for k, v in kwargs.items():
            if v is None:
                continue
            if not k.startswith("overlay"):
                continue
            # Handle both "overlay_1" (legacy) and "overlay1" (new) just in case, 
            # but strictly we are moving to "overlay1"
            try:
                if "_" in k:
                    lid = int(k.split("_")[1])
                else:
                    lid = int(k.replace("overlay", ""))
            except ValueError:
                continue
                
            vi = _tensor_to_b64(v)
            lh = int(v.shape[1])
            lw = int(v.shape[2])
            data["layers"].append({"id": lid, "image": vi, "size": {"height": lh, "width": lw}})
        data["layers"].sort(key=lambda x: x["id"])
        return (json.dumps(data),)


class CanvasEditorFunCodeNode:
    def __init__(self):
        self.node_id = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"unique_id": "UNIQUE_ID"},
            "optional": {
                "canvas_data": ("CANVAS_DATA", {"forceInput": True}),
            }
        }

    CATEGORY = "FunCode/Canvas"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "canvas_execute"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, unique_id, **kwargs):
        storage = PromptServer.instance._funcode_canvas_storage
        info = storage.get(unique_id)
        if info and "last_update" in info:
            return float(info["last_update"])
        return float("nan")

    def canvas_execute(self, unique_id, canvas_data=None):
        try:
            from threading import Event
            self.node_id = unique_id
            event = Event()
            storage = PromptServer.instance._funcode_canvas_storage
            storage[unique_id] = {"event": event, "image": None, "payload": None}
            payload = None
            if canvas_data:
                try:
                    payload = json.loads(canvas_data)
                except Exception:
                    payload = None
            storage[unique_id]["payload"] = payload
            PromptServer.instance.send_sync("funcode_canvas_update", {"node_id": unique_id, "canvas_data": payload})
            if not event.wait(timeout=30):
                return None
            info = storage.get(unique_id)
            img = info.get("image") if info else None
            return img, 
        except Exception:
            return None,
