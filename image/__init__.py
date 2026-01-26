from .load_image_node import LoadImageFunCodeNode
from .color_match_node import ColorMatchFunCodeNode
from .empty_latent_node import EmptyLatentFunCodeNode

NODE_CLASS_MAPPINGS = {
    "LoadImageFunCodeNode": LoadImageFunCodeNode,
    "ColorMatchFunCodeNode": ColorMatchFunCodeNode,
    "EmptyLatentFunCodeNode": EmptyLatentFunCodeNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageFunCodeNode": "Load Image FunCode",
    "ColorMatchFunCodeNode": "Color Match FunCode",
    "EmptyLatentFunCodeNode": "Empty Latent FunCode"
}
