import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


IMAGE_DIR = Path(__file__).resolve().parents[1] / "image"
spec = importlib.util.spec_from_file_location("gallery_files", IMAGE_DIR / "input_image_files.py")
files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(files)


class InputImageFileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "original.png"
        self.source.write_bytes(b"image-content")
        os.utime(self.source, (1700000000, 1700000000))

    def test_rename_keeps_contents_and_modification_time(self):
        result = files.rename_input_image(self.root, "original.png", "renamed.png")
        self.assertEqual(result, {"filename": "renamed.png", "mtime": 1700000000})
        self.assertFalse(self.source.exists())
        self.assertEqual((self.root / "renamed.png").read_bytes(), b"image-content")

    def test_listing_reads_one_level_and_excludes_private_trash(self):
        nested = self.root / "目录" / "第二层"
        nested.mkdir(parents=True)
        (nested.parent / "same.png").write_bytes(b"nested")
        (nested / "deep.png").write_bytes(b"deep")
        (self.root / "notes.txt").write_text("not an image")
        (self.root / files.TRASH_DIRECTORY).mkdir()
        (self.root / files.TRASH_DIRECTORY / "hidden.png").write_bytes(b"private")
        with patch.object(files.os, "scandir", wraps=os.scandir) as scan:
            root = files.list_input_directory(self.root)
            self.assertEqual(scan.call_count, 1)
        self.assertEqual(root["directories"], ["目录"])
        self.assertEqual(root["files"], ["original.png"])
        listing = files.list_input_directory(self.root, "目录")
        self.assertEqual(listing["directory"], "目录")
        self.assertEqual(listing["directories"], ["目录/第二层"])
        self.assertEqual(listing["files"], ["目录/same.png"])
        self.assertIn("目录/same.png", listing["mtimes"])
        self.assertEqual(files.list_input_image_paths(self.root), ["original.png", "目录/same.png", "目录/第二层/deep.png"])

    def test_nested_rename_delete_restore_keep_relative_path_and_other_namesakes(self):
        folder = self.root / "album" / "child"
        folder.mkdir(parents=True)
        (folder / "original.png").write_bytes(b"nested-content")
        result = files.rename_input_image(self.root, "album/child/original.png", "renamed.png")
        self.assertEqual(result["filename"], "album/child/renamed.png")
        self.assertEqual(self.source.read_bytes(), b"image-content")
        deleted = files.delete_input_image(self.root, result["filename"])
        entry = self.root / files.TRASH_DIRECTORY / deleted["token"]
        self.assertEqual((entry / "renamed.png").read_bytes(), b"nested-content")
        metadata = json.loads((entry / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["filename"], "album/child/renamed.png")
        restored = files.restore_input_image(self.root, deleted["token"])
        self.assertEqual(restored["filename"], "album/child/renamed.png")
        self.assertEqual((folder / "renamed.png").read_bytes(), b"nested-content")
        self.assertEqual(self.source.read_bytes(), b"image-content")

    def test_directory_traversal_and_private_trash_are_rejected(self):
        for directory in [None, [], "../outside", "album/../outside", "album\\child", "/absolute", "C:/input", "album//child", "album/.", ".funcode-trash", "album/.funcode-trash"]:
            with self.subTest(directory=directory):
                with self.assertRaises(files.ImageFileError):
                    files.list_input_directory(self.root, directory)
        with self.assertRaises(files.ImageFileError) as raised:
            files.list_input_directory(self.root, "missing")
        self.assertEqual(raised.exception.status, 404)

    def test_restoring_missing_parent_keeps_trash_until_parent_is_recreated(self):
        folder = self.root / "album"
        folder.mkdir()
        (folder / "photo.png").write_bytes(b"nested")
        deleted = files.delete_input_image(self.root, "album/photo.png")
        folder.rmdir()
        with self.assertRaises(files.ImageFileError) as raised:
            files.restore_input_image(self.root, deleted["token"])
        self.assertEqual(raised.exception.status, 404)
        folder.mkdir()
        files.restore_input_image(self.root, deleted["token"])
        self.assertEqual((folder / "photo.png").read_bytes(), b"nested")

    def test_rename_never_overwrites_existing_file(self):
        target = self.root / "existing.png"
        target.write_bytes(b"keep-this")
        with self.assertRaises(files.ImageFileError) as raised:
            files.rename_input_image(self.root, "original.png", "existing.png")
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(target.read_bytes(), b"keep-this")
        self.assertTrue(self.source.exists())

    def test_invalid_paths_names_extensions_and_payloads_are_rejected(self):
        invalid = [None, {}, [], "../outside.png", "..\\outside.png", "/tmp/x.png",
                   "C:x.png", "name.png:stream", "x.jpg", "x.png ", "NUL.png", "COM1.png",
                   "x?.png", "bad\x00.png", ".png", "", "x" * 256 + ".png"]
        for name in invalid:
            with self.subTest(name=name):
                with self.assertRaises(files.ImageFileError):
                    files.rename_input_image(self.root, "original.png", name)
        self.assertEqual(self.source.read_bytes(), b"image-content")
        for name in ["../original.png", "..\\original.png", None, "missing.png"]:
            with self.subTest(source=name):
                with self.assertRaises(files.ImageFileError):
                    files.delete_input_image(self.root, name)

    def test_delete_and_restore_preserve_file_and_record_original_name(self):
        result = files.delete_input_image(self.root, "original.png")
        self.assertFalse(self.source.exists())
        entry = self.root / files.TRASH_DIRECTORY / result["token"]
        self.assertEqual((entry / "original.png").read_bytes(), b"image-content")
        metadata = json.loads((entry / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["filename"], "original.png")
        self.assertIn("deleted_at", metadata)
        restored = files.restore_input_image(self.root, result["token"])
        self.assertEqual(restored["mtime"], 1700000000)
        self.assertEqual(self.source.read_bytes(), b"image-content")
        self.assertFalse(entry.exists())

    def test_restore_conflict_retains_both_files_and_allows_retry(self):
        result = files.delete_input_image(self.root, "original.png")
        self.source.write_bytes(b"new-image")
        with self.assertRaises(files.ImageFileError) as raised:
            files.restore_input_image(self.root, result["token"])
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(self.source.read_bytes(), b"new-image")
        self.source.rename(self.root / "new-image.png")
        files.restore_input_image(self.root, result["token"])
        self.assertEqual(self.source.read_bytes(), b"image-content")
        self.assertEqual((self.root / "new-image.png").read_bytes(), b"new-image")

    def test_delete_same_filename_twice_uses_separate_trash_entries(self):
        first = files.delete_input_image(self.root, "original.png")
        self.source.write_bytes(b"second-version")
        second = files.delete_input_image(self.root, "original.png")
        self.assertNotEqual(first["token"], second["token"])
        for item, content in [(first, b"image-content"), (second, b"second-version")]:
            self.assertEqual((self.root / files.TRASH_DIRECTORY / item["token"] / "original.png").read_bytes(), content)

    def test_restore_tokens_and_tampered_metadata_cannot_escape_input(self):
        for token in [None, {}, "../original.png", "a" * 33]:
            with self.assertRaises(files.ImageFileError):
                files.restore_input_image(self.root, token)
        result = files.delete_input_image(self.root, "original.png")
        metadata = self.root / files.TRASH_DIRECTORY / result["token"] / "metadata.json"
        metadata.write_text(json.dumps({"filename": "../outside.png"}), encoding="utf-8")
        with self.assertRaises(files.ImageFileError):
            files.restore_input_image(self.root, result["token"])

    def test_failed_delete_keeps_source_and_removes_only_empty_trash_entry(self):
        with patch.object(files, "_move_without_overwrite", side_effect=PermissionError("locked")):
            with self.assertRaises(PermissionError):
                files.delete_input_image(self.root, "original.png")
        self.assertEqual(self.source.read_bytes(), b"image-content")
        self.assertEqual(list((self.root / files.TRASH_DIRECTORY).iterdir()), [])

    def test_link_and_redirect_guards_without_requiring_symlink_privileges(self):
        with patch.object(files.os.path, "islink", return_value=True):
            with self.assertRaises(files.ImageFileError):
                files.delete_input_image(self.root, "original.png")
        realpath = os.path.realpath
        def redirected(path):
            return str(self.root.parent / "outside.png") if str(path) == str(self.source) else realpath(path)
        with patch.object(files.os.path, "realpath", side_effect=redirected):
            with self.assertRaises(files.ImageFileError):
                files.rename_input_image(self.root, "original.png", "renamed.png")
        self.assertTrue(self.source.exists())

    def test_links_cannot_redirect_file_operations(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / "outside.png"
            target.write_bytes(b"outside")
            link = self.root / "linked.png"
            try:
                link.symlink_to(target)
            except OSError as error:
                self.skipTest(f"Symlink creation unavailable: {error}")
            for action in [lambda: files.delete_input_image(self.root, "linked.png"),
                           lambda: files.rename_input_image(self.root, "linked.png", "moved.png")]:
                with self.assertRaises(files.ImageFileError):
                    action()
            link.unlink()
            (self.root / files.TRASH_DIRECTORY).symlink_to(outside, target_is_directory=True)
            with self.assertRaises(files.ImageFileError):
                files.delete_input_image(self.root, "original.png")
            self.assertEqual(target.read_bytes(), b"outside")
            (self.root / files.TRASH_DIRECTORY).unlink()


class GalleryRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer

        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.source = self.root / "original.png"
        self.source.write_bytes(b"image-content")
        routes = web.RouteTableDef()
        package = types.ModuleType("gallery_route_test")
        package.__path__ = [str(IMAGE_DIR)]
        server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
        dependencies = {
            "gallery_route_test": package,
            "server": server,
            "folder_paths": types.SimpleNamespace(get_input_directory=lambda: str(self.root)),
            "torch": types.ModuleType("torch"),
            "numpy": types.ModuleType("numpy"),
            "PIL": types.SimpleNamespace(Image=object(), ImageOps=object()),
        }
        spec = importlib.util.spec_from_file_location("gallery_route_test.load_image_node", IMAGE_DIR / "load_image_node.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, dependencies):
            spec.loader.exec_module(module)
        self.module = module
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.directory.cleanup()

    async def test_http_rename_delete_restore_flow(self):
        renamed = await self.client.post("/funcode/input_image/rename", json={"filename": "original.png", "new_name": "renamed.png"})
        self.assertEqual(renamed.status, 200)
        self.assertEqual((await renamed.json())["filename"], "renamed.png")
        deleted = await self.client.post("/funcode/input_image/delete", json={"filename": "renamed.png"})
        self.assertEqual(deleted.status, 200)
        data = await deleted.json()
        self.assertFalse((self.root / "renamed.png").exists())
        restored = await self.client.post("/funcode/input_image/restore", json={"token": data["token"]})
        self.assertEqual(restored.status, 200)
        self.assertEqual((self.root / "renamed.png").read_bytes(), b"image-content")

    async def test_http_validation_and_conflicts(self):
        (self.root / "existing.png").write_bytes(b"existing")
        for payload, expected in [([], 400), ({}, 400), ({"filename": "../outside.png"}, 400),
                                  ({"filename": "missing.png"}, 404)]:
            response = await self.client.post("/funcode/input_image/delete", json=payload)
            self.assertEqual(response.status, expected)
            self.assertIn("error", await response.json())
        response = await self.client.post("/funcode/input_image/rename", json={"filename": "original.png", "new_name": "existing.png"})
        self.assertEqual(response.status, 409)
        self.assertEqual(self.source.read_bytes(), b"image-content")
        response = await self.client.post("/funcode/input_image/delete", data="broken-json", headers={"Content-Type": "application/json"})
        self.assertEqual(response.status, 400)

    async def test_http_directory_listing_and_nested_mutations(self):
        folder = self.root / "album" / "child"
        folder.mkdir(parents=True)
        (folder / "original.png").write_bytes(b"nested")
        root = await self.client.get("/funcode/input_images")
        self.assertEqual(root.status, 200)
        self.assertEqual((await root.json())["directories"], ["album"])
        nested = await self.client.get("/funcode/input_images", params={"directory": "album/child"})
        self.assertEqual(nested.status, 200)
        self.assertEqual((await nested.json())["files"], ["album/child/original.png"])
        self.assertEqual(self.module.LoadImageFunCodeNode.INPUT_TYPES()["required"]["image"][0], ["album/child/original.png", "original.png"])
        renamed = await self.client.post("/funcode/input_image/rename", json={"filename": "album/child/original.png", "new_name": "renamed.png"})
        self.assertEqual((await renamed.json())["filename"], "album/child/renamed.png")
        deleted = await self.client.post("/funcode/input_image/delete", json={"filename": "album/child/renamed.png"})
        restored = await self.client.post("/funcode/input_image/restore", json={"token": (await deleted.json())["token"]})
        self.assertEqual((await restored.json())["filename"], "album/child/renamed.png")
        self.assertEqual(self.source.read_bytes(), b"image-content")
        for directory, expected in [("../outside", 400), (".funcode-trash", 403), ("missing", 404)]:
            response = await self.client.get("/funcode/input_images", params={"directory": directory})
            self.assertEqual(response.status, expected)


if __name__ == "__main__":
    unittest.main()
