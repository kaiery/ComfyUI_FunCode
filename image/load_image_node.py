import os
import folder_paths
from PIL import Image, ImageOps
import numpy as np
import torch

try:
    import aiohttp.web
    from server import PromptServer

    @PromptServer.instance.routes.post("/funcode/input_files_mtime")
    async def funcode_input_files_mtime(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}

        filenames = payload.get("filenames")
        if not isinstance(filenames, list):
            filenames = []

        input_dir = folder_paths.get_input_directory()
        input_dir_norm = os.path.normpath(input_dir)

        mtimes = {}
        for name in filenames:
            if not isinstance(name, str) or not name:
                continue
            if os.path.isabs(name) or ":" in name:
                continue
            normalized = os.path.normpath(name)
            parts = normalized.replace("\\", "/").split("/")
            if any(p == ".." for p in parts):
                continue
            full_path = os.path.normpath(os.path.join(input_dir_norm, normalized))
            try:
                if os.path.commonpath([input_dir_norm, full_path]) != input_dir_norm:
                    continue
            except Exception:
                continue
            if not os.path.isfile(full_path):
                continue
            try:
                mtimes[name] = os.path.getmtime(full_path)
            except Exception:
                continue

        return aiohttp.web.json_response({"mtimes": mtimes})
except Exception:
    pass

class LoadImageFunCodeNode:
    @classmethod
    def INPUT_TYPES(s):
        # 输入目录内的图片列表
        input_dir = folder_paths.get_input_directory()
        # 过滤子目录，避免非法项
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        
        # 仅保留支持的图片格式
        valid_extensions = {'.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'}
        files = [f for f in files if os.path.splitext(f)[1].lower() in valid_extensions]
        
        # 只暴露图片选择，不在节点面板显示预览尺寸
        return {"required":
                    {"image": (sorted(files), {"image_upload": True})},
                }

    CATEGORY = "FunCode/Image"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"

    def load_image(self, image):
        # 读取原图并处理 EXIF 方向
        image_path = folder_paths.get_annotated_filepath(image)
        # 打开图片并保持 PIL 对象供后续通道判断
        i = Image.open(image_path)
        i = ImageOps.exif_transpose(i)
        # 转 RGB 并归一化到 0~1
        image = i.convert("RGB")
        image = np.array(image).astype(np.float32) / 255.0
        # ComfyUI 期望的批次维度
        image = torch.from_numpy(image)[None,]
        # 生成 alpha 反相遮罩
        if 'A' in i.getbands():
            # alpha 通道 0~1，并转为反相掩码
            mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
            mask = 1. - torch.from_numpy(mask)
            # 增加 batch 维度 (1, H, W)
            mask = mask.unsqueeze(0)
        else:
            # 无 alpha 时返回默认空遮罩，大小需与 image 一致 (1, H, W)
            # image shape is (1, H, W, 3)
            mask = torch.zeros((1, image.shape[1], image.shape[2]), dtype=torch.float32, device="cpu")
        return (image, mask)

    @classmethod
    def IS_CHANGED(s, image):
        # 以文件更新时间判断变更
        image_path = folder_paths.get_annotated_filepath(image)
        m = os.path.getmtime(image_path)
        return m

    @classmethod
    def VALIDATE_INPUTS(s, image):
        # 校验图片文件是否存在
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True
