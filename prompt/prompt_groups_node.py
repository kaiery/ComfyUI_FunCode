import json
import os
import tempfile


PRESETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompt_groups")
PRESETS_PATH = os.path.join(PRESETS_DIR, "presets.json")
MAX_EXTERNAL_GROUP_INPUTS = 50

DEFAULT_GROUPS_PAYLOAD = {
    "version": 1,
    "groups": [
        {
            "id": "group_1",
            "name": "Group 1",
            "input_slot": 1,
            "text": "",
            "enabled": True,
        }
    ],
}


def _ensure_presets_dir():
    os.makedirs(PRESETS_DIR, exist_ok=True)


def _read_presets():
    try:
        _ensure_presets_dir()
        if not os.path.exists(PRESETS_PATH):
            return {"version": 1, "presets": []}
        with open(PRESETS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"version": 1, "presets": []}
    if not isinstance(data, dict):
        return {"version": 1, "presets": []}
    presets = data.get("presets")
    if isinstance(presets, dict):
        presets = [{"name": k, "text": v} for k, v in presets.items()]
    if not isinstance(presets, list):
        presets = []
    cleaned = []
    seen = set()
    for item in presets:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name or name in seen:
            continue
        text = str(item.get("text", ""))
        cleaned.append({"name": name, "text": text})
        seen.add(name)
    cleaned.sort(key=lambda item: item["name"].lower())
    return {"version": 1, "presets": cleaned}


def _write_presets(data):
    _ensure_presets_dir()
    fd, tmp_path = tempfile.mkstemp(
        prefix="presets_",
        suffix=".json",
        dir=PRESETS_DIR,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, PRESETS_PATH)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _save_preset(name, text):
    name = str(name or "").strip()
    if not name:
        raise ValueError("Preset name is required.")
    text = str(text or "")
    data = _read_presets()
    presets = [p for p in data["presets"] if p["name"] != name]
    presets.append({"name": name, "text": text})
    presets.sort(key=lambda item: item["name"].lower())
    data["presets"] = presets
    _write_presets(data)
    return data


def _delete_preset(name):
    name = str(name or "").strip()
    if not name:
        raise ValueError("Preset name is required.")
    data = _read_presets()
    data["presets"] = [p for p in data["presets"] if p["name"] != name]
    _write_presets(data)
    return data


try:
    import aiohttp.web
    from server import PromptServer

    @PromptServer.instance.routes.get("/funcode/prompt_group_presets")
    async def funcode_prompt_group_presets(request):
        return aiohttp.web.json_response(_read_presets())

    @PromptServer.instance.routes.post("/funcode/prompt_group_presets/save")
    async def funcode_prompt_group_preset_save(request):
        try:
            data = await request.json()
            presets = _save_preset(data.get("name"), data.get("text"))
            return aiohttp.web.json_response({"status": "ok", **presets})
        except ValueError as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=400)
        except Exception as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=500)

    @PromptServer.instance.routes.post("/funcode/prompt_group_presets/delete")
    async def funcode_prompt_group_preset_delete(request):
        try:
            data = await request.json()
            presets = _delete_preset(data.get("name"))
            return aiohttp.web.json_response({"status": "ok", **presets})
        except ValueError as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=400)
        except Exception as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=500)
except Exception:
    pass


def _parse_payload(groups_json):
    if isinstance(groups_json, dict):
        return groups_json
    if not groups_json:
        return DEFAULT_GROUPS_PAYLOAD
    try:
        payload = json.loads(groups_json)
    except Exception:
        return DEFAULT_GROUPS_PAYLOAD
    if not isinstance(payload, dict):
        return DEFAULT_GROUPS_PAYLOAD
    return payload


def _normalize_group_text(text):
    lines = []
    for line in str(text or "").splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        lines.append(trimmed)
    normalized = "\n".join(lines)
    if normalized and not normalized.endswith((",", "\uff0c")):
        normalized += ","
    return normalized


def _group_input_slot(group, fallback):
    try:
        slot = int(group.get("input_slot", fallback))
    except Exception:
        slot = fallback
    if slot < 1 or slot > MAX_EXTERNAL_GROUP_INPUTS:
        return fallback
    return slot


def build_prompt_text(groups_json, external_texts=None):
    payload = _parse_payload(groups_json)
    external_texts = external_texts or {}
    groups = payload.get("groups", [])
    if not isinstance(groups, list):
        groups = []
    paragraphs = []
    for index, group in enumerate(groups, start=1):
        if not isinstance(group, dict):
            continue
        if group.get("enabled") is False:
            continue
        external_key = f"group_{_group_input_slot(group, index)}_text"
        raw_text = external_texts.get(external_key)
        if raw_text is None:
            raw_text = group.get("text", "")
        text = _normalize_group_text(raw_text)
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


class PromptGroupsFunCodeNode:
    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for index in range(1, MAX_EXTERNAL_GROUP_INPUTS + 1):
            optional[f"group_{index}_text"] = ("STRING", {"forceInput": True})
        return {
            "required": {
                "groups_json": (
                    "STRING",
                    {
                        "default": json.dumps(DEFAULT_GROUPS_PAYLOAD, ensure_ascii=False),
                        "multiline": True,
                    },
                ),
            },
            "optional": optional,
        }

    CATEGORY = "FunCode/Prompt"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "concatenate"

    def concatenate(self, groups_json, **kwargs):
        return (build_prompt_text(groups_json, kwargs),)
