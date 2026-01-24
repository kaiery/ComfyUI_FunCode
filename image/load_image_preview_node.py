import os
import folder_paths
from PIL import Image, ImageOps
import numpy as np
import torch

class LoadImagePreviewNode:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        
        # Filter for supported image extensions
        valid_extensions = {'.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff', '.gif'}
        files = [f for f in files if os.path.splitext(f)[1].lower() in valid_extensions]
        
        return {"required":
                    {"image": (sorted(files), {"image_upload": True})},
                }

    CATEGORY = "FunCode/Image"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"

    def load_image(self, image):
        image_path = folder_paths.get_annotated_filepath(image)
        i = Image.open(image_path)
        i = ImageOps.exif_transpose(i)
        image = i.convert("RGB")
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image)[None,]
        if 'A' in i.getbands():
            mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
            mask = 1. - torch.from_numpy(mask)
        else:
            mask = torch.zeros((64,64), dtype=torch.float32, device="cpu")
        return (image, mask)

    @classmethod
    def IS_CHANGED(s, image):
        image_path = folder_paths.get_annotated_filepath(image)
        m = os.path.getmtime(image_path)
        return m

    @classmethod
    def VALIDATE_INPUTS(s, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True
