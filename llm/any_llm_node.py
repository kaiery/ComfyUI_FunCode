import base64
import io
import json
import os
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

_env_loaded_paths = set()
_env_mtimes = {}
_custom_profile_label = "自定义"
_default_profile_label = "默认配置"


def load_env_file(env_path):
    global _env_loaded_paths
    global _env_mtimes
    if not os.path.exists(env_path):
        _env_loaded_paths.add(env_path)
        _env_mtimes[env_path] = None
        return
    mtime = os.path.getmtime(env_path)
    if env_path in _env_loaded_paths and _env_mtimes.get(env_path) == mtime:
        return

    # Clean up old LLM_PROFILE_ configurations before reloading
    for key in list(os.environ.keys()):
        if key.startswith("LLM_PROFILE_"):
            del os.environ[key]

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'").strip("`").strip()
            if key:
                os.environ[key] = value
    _env_loaded_paths.add(env_path)
    _env_mtimes[env_path] = mtime


def env_default(key, fallback=""):
    return os.environ.get(key, fallback)


def collect_profiles():
    profiles = {}
    for key, value in os.environ.items():
        if not key.startswith("LLM_PROFILE_"):
            continue
        rest = key[len("LLM_PROFILE_"):]
        if "_" not in rest:
            continue
        profile_id, field = rest.split("_", 1)
        field = field.upper()
        profiles.setdefault(profile_id, {})[field] = value
    labels = []
    mapping = {}
    for profile_id, data in profiles.items():
        if "API_BASE" not in data and "MODEL" not in data:
            continue
        label = data.get("LABEL") or profile_id
        mapping[label] = {
            "api_base": data.get("API_BASE", ""),
            "api_key": data.get("API_KEY", ""),
            "model": data.get("MODEL", ""),
        }
        labels.append(label)
    labels.sort()
    return labels, mapping


def _prompts_dir():
    return os.path.join(os.path.dirname(__file__), "system_prompts")


def collect_system_prompts():
    directory = _prompts_dir()
    try:
        os.makedirs(directory, exist_ok=True)
    except Exception:
        pass
    labels = []
    mapping = {}
    try:
        for name in sorted(os.listdir(directory)):
            path = os.path.join(directory, name)
            if not os.path.isfile(path):
                continue
            lower = name.lower()
            if not (lower.endswith(".md") or lower.endswith(".txt")):
                continue
            label = os.path.splitext(name)[0]
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                if content:
                    labels.append(label)
                    mapping[label] = content
            except Exception:
                continue
    except Exception:
        pass
    return labels, mapping


def image_to_data_url(image):
    try:
        import torch
    except Exception:
        torch = None
    if image is None:
        return None
    tensor = image
    if torch is not None and isinstance(image, torch.Tensor):
        tensor = image
    if hasattr(tensor, "dim") and tensor.dim() == 4:
        tensor = tensor[0]
    if hasattr(tensor, "detach"):
        tensor = tensor.detach().cpu().numpy()
    if not isinstance(tensor, np.ndarray):
        return None
    if tensor.dtype != np.uint8:
        tensor = (tensor * 255.0).clip(0, 255).astype(np.uint8)
    if tensor.ndim == 3 and tensor.shape[2] == 3:
        mode = "RGB"
    elif tensor.ndim == 3 and tensor.shape[2] == 4:
        mode = "RGBA"
    elif tensor.ndim == 2 or (tensor.ndim == 3 and tensor.shape[2] == 1):
        mode = "L"
        if tensor.ndim == 3:
            tensor = tensor[:, :, 0]
    else:
        return None
    img = Image.fromarray(tensor, mode)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return "data:image/png;base64," + encoded


def build_messages(system_prompt, user_prompt, image_data_url):
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if image_data_url:
        content = []
        if user_prompt:
            content.append({"type": "text", "text": user_prompt})
        content.append({"type": "image_url", "image_url": {"url": image_data_url}})
        messages.append({"role": "user", "content": content})
    elif user_prompt:
        messages.append({"role": "user", "content": user_prompt})
    return messages


def normalize_api_url(api_base):
    if api_base.endswith("/v1"):
        return api_base + "/chat/completions"
    if api_base.endswith("/v1/"):
        return api_base + "chat/completions"
    if api_base.endswith("/v2"):
        return api_base + "/chat/completions"
    if api_base.endswith("/v2/"):
        return api_base + "chat/completions"
    if api_base.endswith("/v3"):
        return api_base + "/chat/completions"
    if api_base.endswith("/v3/"):
        return api_base + "chat/completions"
    return api_base


def call_llm(api_base, api_key, model, system_prompt, user_prompt, image, temperature, top_p, max_tokens, timeout, seed=None):
    url = normalize_api_url(api_base)
    
    # Explicitly handle image processing
    image_data_url = None
    if image is not None:
        image_data_url = image_to_data_url(image)
        
    messages = build_messages(system_prompt, user_prompt, image_data_url)
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
    }
    if seed is not None:
        payload["seed"] = seed
    if max_tokens and max_tokens > 0:
        payload["max_tokens"] = max_tokens
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    try:
        parsed = json.loads(raw)
    except Exception:
        return raw
    choices = parsed.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        message = first.get("message")
        if isinstance(message, dict) and "content" in message:
            return message.get("content") or ""
        if "text" in first:
            return first.get("text") or ""
    return raw


class AnyLLMFunCodeNode:
    @classmethod
    def INPUT_TYPES(cls):
        # Look for .env in the parent directory (package root)
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        load_env_file(env_path)
        labels, mapping = collect_profiles()
        default_key = env_default("LLM_API_KEY", "")
        default_base = env_default("LLM_API_BASE", "")
        default_model = env_default("LLM_MODEL", "")
        profile_choices = [_default_profile_label, _custom_profile_label] + labels
        prompt_labels, _prompt_mapping = collect_system_prompts()
        system_prompt_choices = ["custom"] + prompt_labels
        return {
            "required": {
                "profile": (profile_choices,),
                "api_base": ("STRING", {"default": ""}),
                "api_key": ("STRING", {"default": ""}),
                "model": ("STRING", {"default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "system_prompt_select": (system_prompt_choices,),
                "system_prompt": ("STRING", {"multiline": True, "default": ""}),
                "user_prompt": ("STRING", {"multiline": True, "default": ""}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01}),
                "top_p": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "max_tokens": ("INT", {"default": 2048, "min": 1, "max": 8192, "step": 1}),
                "timeout": ("INT", {"default": 60, "min": 1, "max": 600, "step": 1}),
            },
            "optional": {"image": ("IMAGE",)},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "FunCode/LLM"

    def run(self, profile, api_base, api_key, model, seed, system_prompt_select, system_prompt, user_prompt, temperature, top_p, max_tokens, timeout, image=None):
        # Look for .env in the parent directory (package root)
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        load_env_file(env_path)
        labels, mapping = collect_profiles()
        default_base = env_default("LLM_API_BASE", "")
        default_key = env_default("LLM_API_KEY", "")
        default_model = env_default("LLM_MODEL", "")

        # 1. Determine base config from Profile
        config_base = ""
        config_key = ""
        config_model = ""

        if profile == _default_profile_label:
            config_base = default_base
            config_key = default_key
            config_model = default_model
        elif profile in mapping:
            profile_data = mapping[profile]
            config_base = profile_data.get("api_base", "")
            config_key = profile_data.get("api_key", "")
            config_model = profile_data.get("model", "")
        
        # 2. Apply UI overrides (if provided)
        # If UI field is NOT empty, it overrides the profile config
        # If UI field IS empty, we use the profile config
        final_base = api_base if api_base else config_base
        final_key = api_key if api_key else config_key
        final_model = model if model else config_model

        if not final_base or not final_model:
            return ("ERROR: api_base and model are required (configure in .env or enter manually)",)

        try:
            prompt_labels, prompt_mapping = collect_system_prompts()
            if system_prompt_select != "custom" and system_prompt_select in prompt_mapping:
                system_prompt = prompt_mapping[system_prompt_select]
            result = call_llm(final_base, final_key, final_model, system_prompt, user_prompt, image, temperature, top_p, max_tokens, timeout, seed)
            return (result,)
        except Exception as e:
            return ("ERROR: " + type(e).__name__ + ": " + str(e),)
