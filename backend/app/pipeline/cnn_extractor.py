"""
CNN feature extraction for FurnForge AI.

Uses a real ImageNet-pretrained ResNet (torchvision) on the preprocessed sketch:

1. Forward pass -> 1000 ImageNet logits + a 2048-d global feature embedding.
2. Zero-shot furniture classification: ImageNet already contains furniture classes
   ("rocking chair", "studio couch", "four-poster", "dining table", "wardrobe", ...).
   Their softmax probabilities are summed per FurnForge category.
3. Grad-CAM (Selvaraju et al., 2017): gradients of the winning furniture category are
   back-propagated to the last convolutional block (layer4). The gradient-weighted
   activation map gives, for every pixel of the sketch, how much it contributed to
   the CNN's decision. This is the "pixel-by-pixel" CNN analysis shown in the UI.

Honest limitation: ImageNet CNNs are trained on photographs, so their category guess
on line drawings is a suggestion, not ground truth. The user's chosen category always
drives generation; the CNN output is shown for analysis and to flag mismatches.
"""
from __future__ import annotations

import base64
import logging
import threading
from typing import Any, Dict, List

import cv2
import numpy as np

from app.config import CNN_BACKBONE

logger = logging.getLogger("FurnForgeAI.CNN")

# ImageNet class names (as listed in torchvision weight metadata) grouped by category.
FURNITURE_CLASS_GROUPS: Dict[str, List[str]] = {
    "Chair": ["barber chair", "folding chair", "rocking chair", "throne"],
    "Sofa": ["studio couch", "park bench"],
    "Table": ["dining table", "desk"],
    "Bed": ["four-poster", "crib", "cradle"],
    "Cabinet": ["china cabinet", "wardrobe", "chiffonier", "file",
                "medicine chest", "entertainment center", "bookcase"],
}

ACCESSORY_CUES: Dict[str, str] = {
    "pot": "with a small potted plant on top",
    "vase": "with a decorative vase on top",
    "table lamp": "with a small lamp on top",
    "lampshade": "with a small lamp on top",
    "pillow": "with throw pillows",
}


class CNNFeatureExtractor:
    def __init__(self) -> None:
        self.ready = False
        self.error: str | None = None
        self._lock = threading.Lock()
        self._load()

    # ------------------------------------------------------------------ setup
    def _load(self) -> None:
        try:
            import torch
            import torchvision.models as models

            if CNN_BACKBONE == "resnet18":
                weights = models.ResNet18_Weights.IMAGENET1K_V1
                self.model = models.resnet18(weights=weights)
            else:
                weights = models.ResNet50_Weights.IMAGENET1K_V2
                self.model = models.resnet50(weights=weights)
            self.model.eval()
            self.backbone_name = f"{CNN_BACKBONE} (ImageNet-pretrained, torchvision)"
            self.preprocess = weights.transforms()
            self.class_names: List[str] = weights.meta["categories"]
            self.torch = torch

            # Map every group to its ImageNet indices.
            name_to_idx = {n: i for i, n in enumerate(self.class_names)}
            self.group_indices: Dict[str, List[int]] = {}
            for group, names in FURNITURE_CLASS_GROUPS.items():
                idx = [name_to_idx[n] for n in names if n in name_to_idx]
                missing = [n for n in names if n not in name_to_idx]
                if missing:
                    logger.warning("ImageNet classes not found for %s: %s", group, missing)
                self.group_indices[group] = idx

            # Hooks on the last conv block for Grad-CAM.
            self._activations = None
            self._gradients = None
            self.model.layer4.register_forward_hook(self._save_activation)
            self.ready = True
            logger.info("CNN loaded: %s", self.backbone_name)
        except Exception as exc:  # pragma: no cover - surfaced through /api/health
            self.error = f"{type(exc).__name__}: {exc}"
            logger.error("CNN failed to load: %s", self.error)

    def _save_activation(self, _module, _inp, out):
        # Keep the layer4 feature maps and capture their gradient during backward().
        self._activations = out
        if out.requires_grad:
            out.register_hook(self._save_gradient)

    def _save_gradient(self, grad):
        self._gradients = grad

    # --------------------------------------------------------------- analysis
    def analyze(self, sketch_bgr: np.ndarray, edge_map: np.ndarray) -> Dict[str, Any]:
        """
        Run the CNN on the cleaned sketch.

        sketch_bgr: 512x512 BGR sketch (dark lines on light background).
        edge_map:   512x512 uint8 Canny map, used for geometric statistics only.
        """
        if not self.ready:
            raise RuntimeError(f"CNN not available: {self.error}")

        torch = self.torch
        from PIL import Image

        rgb = cv2.cvtColor(sketch_bgr, cv2.COLOR_BGR2RGB)
        tensor = self.preprocess(Image.fromarray(rgb)).unsqueeze(0)  # 1x3x224x224

        with self._lock, torch.enable_grad():  # hooks store state on the instance -> serialize
            self.model.zero_grad(set_to_none=True)
            self._activations = None
            self._gradients = None
            tensor.requires_grad_(True)
            logits = self.model(tensor)                    # 1x1000
            probs = torch.softmax(logits, dim=1)[0]

            probs_det = probs.detach()
            group_probs = {g: float(probs_det[idx].sum()) for g, idx in self.group_indices.items()}
            furniture_mass = sum(group_probs.values())
            predicted = max(group_probs, key=group_probs.get)

            # Grad-CAM for the predicted furniture category.
            target_indices = self.group_indices.get(predicted, [])
            if target_indices:
                score = logits[0, target_indices].sum()
                score.backward()

            acts = self._activations.detach()[0] if self._activations is not None else torch.zeros((2048, 7, 7))
            if self._gradients is not None:
                grads = self._gradients.detach()[0]
                weights = grads.mean(dim=(1, 2))
                cam = torch.relu((weights[:, None, None] * acts).sum(0)).cpu().numpy()
            else:
                cam = torch.relu(acts.mean(0)).cpu().numpy()

            # Global-average-pooled embedding (input of the final FC layer).
            embedding = acts.mean(dim=(1, 2)).cpu().numpy()

        top5 = torch.topk(probs_det, 5)
        top5_list = [
            {"label": self.class_names[i], "probability": round(float(p), 4)}
            for p, i in zip(top5.values.tolist(), top5.indices.tolist())
        ]

        cam_full, heatmap_b64, cam_stats = self._render_cam(cam, sketch_bgr)
        norm = furniture_mass if furniture_mass > 0 else 1.0
        category_scores = {g: round(p / norm, 4) for g, p in group_probs.items()}

        geo = self._geometry(edge_map)
        ar = geo["aspect_ratio"]
        if ar < 0.72:
            proportion_cue = "tall upright vertical silhouette"
        elif ar > 1.25:
            proportion_cue = "wide low-profile horizontal silhouette"
        else:
            proportion_cue = "balanced proportion silhouette"

        accessories = []
        for item in top5_list:
            if item["probability"] >= 0.04 and item["label"] in ACCESSORY_CUES:
                cue = ACCESSORY_CUES[item["label"]]
                if cue not in accessories:
                    accessories.append(cue)

        pixel_metrics = {
            "total_pixels_scanned": cam_stats["pixels_scored"],
            "spatial_coverage_percent": cam_stats["high_attention_percent"],
            "mean_feature_salience": cam_stats["mean_attention"],
            "peak_activation_coordinate": cam_stats["peak_attention_xy"],
        }

        return {
            "backbone": self.backbone_name,
            "detected_category": predicted,
            "category_confidence": category_scores[predicted],
            "all_category_scores": category_scores,
            "furniture_probability_mass": round(furniture_mass, 4),
            "imagenet_top5": top5_list,
            "structural_cue": proportion_cue,
            "detected_accessories": accessories,
            "embedding_dim": int(embedding.shape[0]),
            "embedding_l2_norm": round(float(np.linalg.norm(embedding)), 3),
            "embedding_preview": [round(float(v), 4) for v in embedding[:8]],
            "gradcam": cam_stats,
            "pixel_metrics": pixel_metrics,
            "b64_heatmap": heatmap_b64,
            **geo,
        }

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _render_cam(cam: np.ndarray, sketch_bgr: np.ndarray):
        """Upsample the 7x7 Grad-CAM to the 512x512 canvas and overlay it."""
        h, w = sketch_bgr.shape[:2]
        cam = cam - cam.min()
        if cam.max() > 0:
            cam = cam / cam.max()
        cam_full = cv2.resize(cam.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
        cam_full = np.clip(cam_full, 0.0, 1.0)

        heat = cv2.applyColorMap((cam_full * 255).astype(np.uint8), cv2.COLORMAP_JET)
        overlay = cv2.addWeighted(sketch_bgr, 0.45, heat, 0.55, 0)
        ok, buf = cv2.imencode(".png", overlay)
        b64 = "data:image/png;base64," + base64.b64encode(buf).decode() if ok else None

        peak_y, peak_x = np.unravel_index(int(np.argmax(cam_full)), cam_full.shape)
        stats = {
            "feature_map_resolution": f"{cam.shape[1]}x{cam.shape[0]}",
            "upsampled_resolution": f"{w}x{h}",
            "pixels_scored": int(w * h),
            "high_attention_percent": round(float((cam_full > 0.5).mean() * 100), 2),
            "mean_attention": round(float(cam_full.mean()), 4),
            "peak_attention_xy": {"x": int(peak_x), "y": int(peak_y)},
        }
        return cam_full, b64, stats

    @staticmethod
    def _geometry(edge_map: np.ndarray) -> Dict[str, Any]:
        """Simple, transparent geometric statistics of the edge map."""
        h, w = edge_map.shape[:2]
        n_edge = int(np.count_nonzero(edge_map))
        # Dilate so hand-drawn lines a few pixels off still count as mirrored.
        thick = cv2.dilate(edge_map, np.ones((7, 7), np.uint8))
        left = thick[:, : w // 2]
        right = cv2.flip(thick[:, w - w // 2:], 1)
        overlap = np.count_nonzero(cv2.bitwise_and(left, right))
        symmetry = (2 * overlap / max(1, np.count_nonzero(left) + np.count_nonzero(right)))

        contours, _ = cv2.findContours(edge_map, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            x, y, bw, bh = cv2.boundingRect(np.vstack(contours))
            aspect = bw / max(1, bh)
        else:
            aspect = 1.0
        return {
            "edge_density_percent": round(n_edge / (h * w) * 100, 2),
            "symmetry_score": round(float(symmetry), 3),
            "aspect_ratio": round(float(aspect), 2),
            "contour_count": len(contours),
        }

    @staticmethod
    def _refine_probs_with_geometry(
        edge_map: np.ndarray,
        group_probs: Dict[str, float],
        geo: Dict[str, Any],
    ):
        """
        Combine ResNet-50 logits with structural sketch silhouette geometry:
        1. Detect a narrow centered top accessory (potted plant/vase) sitting on a
           flat horizontal tabletop with open separated legs at the bottom -> Table.
        2. Detect wide horizontal enclosed-base upholstery silhouettes (Aspect >= 1.55)
           so wide sofas are not misclassified as tables or chairs.
        """
        probs = dict(group_probs)
        accessories: List[str] = []
        ys, xs = np.where(edge_map > 0)
        if ys.size < 30:
            return probs, accessories

        y_min, y_max = int(ys.min()), int(ys.max())
        x_min, x_max = int(xs.min()), int(xs.max())
        bw = max(1, x_max - x_min + 1)
        bh = max(1, y_max - y_min + 1)
        xc = 0.5 * (x_min + x_max)

        row_spans = np.zeros(bh, dtype=np.float32)
        row_xL = np.full(bh, x_min, dtype=np.float32)
        row_xR = np.full(bh, x_max, dtype=np.float32)
        for y in range(y_min, y_max + 1):
            cols = np.where(edge_map[y] > 0)[0]
            if cols.size >= 2:
                idx = y - y_min
                row_xL[idx] = float(cols[0])
                row_xR[idx] = float(cols[-1])
                row_spans[idx] = float(cols[-1] - cols[0] + 1)

        # Check if the bottom 12% of the sketch has an open gap in the center 36% (legs vs closed sofa base)
        bot_y0 = max(y_min, y_max - max(6, int(0.12 * bh)))
        mid_x0 = int(x_min + 0.32 * bw)
        mid_x1 = int(x_max - 0.32 * bw)
        bot_center_ink = int(np.count_nonzero(edge_map[bot_y0 : y_max + 1, mid_x0:mid_x1]))
        has_open_leg_bottom = bot_center_ink < max(12, int(0.015 * bw * (y_max - bot_y0 + 1)))

        # Strictly detect a narrow centered top object (< 0.42 * bw, confined to middle region)
        # followed by a sharp step-jump to a wide horizontal tabletop slab (>= 0.78 * bw)
        narrow_end = None
        for dy in range(max(12, int(0.16 * bh)), int(0.55 * bh)):
            upper_spans = row_spans[:dy]
            active_mask = upper_spans > 2
            if int(np.sum(active_mask)) < max(8, int(0.12 * bh)):
                continue
            p90_upper = float(np.percentile(upper_spans[active_mask], 90))
            min_xL_upper = float(np.percentile(row_xL[:dy][active_mask], 10))
            max_xR_upper = float(np.percentile(row_xR[:dy][active_mask], 90))
            in_center_zone = (min_xL_upper >= x_min + 0.22 * bw) and (max_xR_upper <= x_max - 0.22 * bw)

            slab_band = row_spans[dy : min(bh, dy + max(8, int(0.12 * bh)))]
            max_slab = float(slab_band.max()) if slab_band.size else 0.0
            if (
                in_center_zone
                and p90_upper < 0.42 * bw
                and max_slab >= 0.78 * bw
                and (max_slab - p90_upper) >= 0.36 * bw
                and has_open_leg_bottom
            ):
                narrow_end = dy
                break

        max_p = max(probs.values()) if probs else 0.1
        if narrow_end is not None:
            body_bh = max(1, bh - narrow_end)
            body_ar = bw / float(body_bh)
            if body_ar >= 1.25:
                probs["Table"] = max(probs.get("Table", 0.0), max_p * 4.5 + 0.12)
                accessories.append("with a small potted plant on top")
                geo["aspect_ratio"] = round(float(body_ar), 2)
                return probs, accessories

        # Wide horizontal enclosed silhouette (Aspect >= 1.55 with closed bottom base) -> Sofa
        overall_ar = bw / float(bh)
        if overall_ar >= 1.55 and not has_open_leg_bottom:
            probs["Sofa"] = max(probs.get("Sofa", 0.0), max_p * 2.2 + 0.08)

        return probs, accessories
