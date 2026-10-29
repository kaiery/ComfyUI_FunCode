import os
import asyncio
import logging
import folder_paths
from PIL import Image, ImageOps
import numpy as np
import torch
from .input_image_files import (
    ImageFileError,
    rename_input_image,
    delete_input_image,
    restore_input_image,
    list_input_directory,
    list_input_image_paths,
)

try:
    import aiohttp.web
    from server import PromptServer

    async def _gallery_file_operation(request, operation, fields):
        try:
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ImageFileError("Expected a JSON object.")
            result = await asyncio.to_thread(
                operation, folder_paths.get_input_directory(),
                *(payload.get(field) for field in fields),
            )
            return aiohttp.web.json_response(result)
        except ImageFileError as error:
            return aiohttp.web.json_response({"error": str(error)}, status=error.status)
        except (ValueError, TypeError):
            return aiohttp.web.json_response({"error": "Invalid request."}, status=400)
        except FileNotFoundError:
            return aiohttp.web.json_response({"error": "The image no longer exists. Refresh the gallery."}, status=404)
        except PermissionError:
            return aiohttp.web.json_response({"error": "The image is locked or permission was denied."}, status=403)
        except OSError:
            logging.exception("FunCode gallery file operation failed")
            return aiohttp.web.json_response({"error": "File operation failed. Check the ComfyUI log."}, status=500)

    @PromptServer.instance.routes.post("/funcode/input_image/rename")
    async def funcode_input_image_rename(request):
        return await _gallery_file_operation(request, rename_input_image, ("filename", "new_name"))

    @PromptServer.instance.routes.post("/funcode/input_image/delete")
    async def funcode_input_image_delete(request):
        return await _gallery_file_operation(request, delete_input_image, ("filename",))

    @PromptServer.instance.routes.post("/funcode/input_image/restore")
    async def funcode_input_image_restore(request):
        return await _gallery_file_operation(request, restore_input_image, ("token",))

    @PromptServer.instance.routes.get("/funcode/input_images")
    async def funcode_input_images(request):
        try:
            result = await asyncio.to_thread(
                list_input_directory, folder_paths.get_input_directory(), request.query.get("directory", ""),
            )
            return aiohttp.web.json_response(result, headers={"Cache-Control": "no-store"})
        except ImageFileError as error:
            return aiohttp.web.json_response({"error": str(error)}, status=error.status)
        except PermissionError:
            return aiohttp.web.json_response({"error": "Permission to read this directory was denied."}, status=403)
        except OSError:
            return aiohttp.web.json_response({"error": "Could not read this directory. Refresh or return to its parent."}, status=500)

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
        # 包含子目录的相对路径，使保存的工作流重新打开后仍能选择原文件。
        files = list_input_image_paths(folder_paths.get_input_directory())
        
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
