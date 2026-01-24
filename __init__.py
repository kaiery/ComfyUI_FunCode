# 导入子模块中的节点映射
# 这里的逻辑是：每个子文件夹（如 llm, image）都维护自己的节点映射
# 根目录的 __init__.py 负责将它们汇总，暴露给 ComfyUI
from .llm import NODE_CLASS_MAPPINGS as LLM_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS as LLM_DISPLAY_MAPPINGS
from .image import NODE_CLASS_MAPPINGS as IMAGE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS as IMAGE_DISPLAY_MAPPINGS

# NODE_CLASS_MAPPINGS 是 ComfyUI 加载节点的关键字典
# Key (字符串): 在工作流 JSON 中使用的节点内部名称 (例如 "AnyLLMNode")
# Value (类): 对应的 Python 类
# 这里我们将 llm 和 image 模块的映射合并到一个字典中
NODE_CLASS_MAPPINGS = {
    **LLM_CLASS_MAPPINGS, 
    **IMAGE_CLASS_MAPPINGS
}

# NODE_DISPLAY_NAME_MAPPINGS 是可选的字典，用于自定义节点在 UI 中显示的名称
# Key (字符串): 必须与 NODE_CLASS_MAPPINGS 中的 Key 一致
# Value (字符串): 用户在 ComfyUI 界面上看到的名称 (例如 "Any LLM")
NODE_DISPLAY_NAME_MAPPINGS = {
    **LLM_DISPLAY_MAPPINGS, 
    **IMAGE_DISPLAY_MAPPINGS
}

# WEB_DIRECTORY 指定包含前端 JavaScript 文件的目录（相对于当前文件）
# ComfyUI 会自动加载该目录下的 .js 文件，通常用于扩展 UI 功能
WEB_DIRECTORY = "./js"

# __all__ 定义了当使用 `from ComfyUI_FunCode import *` 时导出的符号
# ComfyUI 主要查找 NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS 和 WEB_DIRECTORY
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
