import torch


RESOLUTION_PRESETS = [
    ("custom", None),
    ("FHD - 1080\u00d71920 - [1080P]", (1080, 1920)),
    ("QHD - 1440\u00d72560 - [2K]", (1440, 2560)),
    ("4K UHD - 2160\u00d73840 - [4K]", (2160, 3840)),
    ("Flux - 1024\u00d71024 - [1:1]", (1024, 1024)),
    ("Flux - 768\u00d71280 - [3:5]", (768, 1280)),
    ("Flux - 768\u00d71344 - [9:16]", (768, 1344)),
    ("Flux - 832\u00d71216 - [2:3]", (832, 1216)),
    ("Flux - 832\u00d71152 - [13:18]", (832, 1152)),
    ("Flux - 896\u00d71152 - [7:9]", (896, 1152)),
    ("Flux - 1024\u00d71536 - [2:3]", (1024, 1536)),
    ("Flux - 768\u00d71536 - [1:2]", (768, 1536)),
    ("Flux - 896\u00d71536 - [7:12]", (896, 1536)),
    ("Qwen - 1328\u00d71328 - [1:1]", (1328, 1328)),
    ("Qwen - 928\u00d71664 - [9:16]", (928, 1664)),
    ("Qwen - 1104\u00d71472 - [3:4]", (1104, 1472)),
    ("Qwen - 1056\u00d71584 - [2:3]", (1056, 1584)),
    ("ZIT 1024 - 1024\u00d71024 - [1:1]", (1024, 1024)),
    ("ZIT 1024 - 896\u00d71152 - [7:9]", (896, 1152)),
    ("ZIT 1024 - 864\u00d71152 - [3:4]", (864, 1152)),
    ("ZIT 1024 - 832\u00d71248 - [2:3]", (832, 1248)),
    ("ZIT 1024 - 720\u00d71280 - [9:16]", (720, 1280)),
    ("ZIT 1024 - 576\u00d71344 - [9:21]", (576, 1344)),
    ("ZIT 1280 - 1280\u00d71280 - [1:1]", (1280, 1280)),
    ("ZIT 1280 - 1120\u00d71440 - [7:9]", (1120, 1440)),
    ("ZIT 1280 - 1104\u00d71472 - [3:4]", (1104, 1472)),
    ("ZIT 1280 - 1024\u00d71536 - [2:3]", (1024, 1536)),
    ("ZIT 1280 - 864\u00d71536 - [9:16]", (864, 1536)),
    ("ZIT 1280 - 720\u00d71680 - [9:21]", (720, 1680)),
    ("ZIT 1536 - 1536\u00d71536 - [1:1]", (1536, 1536)),
    ("ZIT 1536 - 1344\u00d71728 - [7:9]", (1344, 1728)),
    ("ZIT 1536 - 1296\u00d71728 - [3:4]", (1296, 1728)),
    ("ZIT 1536 - 1248\u00d71872 - [2:3]", (1248, 1872)),
    ("ZIT 1536 - 1152\u00d72048 - [9:16]", (1152, 2048)),
    ("ZIT 1536 - 864\u00d72016 - [9:21]", (864, 2016)),
    ("SDXL - 1024\u00d71024 - [1:1]", (1024, 1024)),
    ("SDXL - 768\u00d7768 - [1:1]", (768, 768)),
    ("SDXL - 768\u00d71280 - [3:5]", (768, 1280)),
    ("SDXL - 768\u00d71152 - [2:3]", (768, 1152)),
    ("SDXL - 864\u00d71152 - [3:4]", (864, 1152)),
    ("SDXL - 768\u00d71360 - [9:16]", (768, 1360)),
    ("SDXL - 896\u00d71152 - [7:9]", (896, 1152)),
    ("SDXL - 832\u00d71152 - [13:18]", (832, 1152)),
    ("SDXL - 832\u00d71216 - [13:19]", (832, 1216)),
    ("SDXL - 768\u00d71344 - [4:7]", (768, 1344)),
    ("SDXL - 640\u00d71536 - [5:12]", (640, 1536)),
    ("SDXL - 768\u00d71536 - [1:2]", (768, 1536)),
    ("SDXL - 896\u00d71536 - [7:12]", (896, 1536)),
    ("Wan2.2 - 544\u00d7960 - [9:16]", (544, 960)),
    ("Wan2.2 - 720\u00d71280 - [9:16]", (720, 1280)),
    ("Wan2.2 - 480\u00d7832 - [15:26]", (480, 832)),
    ("SD1.5 - 512\u00d7512 - [1:1]", (512, 512)),
    ("SD1.5 - 768\u00d7768 - [1:1]", (768, 768)),
    ("SD1.5 - 512\u00d7768 - [2:3]", (512, 768)),
    ("SD1.5 - 576\u00d7768 - [3:4]", (576, 768)),
    ("SD1.5 - 512\u00d7912 - [9:16]", (512, 912)),
]


class EmptyLatentFunCodeNode:
    @classmethod
    def INPUT_TYPES(cls):
        labels = [label for label, _ in RESOLUTION_PRESETS]
        return {
            "required": {
                "resolution": (labels,),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64, "step": 1}),
                "width_override": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 1}),
                "height_override": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 1}),
                "invert": ("BOOLEAN", {"default": False}),
            }
        }

    CATEGORY = "FunCode/Image"
    RETURN_TYPES = ("LATENT", "INT", "INT")
    RETURN_NAMES = ("latent", "width", "height")
    FUNCTION = "generate"

    def generate(self, resolution, batch_size, width_override, height_override, invert):
        if resolution == "custom":
            width, height = int(width_override), int(height_override)
        else:
            width, height = None, None
            for label, size in RESOLUTION_PRESETS:
                if label == resolution:
                    width, height = size
                    break
            if width is None or height is None:
                raise ValueError("EmptyLatentNode: invalid resolution selection")

        if invert:
            width, height = height, width

        width = int(width)
        height = int(height)
        if width <= 0 or height <= 0:
            raise ValueError("EmptyLatentNode: width and height must be positive")

        try:
            import comfy.model_management as model_management

            device = model_management.get_torch_device()
        except Exception:
            device = torch.device("cpu")

        latent = torch.zeros(
            (int(batch_size), 4, height // 8, width // 8),
            dtype=torch.float32,
            device=device,
        )
        return ({"samples": latent, "downscale_ratio_spacial": 8}, width, height)
