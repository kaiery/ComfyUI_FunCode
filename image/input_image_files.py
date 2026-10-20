"""File operations for the gallery, restricted to images in the input root."""

import datetime
import json
import os
import re
import uuid


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".gif"}
TRASH_DIRECTORY = ".funcode-trash"


class ImageFileError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _validate_filename(name):
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name) > 255
        or any(char in name for char in '/\\:<>"|?*')
        or any(ord(char) < 32 for char in name)
        or name.endswith((".", " "))
        or name in {".", ".."}
    ):
        raise ImageFileError("Use a filename without paths or reserved characters.")
    stem, extension = os.path.splitext(name)
    if not stem.strip() or extension.lower() not in IMAGE_EXTENSIONS:
        raise ImageFileError("A supported image extension is required.")
    device = stem.split(".")[0].upper()
    if device in {"CON", "PRN", "AUX", "NUL"} or re.fullmatch(r"(?:COM|LPT)[0-9¹²³]", device):
        raise ImageFileError("This filename is reserved by the operating system.")
    return name


def _plain_child(directory, name):
    path = os.path.join(directory, name)
    # Resolve the input root once; reject links/junctions below it.
    if os.path.islink(path) or os.path.normcase(os.path.realpath(path)) != os.path.normcase(path):
        raise ImageFileError("Symbolic links and redirected paths cannot be modified.")
    return path


def _source_image(input_dir, filename):
    root = os.path.realpath(os.path.abspath(input_dir))
    source = _plain_child(root, _validate_filename(filename))
    if not os.path.isfile(source):
        raise ImageFileError("The image no longer exists. Refresh the gallery.", 404)
    return root, source


def _move_without_overwrite(source, target):
    """Fail on an existing destination, including a destination created concurrently."""
    try:
        if os.name == "nt":
            os.rename(source, target)
        else:
            # POSIX rename would overwrite. Linking first reserves the target atomically.
            os.link(source, target, follow_symlinks=False)
            try:
                os.unlink(source)
            except OSError:
                os.unlink(target)
                raise
    except FileExistsError as error:
        raise ImageFileError("A file with that name already exists.", 409) from error


def rename_input_image(input_dir, filename, new_name):
    root, source = _source_image(input_dir, filename)
    _validate_filename(new_name)
    if os.path.splitext(filename)[1] != os.path.splitext(new_name)[1]:
        raise ImageFileError("Keep the original image extension.")
    target = _plain_child(root, new_name)
    if filename != new_name:
        if os.path.lexists(target):
            raise ImageFileError("A file with that name already exists.", 409)
        _move_without_overwrite(source, target)
    return {"filename": new_name, "mtime": os.path.getmtime(target)}


def _trash_root(input_dir, create=False):
    root = os.path.realpath(os.path.abspath(input_dir))
    trash = _plain_child(root, TRASH_DIRECTORY)
    if create:
        os.makedirs(trash, exist_ok=True)
    return root, trash


def delete_input_image(input_dir, filename):
    _, source = _source_image(input_dir, filename)
    _, trash = _trash_root(input_dir, create=True)
    token = uuid.uuid4().hex
    entry = os.path.join(trash, token)
    os.mkdir(entry)
    metadata_path = os.path.join(entry, "metadata.json")
    try:
        with open(metadata_path, "x", encoding="utf-8") as handle:
            json.dump({
                "filename": filename,
                "deleted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }, handle, ensure_ascii=False)
        _move_without_overwrite(source, os.path.join(entry, filename))
    except Exception:
        # Remove only our own empty entry; never recursively delete image data.
        if os.path.isfile(metadata_path):
            os.unlink(metadata_path)
        os.rmdir(entry)
        raise
    return {"filename": filename, "token": token}


def restore_input_image(input_dir, token):
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ImageFileError("Invalid restore token.")
    root, trash = _trash_root(input_dir)
    entry = _plain_child(trash, token)
    metadata_path = _plain_child(entry, "metadata.json")
    try:
        with open(metadata_path, encoding="utf-8") as handle:
            metadata = json.load(handle)
    except FileNotFoundError as error:
        raise ImageFileError("The deleted image is no longer available.", 404) from error
    if not isinstance(metadata, dict):
        raise ImageFileError("Invalid deleted image metadata.")
    filename = _validate_filename(metadata.get("filename"))
    source = _plain_child(entry, filename)
    if not os.path.isfile(source):
        raise ImageFileError("The deleted image is no longer available.", 404)
    target = _plain_child(root, filename)
    if os.path.lexists(target):
        raise ImageFileError("Restore would overwrite an existing file. Rename that file first.", 409)
    _move_without_overwrite(source, target)
    # A restored image is authoritative even if removing metadata fails.
    try:
        os.unlink(metadata_path)
        os.rmdir(entry)
    except OSError:
        pass
    return {"filename": filename, "mtime": os.path.getmtime(target)}
