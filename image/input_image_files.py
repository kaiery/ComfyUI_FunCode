"""Directory browsing and image operations, confined to the input directory tree."""

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


def _validate_component(name):
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
    device = name.split(".")[0].upper()
    if device in {"CON", "PRN", "AUX", "NUL"} or re.fullmatch(r"(?:COM|LPT)[0-9¹²³]", device):
        raise ImageFileError("This filename is reserved by the operating system.")
    if name.casefold() == TRASH_DIRECTORY:
        raise ImageFileError("The gallery trash directory is private.", 403)
    return name


def _validate_filename(name):
    _validate_component(name)
    stem, extension = os.path.splitext(name)
    if not stem.strip() or extension.lower() not in IMAGE_EXTENSIONS:
        raise ImageFileError("A supported image extension is required.")
    return name


def _plain_child(directory, name):
    path = os.path.join(directory, name)
    # Resolve the input root once; reject links/junctions below it.
    if os.path.islink(path) or os.path.normcase(os.path.realpath(path)) != os.path.normcase(path):
        raise ImageFileError("Symbolic links and redirected paths cannot be accessed by the gallery.")
    return path


def _source_image(input_dir, filename):
    root, source = _input_path(input_dir, filename)
    _validate_filename(filename.rsplit("/", 1)[-1])
    if not os.path.isfile(source):
        raise ImageFileError("The image no longer exists. Refresh the gallery.", 404)
    return root, source


def _input_path(input_dir, relative, allow_root=False):
    if not isinstance(relative, str) or (not relative and not allow_root):
        raise ImageFileError("Expected a path relative to input.")
    root = os.path.realpath(os.path.abspath(input_dir))
    path = root
    if relative:
        for component in relative.split("/"):
            _validate_component(component)
            path = _plain_child(path, component)
    return root, path


def list_input_directory(input_dir, directory=""):
    """Read one level only; return canonical input-relative paths and image mtimes."""
    _, path = _input_path(input_dir, directory, allow_root=True)
    if not os.path.isdir(path):
        raise ImageFileError("The directory no longer exists. Return to its parent.", 404)
    directories, filenames, mtimes = [], [], {}
    with os.scandir(path) as entries:
        for entry in entries:
            try:
                _validate_component(entry.name)
                _plain_child(path, entry.name)
                relative = f"{directory}/{entry.name}" if directory else entry.name
                if entry.is_dir(follow_symlinks=False):
                    directories.append(relative)
                elif entry.is_file(follow_symlinks=False) and os.path.splitext(entry.name)[1].lower() in IMAGE_EXTENSIONS:
                    _validate_filename(entry.name)
                    mtimes[relative] = entry.stat(follow_symlinks=False).st_mtime
                    filenames.append(relative)
            except (ImageFileError, OSError):
                # A file may disappear during scanning; don't expose links or private trash.
                continue
    return {"directory": directory, "directories": sorted(directories), "files": sorted(filenames), "mtimes": mtimes}


def list_input_image_paths(input_dir):
    """Populate the node combo once, including paths saved in nested workflows."""
    pending, filenames = [""], []
    while pending:
        try:
            listing = list_input_directory(input_dir, pending.pop())
        except (ImageFileError, OSError):
            continue
        pending.extend(listing["directories"])
        filenames.extend(listing["files"])
    return sorted(filenames)


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
    _, source = _source_image(input_dir, filename)
    _validate_filename(new_name)
    if os.path.splitext(filename)[1] != os.path.splitext(new_name)[1]:
        raise ImageFileError("Keep the original image extension.")
    target = _plain_child(os.path.dirname(source), new_name)
    parent = filename.rpartition("/")[0]
    relative = f"{parent}/{new_name}" if parent else new_name
    if filename != relative:
        if os.path.lexists(target):
            raise ImageFileError("A file with that name already exists.", 409)
        _move_without_overwrite(source, target)
    return {"filename": relative, "mtime": os.path.getmtime(target)}


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
        _move_without_overwrite(source, os.path.join(entry, os.path.basename(source)))
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
    filename = metadata.get("filename")
    _, target = _input_path(root, filename)
    basename = _validate_filename(filename.rsplit("/", 1)[-1])
    source = _plain_child(entry, basename)
    if not os.path.isfile(source):
        raise ImageFileError("The deleted image is no longer available.", 404)
    if not os.path.isdir(os.path.dirname(target)):
        raise ImageFileError("The original directory no longer exists. Recreate it before restoring.", 404)
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
