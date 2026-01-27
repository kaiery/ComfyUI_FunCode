from .any_llm_node import AnyLLMFunCodeNode

# 节点类映射
# Key: 节点在 ComfyUI 内部的唯一标识符（通常使用类名字符串）
# Value: 对应的 Python 类
NODE_CLASS_MAPPINGS = {
    "AnyLLMFunCodeNode": AnyLLMFunCodeNode
}

# 节点显示名称映射（可选）
# Key: 必须与 NODE_CLASS_MAPPINGS 中的 Key 对应
# Value: 在 ComfyUI 界面上显示的名称
NODE_DISPLAY_NAME_MAPPINGS = {
    "AnyLLMFunCodeNode": "Any LLM FunCode"
}
