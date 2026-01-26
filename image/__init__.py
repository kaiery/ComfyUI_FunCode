from .load_image_preview_node import LoadImagePreviewNode
from .color_match_node import ColorMatchNode

NODE_CLASS_MAPPINGS = {
    "LoadImagePreviewNode": LoadImagePreviewNode,
    "ColorMatchNode": ColorMatchNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImagePreviewNode": "Load Image Preview",
    "ColorMatchNode": "Color Match FunCode"
}
