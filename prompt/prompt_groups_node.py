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


def _path_segments(value):
    raw = str(value or "").replace("\\", "/")
    segments = [segment.strip() for segment in raw.split("/") if segment.strip()]
    if any(segment in (".", "..") or "\0" in segment for segment in segments):
        raise ValueError("Preset paths cannot contain '.', '..', or null characters.")
    return segments


def _normalize_preset_path(value):
    segments = _path_segments(value)
    if not segments:
        raise ValueError("Preset name is required.")
    return "/".join(segments)


def _normalize_folder_path(value):
    segments = _path_segments(value)
    if not segments:
        raise ValueError("Folder path is required.")
    return "/".join(segments)


def _preset_folder(path):
    segments = _path_segments(path)
    if len(segments) <= 1:
        return ""
    return "/".join(segments[:-1])


def _folder_parents(path):
    segments = _path_segments(path)
    parents = []
    for index in range(1, len(segments) + 1):
        parents.append("/".join(segments[:index]))
    return parents


def _add_parent_folders(folders, path):
    folder = _preset_folder(path)
    if not folder:
        return
    for parent in _folder_parents(folder):
        folders.add(parent)


def _clean_folder_list(folders):
    cleaned = set()
    if isinstance(folders, list):
        for folder in folders:
            try:
                cleaned.add(_normalize_folder_path(folder))
            except ValueError:
                continue
    return sorted(cleaned, key=lambda item: item.lower())


def _format_preset(path, text):
    segments = _path_segments(path)
    folder = "/".join(segments[:-1])
    return {
        "name": "/".join(segments),
        "path": "/".join(segments),
        "label": segments[-1],
        "folder": folder,
        "text": str(text or ""),
    }


def _clean_preset_list(presets):
    if isinstance(presets, dict):
        presets = [{"name": k, "text": v} for k, v in presets.items()]
    if not isinstance(presets, list):
        presets = []
    cleaned = []
    seen = set()
    for item in presets:
        if not isinstance(item, dict):
            continue
        raw_name = item.get("path") or item.get("name", "")
        try:
            name = _normalize_preset_path(raw_name)
        except ValueError:
            continue
        if name in seen:
            continue
        cleaned.append(_format_preset(name, item.get("text", "")))
        seen.add(name)
    cleaned.sort(key=lambda item: item["name"].lower())
    return cleaned


def _build_presets_payload(data=None):
    data = data if isinstance(data, dict) else {}
    presets = _clean_preset_list(data.get("presets"))
    folders = set(_clean_folder_list(data.get("folders")))
    for preset in presets:
        _add_parent_folders(folders, preset["name"])
    return {
        "version": 2,
        "folders": sorted(folders, key=lambda item: item.lower()),
        "presets": presets,
    }


def _read_presets():
    try:
        _ensure_presets_dir()
        if not os.path.exists(PRESETS_PATH):
            return _build_presets_payload()
        with open(PRESETS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return _build_presets_payload()
    return _build_presets_payload(data)


def _write_presets(data):
    _ensure_presets_dir()
    payload = _build_presets_payload(data)
    payload["presets"] = [
        {"name": preset["name"], "text": preset["text"]}
        for preset in payload["presets"]
    ]
    fd, tmp_path = tempfile.mkstemp(
        prefix="presets_",
        suffix=".json",
        dir=PRESETS_DIR,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, PRESETS_PATH)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _save_preset(name, text):
    name = _normalize_preset_path(name)
    text = str(text or "")
    data = _read_presets()
    presets = [p for p in data["presets"] if p["name"] != name]
    presets.append(_format_preset(name, text))
    presets.sort(key=lambda item: item["name"].lower())
    data["presets"] = presets
    folders = set(data.get("folders", []))
    _add_parent_folders(folders, name)
    data["folders"] = sorted(folders, key=lambda item: item.lower())
    _write_presets(data)
    return _read_presets()


def _delete_preset(name):
    name = _normalize_preset_path(name)
    data = _read_presets()
    data["presets"] = [p for p in data["presets"] if p["name"] != name]
    _write_presets(data)
    return _read_presets()


def _create_folder(path):
    folder = _normalize_folder_path(path)
    data = _read_presets()
    folders = set(data.get("folders", []))
    for parent in _folder_parents(folder):
        folders.add(parent)
    data["folders"] = sorted(folders, key=lambda item: item.lower())
    _write_presets(data)
    return _read_presets()


def _rename_folder(old_path, new_path):
    old_path = _normalize_folder_path(old_path)
    new_path = _normalize_folder_path(new_path)
    if old_path == new_path:
        return _read_presets()
    if new_path.startswith(f"{old_path}/"):
        raise ValueError("A folder cannot be renamed into its own child folder.")

    data = _read_presets()
    old_prefix = f"{old_path}/"
    existing_names = {preset["name"] for preset in data["presets"]}
    renamed_names = {}
    matched = old_path in set(data.get("folders", []))

    for preset in data["presets"]:
        name = preset["name"]
        if name.startswith(old_prefix):
            matched = True
            renamed_names[name] = f"{new_path}/{name[len(old_prefix):]}"

    if not matched:
        raise ValueError("Folder does not exist.")

    for old_name, next_name in renamed_names.items():
        if next_name in existing_names and next_name not in renamed_names:
            raise ValueError(f'Preset "{next_name}" already exists.')

    next_presets = []
    for preset in data["presets"]:
        name = renamed_names.get(preset["name"], preset["name"])
        next_presets.append(_format_preset(name, preset.get("text", "")))

    folders = set()
    for folder in data.get("folders", []):
        if folder == old_path:
            folders.add(new_path)
        elif folder.startswith(old_prefix):
            folders.add(f"{new_path}/{folder[len(old_prefix):]}")
        else:
            folders.add(folder)
    for parent in _folder_parents(new_path):
        folders.add(parent)
    for preset in next_presets:
        _add_parent_folders(folders, preset["name"])

    data["presets"] = next_presets
    data["folders"] = sorted(folders, key=lambda item: item.lower())
    _write_presets(data)
    return _read_presets()


def _delete_folder(path):
    folder = _normalize_folder_path(path)
    data = _read_presets()
    prefix = f"{folder}/"
    folders = set(data.get("folders", []))
    matched = folder in folders or any(preset["name"].startswith(prefix) for preset in data["presets"])
    if not matched:
        raise ValueError("Folder does not exist.")

    data["presets"] = [
        preset for preset in data["presets"]
        if not preset["name"].startswith(prefix)
    ]
    data["folders"] = sorted(
        [item for item in folders if item != folder and not item.startswith(prefix)],
        key=lambda item: item.lower(),
    )
    _write_presets(data)
    return _read_presets()


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

    @PromptServer.instance.routes.post("/funcode/prompt_group_presets/folder/create")
    async def funcode_prompt_group_preset_folder_create(request):
        try:
            data = await request.json()
            presets = _create_folder(data.get("path"))
            return aiohttp.web.json_response({"status": "ok", **presets})
        except ValueError as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=400)
        except Exception as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=500)

    @PromptServer.instance.routes.post("/funcode/prompt_group_presets/folder/rename")
    async def funcode_prompt_group_preset_folder_rename(request):
        try:
            data = await request.json()
            presets = _rename_folder(data.get("old_path"), data.get("new_path"))
            return aiohttp.web.json_response({"status": "ok", **presets})
        except ValueError as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=400)
        except Exception as exc:
            return aiohttp.web.json_response({"status": "error", "message": str(exc)}, status=500)

    @PromptServer.instance.routes.post("/funcode/prompt_group_presets/folder/delete")
    async def funcode_prompt_group_preset_folder_delete(request):
        try:
            data = await request.json()
            presets = _delete_folder(data.get("path"))
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
