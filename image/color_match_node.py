import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import torch


class ColorMatchFunCodeNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_ref": ("IMAGE",),
                "image_target": ("IMAGE",),
                "method": (
                    [
                        "mkl",
                        "hm",
                        "reinhard",
                        "mvgd",
                        "hm-mvgd-hm",
                        "hm-mkl-hm",
                    ],
                    {"default": "mkl"},
                ),
            },
            "optional": {
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.01}),
                "multithread": ("BOOLEAN", {"default": True}),
            },
        }

    CATEGORY = "FunCode/Image"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "colormatch"
    DESCRIPTION = (
        "color-matcher provides automatic color transfer based on Reinhard, MKL, MVGD and histogram matching. "
        "Reference: https://github.com/hahnec/color-matcher/"
    )

    def colormatch(self, image_ref, image_target, method, strength=1.0, multithread=True):
        try:
            from color_matcher import ColorMatcher
        except Exception as exc:
            raise Exception(
                "Can't import color-matcher, please install it first: pip install color-matcher"
            ) from exc

        ref = image_ref.detach().cpu().numpy().astype(np.float32)
        target = image_target.detach().cpu().numpy().astype(np.float32)

        if ref.ndim == 3:
            ref = ref[None, ...]
        if target.ndim == 3:
            target = target[None, ...]

        batch_size = target.shape[0]
        ref_batch = ref.shape[0]

        if ref_batch not in (1, batch_size):
            raise ValueError("ColorMatchNode: reference batch must be 1 or match target batch size.")

        strength = float(strength)

        def process(i):
            cm = ColorMatcher()
            src = target[i]
            ref_i = ref[0] if ref_batch == 1 else ref[i]
            try:
                result = cm.transfer(src=src, ref=ref_i, method=method)
                result = src + strength * (result - src)
                return np.clip(result, 0.0, 1.0)
            except Exception:
                return src

        if multithread and batch_size > 1:
            max_threads = min(os.cpu_count() or 1, batch_size)
            with ThreadPoolExecutor(max_workers=max_threads) as executor:
                outputs = list(executor.map(process, range(batch_size)))
        else:
            outputs = [process(i) for i in range(batch_size)]

        out = torch.from_numpy(np.stack(outputs, axis=0)).to(torch.float32)
        out.clamp_(0, 1)
        return (out,)
