"""
FurnForge AI - Texture-Locked Multi-View Output Renderer.

Generates 4 consistent orthogonal views from a single generated Front View
photoreal furniture render:
  1. Front View (0 deg)   - Original generated photorealistic render
  2. Side View (90 deg)   - Vertically aligned profile elevation preserving parts & legs
  3. Top View (Overhead)  - Horizontally aligned plan view + overhead top accessories
  4. Back View (180 deg)  - Rear elevation preserving frame silhouette & material finish
  5. Multi-View Sheet     - Clean 2x2 architectural presentation grid (1024x1024)

Every view samples its RGB surface pixels directly from the generated Front View so
design language, proportions, accessories, palette color, material texture, and
studio lighting remain 100% consistent across all angles.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("FurnForgeAI.MultiView")

_REMBG_SESSION: Any = None
_REMBG_FAILED: bool = False


def _get_rembg_session() -> Any:
    """Lazy singleton for u2net rembg session used for accurate foreground extraction."""
    global _REMBG_SESSION, _REMBG_FAILED
    if _REMBG_FAILED:
        return None
    if _REMBG_SESSION is not None:
        return _REMBG_SESSION
    try:
        import rembg

        _REMBG_SESSION = rembg.new_session("u2net")
        return _REMBG_SESSION
    except Exception as exc:
        logger.debug("rembg session unavailable in multiview_renderer: %s", exc)
        _REMBG_FAILED = True
        return None


def _trim_floor_reflection_tags(front_bgr: np.ndarray, alpha_u8: np.ndarray) -> np.ndarray:
    """
    Prune thin bright/achromatic floor-reflection splats or cast-shadow tags at the
    very bottom 7% of a foreground mask so feet sit cleanly on the floor plane.
    """
    h, w = alpha_u8.shape[:2]
    ys, xs = np.where(alpha_u8 > 90)
    if ys.size < 40:
        return alpha_u8
    y_min, y_max = int(ys.min()), int(ys.max())
    x_min, x_max = int(xs.min()), int(xs.max())
    bh = max(1, y_max - y_min + 1)
    bw = max(1, x_max - x_min + 1)

    bot_y0 = max(0, y_max - max(6, int(0.075 * bh)))
    floor_sample_y0 = max(0, min(h - 4, y_max - 4))
    floor_strips = []
    if x_min > 12:
        floor_strips.append(front_bgr[bot_y0 : min(h, y_max + 10), max(2, x_min - 24) : x_min - 4])
    if x_max < w - 12:
        floor_strips.append(front_bgr[bot_y0 : min(h, y_max + 10), x_max + 4 : min(w - 2, x_max + 24)])
    if floor_strips:
        cat_strips = np.concatenate([s.reshape(-1, 3) for s in floor_strips if s.size > 0], axis=0)
        floor_bgr = np.median(cat_strips, axis=0).astype(np.float32) if len(cat_strips) else np.array([210.0, 215.0, 220.0], dtype=np.float32)
    else:
        floor_bgr = np.median(front_bgr[floor_sample_y0:, :, :].reshape(-1, 3), axis=0).astype(np.float32)

    floor_lum = float(0.114 * floor_bgr[0] + 0.587 * floor_bgr[1] + 0.299 * floor_bgr[2])
    lum = (0.114 * front_bgr[:, :, 0] + 0.587 * front_bgr[:, :, 1] + 0.299 * front_bgr[:, :, 2]).astype(np.float32)
    rgb_spread = (np.max(front_bgr, axis=2).astype(np.float32) - np.min(front_bgr, axis=2).astype(np.float32))
    floor_dist = np.linalg.norm(front_bgr.astype(np.float32) - floor_bgr[None, None, :], axis=2)

    cleaned = alpha_u8.copy()
    bot_zone = np.zeros((h, w), dtype=bool)
    bot_zone[bot_y0 : min(h, y_max + 3), :] = True

    # Remove bright white/gray floor reflection tags or near-floor halo tags at the bottom 7.5%
    is_bright_tag = bot_zone & (rgb_spread < 28.0) & ((lum > floor_lum - 18.0) | (floor_dist < 32.0) | (lum > 185.0))
    is_shadow_tag = bot_zone & (rgb_spread < 16.0) & (lum < 25.0)
    cleaned[is_bright_tag | is_shadow_tag] = 0

    # Also prune any thin horizontal floor protrusions wider than leg posts in bottom 4%
    leg_check_y0 = max(bot_y0, y_max - max(4, int(0.045 * bh)))
    ref_row = max(y_min, leg_check_y0 - 4)
    ref_cols = alpha_u8[ref_row] > 90
    for y in range(leg_check_y0, min(h, y_max + 1)):
        # Do not let bottom foot rows expand horizontally beyond the upper ankle silhouette + 3px
        expanded_ref = cv2.dilate(ref_cols.astype(np.uint8)[None, :], np.ones((1, 7), np.uint8))[0] > 0
        cleaned[y, ~expanded_ref] = 0

    return cleaned


DEPTH_RATIOS: Dict[str, float] = {
    "chair": 0.82,
    "sofa": 0.54,
    "table": 0.64,
    "bed": 0.92,
    "cabinet": 0.48,
}


def _find_associated_edge_map(prefix: str, output_dir: Path, target_shape: Tuple[int, int]) -> Optional[np.ndarray]:
    """
    Locate the ControlNet edge/scribble map (`edge_{gen_id}.png`) associated with
    a generated render (`render_{gen_id}_{idx}`) if present in `output_dir`.
    """
    h, w = target_shape
    m = re.match(r"^render_(furn_[a-zA-Z0-9]+)_\d+$", prefix)
    candidates: List[Path] = []
    if m:
        gen_id = m.group(1)
        candidates.append(output_dir / f"edge_{gen_id}.png")
        candidates.append(output_dir.parent / "outputs" / f"edge_{gen_id}.png")
    for cand in candidates:
        if cand.exists():
            img = cv2.imread(str(cand), cv2.IMREAD_GRAYSCALE)
            if img is not None:
                if img.shape[:2] != (h, w):
                    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_NEAREST)
                n_cc, labels, stats, _ = cv2.connectedComponentsWithStats((img > 45).astype(np.uint8) * 255)
                cleaned = np.zeros_like(img)
                for lbl in range(1, n_cc):
                    area = int(stats[lbl, cv2.CC_STAT_AREA])
                    cy = int(stats[lbl, cv2.CC_STAT_TOP])
                    ch = int(stats[lbl, cv2.CC_STAT_HEIGHT])
                    if area < 18 or cy >= int(0.89 * h) or (cy + ch) <= int(0.05 * h):
                        continue
                    cleaned[labels == lbl] = 255
                if np.count_nonzero(cleaned) > 50:
                    return cleaned
    return None


def _reconstruct_studio_bg(front_bgr: np.ndarray, fg_hint: Optional[np.ndarray] = None) -> np.ndarray:
    """
    Reconstruct a clean, seamless studio wall + floor + soft radial lighting background.
    Removes dark cast-shadow bands on the outer margins and smoothly inpaints the
    furniture interior so Side and Back views match the Front View's exact studio lighting.
    """
    h, w = front_bgr.shape[:2]
    m_in = max(2, min(8, w // 64))
    m_out = max(m_in + 6, min(30, w // 16))

    left_strip = np.median(front_bgr[:, m_in:m_out, :], axis=1).astype(np.float32)
    right_strip = np.median(front_bgr[:, w - m_out : w - m_in, :], axis=1).astype(np.float32)

    floor_y0 = int(h * 0.55)
    for strip in (left_strip, right_strip):
        lum = 0.114 * strip[:, 0] + 0.587 * strip[:, 1] + 0.299 * strip[:, 2]
        floor_med_lum = float(np.percentile(lum[floor_y0:], 70))
        shadow_rows = np.where((np.arange(h) >= floor_y0) & (lum < floor_med_lum - 18.0))[0]
        if shadow_rows.size > 0:
            clean_floor_rows = np.where((np.arange(h) >= floor_y0) & (lum >= floor_med_lum - 18.0))[0]
            if clean_floor_rows.size > 0:
                replacement = np.median(strip[clean_floor_rows], axis=0)
                strip[shadow_rows] = replacement

    k_v = max(7, (h // 24) | 1)
    left_smooth = cv2.GaussianBlur(left_strip[:, None, :], (1, k_v), 0)[:, 0, :]
    right_smooth = cv2.GaussianBlur(right_strip[:, None, :], (1, k_v), 0)[:, 0, :]

    t = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :, None]
    margin_bg = left_smooth[:, None, :] * (1.0 - t) + right_smooth[:, None, :] * t

    if fg_hint is not None:
        bg_mask = (fg_hint < 0.15).astype(np.float32)
        lum_img = (0.114 * front_bgr[:, :, 0] + 0.587 * front_bgr[:, :, 1] + 0.299 * front_bgr[:, :, 2]).astype(np.float32)
        lum_mbg = (0.114 * margin_bg[:, :, 0] + 0.587 * margin_bg[:, :, 1] + 0.299 * margin_bg[:, :, 2]).astype(np.float32)
        bg_mask[lum_img < lum_mbg - 22.0] = 0.0

        small_w, small_h = 16, 16
        num_s = cv2.resize(front_bgr.astype(np.float32) * bg_mask[:, :, None], (small_w, small_h), interpolation=cv2.INTER_AREA)
        den_s = cv2.resize(bg_mask, (small_w, small_h), interpolation=cv2.INTER_AREA)[:, :, None]
        low_mbg = cv2.resize(margin_bg, (small_w, small_h), interpolation=cv2.INTER_AREA)
        valid = np.clip(den_s * 3.0, 0.0, 1.0)
        field_s = np.where(den_s > 1e-3, num_s / np.maximum(1e-3, den_s), low_mbg)
        field_s = valid * field_s + (1.0 - valid) * low_mbg
        field_full = cv2.resize(field_s, (w, h), interpolation=cv2.INTER_CUBIC)
        margin_bg = 0.55 * field_full + 0.45 * margin_bg

    return np.clip(margin_bg, 0, 255).astype(np.uint8)


def _reconstruct_floor_bg(front_bgr: np.ndarray, studio_bg: np.ndarray) -> np.ndarray:
    """Build a seamless matte overhead studio floor canvas matching the render studio tone."""
    h, w = front_bgr.shape[:2]
    y0, y1 = int(h * 0.78), int(h * 0.96)
    floor_sample = np.median(studio_bg[y0:y1, :, :], axis=(0, 1)).astype(np.float32)
    wall_sample = np.median(studio_bg[int(h * 0.10) : int(h * 0.25), :, :], axis=(0, 1)).astype(np.float32)
    base_tone = np.clip(0.55 * floor_sample + 0.45 * wall_sample, 28, 246)

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt(((xx - w * 0.5) / (w * 0.65)) ** 2 + ((yy - h * 0.5) / (h * 0.65)) ** 2)
    vignette = 1.05 - 0.14 * np.clip(dist, 0.0, 1.4) ** 2
    canvas = np.clip(base_tone[None, None, :] * vignette[:, :, None], 0, 255).astype(np.uint8)
    return canvas


def _segment_front_image(
    front_bgr: np.ndarray,
    studio_bg: np.ndarray,
    mask_gray: Optional[np.ndarray] = None,
    edge_hint: Optional[np.ndarray] = None,
) -> np.ndarray:
    """
    Extract a crisp float32 alpha mask [0, 1] isolating the furniture (and any
    resting top accessories) from the studio cyclorama, radial wall/floor spotlights,
    and floor cast shadows.
    """
    h, w = front_bgr.shape[:2]
    if mask_gray is not None:
        m = mask_gray
        if m.shape[:2] != (h, w):
            m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
        alpha = np.clip(m.astype(np.float32) / 255.0, 0.0, 1.0)
        return cv2.GaussianBlur(alpha, (3, 3), 0)

    gray = cv2.cvtColor(front_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)

    # 1. Edge-guided structural segmentation when ControlNet edge map (`edge_hint`) is available
    if edge_hint is not None and np.count_nonzero(edge_hint > 40) > 50:
        eb = edge_hint > 40
        eys, exs = np.where(eb)
        ey_min, ey_max = int(eys.min()), int(eys.max())
        ex_min, ex_max = int(exs.min()), int(exs.max())
        ew = max(1, ex_max - ex_min + 1)
        eh = max(1, ey_max - ey_min + 1)

        # Dilate vertically by 35px so perspective top surfaces (like sunlit tabletop plank above sketch line) are fully covered
        eb_env_dil = cv2.dilate(eb.astype(np.uint8) * 255, np.ones((35, 25), np.uint8)) > 0
        eb_stroke_dil = cv2.dilate(eb.astype(np.uint8) * 255, np.ones((11, 17), np.uint8)) > 0

        mid_x0 = int(ex_min + 0.30 * ew)
        mid_x1 = int(ex_max - 0.30 * ew)

        envelope = np.zeros((h, w), dtype=np.uint8)
        core_body = np.zeros((h, w), dtype=bool)
        leg_zone_y0 = ey_min + int(0.46 * eh)

        # Remember last valid left/right leg column bounds so leg extension rows below ey_max never bridge the middle gap
        last_left_leg = (max(4, ex_min - 8), min(w - 4, ex_min + max(28, int(0.18 * ew))))
        last_right_leg = (max(4, ex_max - max(28, int(0.18 * ew))), min(w - 4, ex_max + 8))

        for y in range(max(0, ey_min - 14), min(h, ey_max + 48)):
            yc = int(np.clip(y, ey_min, ey_max))
            env_cols = np.where(eb_env_dil[yc])[0]
            stroke_cols = np.where(eb_stroke_dil[yc])[0]
            if env_cols.size < 2:
                continue

            span_env = int(env_cols[-1] - env_cols[0] + 1)
            is_narrow_top = (y < ey_min + int(0.45 * eh)) and (span_env < 0.45 * ew)
            center_has_strokes = (y <= ey_max + 4) and (np.count_nonzero(eb_stroke_dil[yc, mid_x0:mid_x1]) > 0)

            if is_narrow_top:
                x0 = max(4, int(env_cols[0]) - 8)
                x1 = min(w - 4, int(env_cols[-1]) + 8)
                envelope[y, x0 : x1 + 1] = 255
            elif y >= leg_zone_y0 and not center_has_strokes:
                # Open leg gap row: NEVER fill the center [mid_x0:mid_x1]!
                left_leg_cols = stroke_cols[stroke_cols < mid_x0]
                right_leg_cols = stroke_cols[stroke_cols > mid_x1]
                if left_leg_cols.size > 0:
                    last_left_leg = (max(4, int(left_leg_cols[0]) - 10), min(w - 4, int(left_leg_cols[-1]) + 10))
                if right_leg_cols.size > 0:
                    last_right_leg = (max(4, int(right_leg_cols[0]) - 10), min(w - 4, int(right_leg_cols[-1]) + 10))
                envelope[y, last_left_leg[0] : last_left_leg[1] + 1] = 255
                envelope[y, last_right_leg[0] : last_right_leg[1] + 1] = 255
            else:
                # Solid furniture body row (sofa/chair/cabinet/bed body, tabletop plank, or stretcher bar)
                x0 = max(4, int(env_cols[0]) - 8)
                x1 = min(w - 4, int(env_cols[-1]) + 8)
                envelope[y, x0 : x1 + 1] = 255
                if env_cols.size >= 2 and y <= ey_max - 4:
                    c0 = int(env_cols[0]) + 6
                    c1 = int(env_cols[-1]) - 6
                    if c1 > c0 and y < leg_zone_y0 + int(0.16 * eh):
                        core_body[y, c0 : c1 + 1] = True

        # Estimate local studio background:
        # - For narrow top accessory rows (above the tabletop, y < ey_min + 0.34*eh), sample right outside the accessory [c0-24:c0-4, c1+4:c1+24]
        #   so central wall spotlight behind plant leaves is matched locally and never creates a box around the plant!
        # - For main furniture body rows (y >= ey_min + 0.34*eh), sample outside global furniture width [ex_min, ex_max]
        #   so sunlit tabletop surfaces beside a centered pot are never mistaken for background!
        local_bg = studio_bg.astype(np.float32).copy()
        g_l0, g_l1 = max(2, ex_min - 28), max(4, ex_min - 6)
        g_r0, g_r1 = min(w - 5, ex_max + 6), min(w - 2, ex_max + 28)
        top_split_y = ey_min + int(0.34 * eh)
        for y in range(h):
            env_cols = np.where(envelope[y] > 0)[0]
            if y < top_split_y and env_cols.size > 0 and (env_cols[-1] - env_cols[0]) < 0.48 * ew:
                c0, c1 = int(env_cols[0]), int(env_cols[-1])
                l0, l1 = max(2, c0 - 24), max(4, c0 - 4)
                r0, r1 = min(w - 5, c1 + 4), min(w - 2, c1 + 24)
            else:
                c0, c1 = ex_min, ex_max
                l0, l1 = g_l0, g_l1
                r0, r1 = g_r0, g_r1
            l_col = np.median(front_bgr[y, l0:l1, :], axis=0) if l1 > l0 else local_bg[y, 0]
            r_col = np.median(front_bgr[y, r0:r1, :], axis=0) if r1 > r0 else local_bg[y, -1]
            t_row = np.clip((np.arange(w, dtype=np.float32) - c0) / max(1.0, float(c1 - c0)), 0.0, 1.0)[:, None]
            local_bg[y] = l_col[None, :] * (1.0 - t_row) + r_col[None, :] * t_row

        lab_img = cv2.cvtColor(front_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab_bg = cv2.cvtColor(np.clip(local_bg, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
        dL = lab_img[:, :, 0] - lab_bg[:, :, 0]
        da = lab_img[:, :, 1] - lab_bg[:, :, 1]
        db = lab_img[:, :, 2] - lab_bg[:, :, 2]
        chroma_diff = np.sqrt(da * da + db * db)
        delta_e = np.sqrt(dL * dL + 1.5 * (da * da + db * db))

        floor_ref = (
            np.median(
                front_bgr[
                    min(h - 10, ey_max + 36) : min(h - 2, ey_max + 70),
                    max(10, ex_min) : min(w - 10, ex_max),
                    :,
                ],
                axis=(0, 1),
            ).astype(np.float32)
            if ey_max + 40 < h
            else np.median(studio_bg[int(h * 0.82) :, :, :], axis=(0, 1)).astype(np.float32)
        )
        floor_dist = np.linalg.norm(front_bgr.astype(np.float32) - floor_ref[None, None, :], axis=2)

        is_fg = (envelope > 0) & (
            core_body
            | (delta_e > 16.0)
            | (chroma_diff > 9.5)
            | ((grad > 16.0) & (delta_e > 9.5))
        )

        # In bottom leg extension zone (y >= ey_max - int(0.14 * eh)), remove floor & achromatic black floor shadows
        bot_zone = np.arange(h)[:, None] >= (ey_max - int(0.14 * eh))
        lum_raw = 0.114 * front_bgr[:, :, 0] + 0.587 * front_bgr[:, :, 1] + 0.299 * front_bgr[:, :, 2]
        floor_lum = float(0.114 * floor_ref[0] + 0.587 * floor_ref[1] + 0.299 * floor_ref[2])
        rgb_spread = (np.max(front_bgr, axis=2).astype(np.float32) - np.min(front_bgr, axis=2).astype(np.float32))
        is_dark_floor_shadow = bot_zone & (lum_raw < 24.0) & (rgb_spread < 15.0) & (np.abs(gx) < 18.0)
        is_same_as_floor = (np.arange(h)[:, None] >= ey_max - 6) & (floor_dist < 22.0) & (grad < 16.0)
        # Below the sketch bottom (y > ey_max + 4), reject bright/achromatic glossy floor reflections!
        # Only allow genuine colored wooden leg extensions (rgb_spread > 28 and darker than floor)
        below_sketch = np.arange(h)[:, None] > (ey_max + 4)
        is_floor_reflection = below_sketch & ((rgb_spread < 28.0) | (lum_raw >= floor_lum - 6.0))
        is_fg = is_fg & (~is_dark_floor_shadow) & (~is_same_as_floor) & (~is_floor_reflection)

        # Below the sketch bottom (y >= ey_max - 4), keep narrow leg posts only for single chairs/tables
        # (never delete solid plinths or continuous bases for sofas, beds, or cabinets!)
        ew_f = float(ew)
        eh_f = float(eh)
        is_wide_piece = (ew_f / max(1.0, eh_f)) >= 1.34
        if not is_wide_piece:
            for y in range(max(0, ey_max - 4), min(h, ey_max + 48)):
                segs = _row_intervals(is_fg[y], min_len=3)
                for s, e in segs:
                    if (e - s + 1) > max(28, int(0.18 * ew)):
                        is_fg[y, s : e + 1] = False

        mask_u8 = is_fg.astype(np.uint8) * 255
        mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        alpha = cv2.GaussianBlur(mask_u8.astype(np.float32) / 255.0, (3, 3), 0)
        return np.clip(alpha, 0.0, 1.0)

    # 2. Fallback when no edge_hint is available: prefer u2net rembg when it yields a clean interior object
    rembg_sess = _get_rembg_session()
    if rembg_sess is not None:
        try:
            import rembg
            from PIL import Image

            pil_in = Image.fromarray(cv2.cvtColor(front_bgr, cv2.COLOR_BGR2RGB))
            rgba_out = np.array(rembg.remove(pil_in, session=rembg_sess))
            r_alpha = rgba_out[:, :, 3]
            fg_ratio = float(np.mean(r_alpha > 90))
            border_touch = (
                np.mean(r_alpha[:4, :] > 90) > 0.15
                and np.mean(r_alpha[-4:, :] > 90) > 0.15
                and np.mean(r_alpha[:, :4] > 90) > 0.15
                and np.mean(r_alpha[:, -4:] > 90) > 0.15
            )
            if 0.035 <= fg_ratio <= 0.80 and not border_touch:
                r_alpha = _trim_floor_reflection_tags(front_bgr, r_alpha)
                alpha_f = cv2.GaussianBlur(r_alpha.astype(np.float32) / 255.0, (3, 3), 0)
                return np.clip(alpha_f, 0.0, 1.0)
        except Exception as exc:
            logger.debug("rembg segmentation fallback skipped: %s", exc)

    lab_img = cv2.cvtColor(front_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_bg = cv2.cvtColor(studio_bg, cv2.COLOR_BGR2LAB).astype(np.float32)

    dL = lab_img[:, :, 0] - lab_bg[:, :, 0]
    da = lab_img[:, :, 1] - lab_bg[:, :, 1]
    db = lab_img[:, :, 2] - lab_bg[:, :, 2]

    chroma_diff = np.sqrt(da * da + db * db)
    delta_e = np.sqrt(dL * dL + 1.45 * (da * da + db * db))

    border_vals = np.concatenate([
        delta_e[2:14, 2 : w - 2].ravel(),
        delta_e[2 : h - 2, 2:14].ravel(),
        delta_e[2 : h - 2, w - 14 : w - 2].ravel(),
    ])
    noise_floor = float(np.percentile(border_vals, 90)) if border_vals.size else 6.0
    fg_thresh = float(np.clip(noise_floor * 1.45 + 5.5, 9.5, 24.0))

    raw_fg = (delta_e > fg_thresh) | ((grad > 20.0) & (delta_e > fg_thresh * 0.55))
    yy_norm = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    near_edge = cv2.dilate((grad > 13.0).astype(np.uint8), np.ones((9, 17), np.uint8)) > 0
    soft_shadow = (
        (yy_norm > 0.65)
        & (dL < -2.0)
        & (dL > -21.0)
        & (chroma_diff < 5.0)
        & (grad < 8.5)
        & (~near_edge)
        & (delta_e < max(21.0, fg_thresh * 1.12))
    )
    raw_fg = raw_fg & (~soft_shadow)

    strong_edges = (grad > 18.0).astype(np.uint8)
    strong_edges[:12, :] = 0
    strong_edges[-12:, :] = 0
    strong_edges[:, :12] = 0
    strong_edges[:, -12:] = 0
    eys, exs = np.where(strong_edges > 0)
    if eys.size > 30:
        sy0 = max(2, int(np.percentile(eys, 1)) - 12)
        sy1 = min(h - 2, int(np.percentile(eys, 99)) + 12)
        sx0 = max(2, int(np.percentile(exs, 1)) - 12)
        sx1 = min(w - 2, int(np.percentile(exs, 99)) + 12)
        box_mask = np.zeros_like(raw_fg)
        box_mask[sy0:sy1, sx0:sx1] = True
        raw_fg = raw_fg & box_mask

    raw_fg[:2, :] = False
    raw_fg[-2:, :] = False
    raw_fg[:, :2] = False
    raw_fg[:, -2:] = False

    mask_u8 = (raw_fg.astype(np.uint8)) * 255
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    n_cc, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_u8, connectivity=8)
    if n_cc > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        main_idx = int(np.argmax(areas)) + 1
        mx, my, mw, mh, main_area = stats[main_idx]
        keep = np.zeros_like(mask_u8)
        keep[labels == main_idx] = 255
        for idx in range(1, n_cc):
            if idx == main_idx:
                continue
            _x, y, _cw, ch, area = stats[idx]
            cx = centroids[idx][0]
            over_furniture = (mx - mw * 0.08 <= cx <= mx + mw * 1.08) and (y + ch <= my + mh * 0.65)
            if area >= main_area * 0.12 or (area >= max(45, main_area * 0.012) and over_furniture):
                keep[labels == idx] = 255
        mask_u8 = keep

    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(mask_u8.astype(np.float32) / 255.0, (3, 3), 0)
    return np.clip(alpha, 0.0, 1.0)


def _row_intervals(row_mask: np.ndarray, min_len: int = 2) -> List[Tuple[int, int]]:
    """Return contiguous (start, end) inclusive active intervals on a 1D boolean mask."""
    padded = np.concatenate(([False], row_mask, [False]))
    diffs = np.diff(padded.astype(np.int8))
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0] - 1
    return [(int(s), int(e)) for s, e in zip(starts, ends) if (e - s + 1) >= min_len]


def _analyze_structure(alpha: np.ndarray, category: str) -> Dict[str, Any]:
    """Analyze row-by-row silhouette geometry, top accessories, main body, and legs."""
    h, w = alpha.shape
    fg = alpha > 0.35
    ys, xs = np.where(fg)

    if ys.size < 25:
        return {
            "empty": True,
            "h": h,
            "w": w,
            "fg": fg,
            "x_min": w // 4,
            "x_max": (3 * w) // 4,
            "y_min": h // 4,
            "y_max": (3 * h) // 4,
            "w_f": w // 2,
            "h_f": h // 2,
            "x_c": w / 2.0,
            "row_info": {},
            "acc_y_end": None,
            "acc_x_center": None,
            "acc_w": 0,
            "has_table_slab": False,
            "body_y_start": h // 4,
            "body_y_end": (2 * h) // 3,
            "body_y_sample_start": h // 3,
            "solid_rows": [],
            "leg_y_start": (2 * h) // 3,
            "typical_leg_thick": max(8, w // 24),
            "is_oval_top": False,
        }

    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    w_f = max(1, x_max - x_min + 1)
    h_f = max(1, y_max - y_min + 1)
    x_c = 0.5 * (x_min + x_max)

    row_info: Dict[int, Dict[str, Any]] = {}
    leg_thicknesses: List[int] = []

    for y in range(y_min, y_max + 1):
        segs = _row_intervals(fg[y], min_len=2)
        if not segs:
            continue
        xL = segs[0][0]
        xR = segs[-1][1]
        span = xR - xL + 1
        fill = sum(e - s + 1 for s, e in segs)
        fill_ratio = fill / max(1, span)
        lengths = sorted(e - s + 1 for s, e in segs)
        row_info[y] = {
            "xL": xL,
            "xR": xR,
            "span": span,
            "fill": fill,
            "fill_ratio": fill_ratio,
            "segs": segs,
            "n_segs": len(segs),
            "leg_thick": lengths[0] if len(segs) >= 2 else lengths[-1],
        }
        if y > y_min + int(0.45 * h_f) and len(segs) >= 2 and fill_ratio < 0.65:
            leg_thicknesses.extend(lengths)

    typical_leg_thick = int(np.median(leg_thicknesses)) if leg_thicknesses else max(10, int(w_f * 0.065))
    typical_leg_thick = int(np.clip(typical_leg_thick, max(9, int(w_f * 0.048)), max(12, w_f // 4)))

    aspect = w_f / max(1.0, float(h_f))
    raw_cat = category.strip().lower()
    if aspect >= 1.34 and raw_cat not in ("bed", "table", "cabinet"):
        eff_cat = "sofa"
    elif raw_cat == "sofa":
        eff_cat = "sofa"
    else:
        eff_cat = raw_cat

    # Base structure detection: distinguish continuous solid plinth / sled base from separated legs
    bot_y0 = max(y_min, int(y_max - 0.25 * h_f))
    bottom_rows = [y for y in range(bot_y0, y_max + 1) if y in row_info]
    bot_fills = [row_info[y]["fill_ratio"] for y in bottom_rows]
    bot_median_fill = float(np.median(bot_fills)) if bot_fills else 0.5

    has_separated_legs = False
    leg_y_start = y_max + 1
    leg_search_y0 = y_min + int(0.55 * h_f)
    cand_leg_rows = [
        y for y in range(leg_search_y0, y_max + 1)
        if y in row_info and row_info[y]["n_segs"] >= 2 and row_info[y]["fill_ratio"] < 0.58
    ]
    if len(cand_leg_rows) >= max(6, int(0.10 * h_f)) and bot_median_fill < 0.62:
        if any(y >= y_max - int(0.12 * h_f) for y in cand_leg_rows):
            has_separated_legs = True
            leg_y_start = cand_leg_rows[0]

    base_style = "legs" if has_separated_legs else "plinth"

    # Strictly detect a narrow centered top accessory resting on a flat horizontal slab:
    # Must be narrow (< 0.42 * w_f) for at least 16 rows (>= 15% of h_f), centered near x_c,
    # and followed by a sharp step-jump to >= 0.72 * w_f (never triggered for sofas or curved crests!)
    acc_y_end = None
    acc_x_center = None
    acc_w = 0
    has_table_slab = False
    if eff_cat != "sofa":
        narrow_rows: List[int] = []
        transition_rows = 0
        min_acc_rows = max(14, int(0.15 * h_f))
        search_limit = y_min + int(0.48 * h_f)
        for y in range(y_min, search_limit + 1):
            info = row_info.get(y)
            if not info:
                continue
            if info["span"] < 0.42 * w_f and transition_rows == 0:
                narrow_rows.append(y)
            elif info["span"] >= 0.66 * w_f and len(narrow_rows) >= min_acc_rows:
                cand_cx = float(np.median([0.5 * (row_info[yy]["xL"] + row_info[yy]["xR"]) for yy in narrow_rows]))
                if abs(cand_cx - x_c) < 0.18 * w_f:
                    acc_y_end = narrow_rows[-1]
                    acc_x_center = cand_cx
                    acc_w = int(np.percentile([row_info[yy]["span"] for yy in narrow_rows], 90))
                    if leg_y_start < y_max - int(0.15 * h_f):
                        has_table_slab = True
                        eff_cat = "table"
                break
            elif len(narrow_rows) >= min_acc_rows and transition_rows < 12:
                transition_rows += 1
            else:
                break

        # Also detect a thin horizontal tabletop slab right above tall separated legs when upper object < 0.62 * slab_w
        if acc_y_end is None and leg_y_start < y_max - int(0.28 * h_f):
            slab_candidates = [
                y
                for y in range(max(y_min, leg_y_start - int(0.20 * h_f)), leg_y_start)
                if y in row_info and row_info[y]["fill_ratio"] >= 0.65 and row_info[y]["span"] >= 0.72 * w_f
            ]
            if 4 <= len(slab_candidates) <= int(0.20 * h_f):
                slab_y0 = slab_candidates[0]
                slab_w = float(np.percentile([row_info[y]["span"] for y in slab_candidates], 85))
                upper_rows = [y for y in range(y_min, slab_y0) if y in row_info]
                if len(upper_rows) >= min_acc_rows:
                    upper_w = float(np.percentile([row_info[y]["span"] for y in upper_rows], 85))
                    if upper_w < 0.64 * slab_w:
                        has_table_slab = True
                        eff_cat = "table"
                        acc_y_end = slab_y0 - 1
                        acc_x_center = float(np.median([0.5 * (row_info[yy]["xL"] + row_info[yy]["xR"]) for yy in upper_rows]))
                        acc_w = int(np.percentile([row_info[yy]["span"] for yy in upper_rows], 80))

    body_y_start = (acc_y_end + 1) if acc_y_end is not None else y_min

    if not has_separated_legs:
        body_y_end = y_max
    else:
        body_y_end = min(y_max, max(body_y_start + 4, leg_y_start - 1))

    solid_rows = [
        y
        for y in range(body_y_start, body_y_end + 1)
        if y in row_info and row_info[y]["fill_ratio"] >= 0.40 and row_info[y]["span"] >= 0.35 * w_f
    ]
    if not solid_rows:
        solid_rows = [y for y in range(body_y_start, body_y_end + 1) if y in row_info]
    if not solid_rows:
        solid_rows = [y for y in range(body_y_start, y_max + 1) if y in row_info]

    is_oval_top = False
    if (eff_cat == "table" or has_table_slab) and len(solid_rows) > 10:
        max_top_w = max(row_info[y]["span"] for y in solid_rows)
        first_w = row_info[solid_rows[0]]["span"]
        if first_w < 0.65 * max_top_w and not has_table_slab:
            is_oval_top = True
        table_top_rows = [
            y for y in solid_rows if row_info[y]["span"] >= 0.58 * max_top_w
        ]
        if table_top_rows:
            body_y_end = table_top_rows[-1]
            solid_rows = [y for y in solid_rows if y <= body_y_end]

    if has_table_slab:
        body_y_sample_start = solid_rows[0] if solid_rows else body_y_start
    elif eff_cat in ("sofa", "chair", "bed") and len(solid_rows) > 8:
        body_y_sample_start = solid_rows[int(len(solid_rows) * 0.20)]
    elif is_oval_top and len(solid_rows) > 10:
        body_y_sample_start = solid_rows[int(len(solid_rows) * 0.18)]
        body_y_end = solid_rows[int(len(solid_rows) * 0.65)]
    else:
        body_y_sample_start = solid_rows[0] if solid_rows else body_y_start

    return {
        "empty": False,
        "h": h,
        "w": w,
        "fg": fg,
        "x_min": x_min,
        "x_max": x_max,
        "y_min": y_min,
        "y_max": y_max,
        "w_f": w_f,
        "h_f": h_f,
        "x_c": x_c,
        "aspect": aspect,
        "eff_cat": eff_cat,
        "has_separated_legs": has_separated_legs,
        "base_style": base_style,
        "row_info": row_info,
        "acc_y_end": acc_y_end,
        "acc_x_center": acc_x_center,
        "acc_w": acc_w,
        "has_table_slab": has_table_slab,
        "body_y_start": body_y_start,
        "body_y_end": body_y_end,
        "body_y_sample_start": body_y_sample_start,
        "solid_rows": solid_rows,
        "leg_y_start": leg_y_start,
        "typical_leg_thick": typical_leg_thick,
        "is_oval_top": is_oval_top,
    }


def _sample_leg_strip(
    front_bgr: np.ndarray,
    fg: np.ndarray,
    row_info: Dict[int, Dict[str, Any]],
    y: int,
    width_out: int,
    leg_thick: int,
) -> np.ndarray:
    """Sample leg material strictly from the outer leg posts with vertical smoothing."""
    h, _w = front_bgr.shape[:2]
    samples = []
    for dy in (-3, -1, 0, 1, 3):
        yy = int(np.clip(y + dy, 0, h - 1))
        info = row_info.get(yy)
        if not info or not info["segs"]:
            continue
        sL, eL = info["segs"][0]
        sR, eR = info["segs"][-1]
        cL = np.arange(sL, min(eL + 1, sL + max(4, leg_thick)))
        cR = np.arange(max(sR, eR + 1 - max(4, leg_thick)), eR + 1)
        cols = np.concatenate([cL, cR]) if cL.size and cR.size else (cR if cR.size else cL)
        if cols.size > 2:
            cols = cols[1:-1] if cols.size > 5 else cols
            # Pick warm/lit wood pixels (70th percentile) so legs don't turn pure black
            pix = front_bgr[yy, cols, :].astype(np.float32)
            samples.append(np.percentile(pix, 65, axis=0))
    if not samples:
        return _sample_side_strip(front_bgr, fg, y, width_out, prefer_outer=True)
    med_col = np.median(np.stack(samples, axis=0), axis=0)
    return np.tile(med_col[None, :], (max(1, width_out), 1))


def _sample_side_strip(
    front_bgr: np.ndarray,
    fg: np.ndarray,
    y: int,
    width_out: int,
    prefer_outer: bool = True,
) -> np.ndarray:
    """
    Sample a vertically-coherent 1D material strip for a row in Side View.
    Preserves rich photoreal texture while avoiding venetian-blind row jumps.
    """
    h, _w = front_bgr.shape[:2]
    row_strips = []
    for dy in (-2, -1, 0, 1, 2):
        yc = int(np.clip(y + dy, 0, h - 1))
        cols = np.where(fg[yc])[0]
        if cols.size < 4:
            continue
        if cols.size > 8:
            cols = cols[2:-2]
        if prefer_outer and cols.size > 20:
            flank_n = max(10, cols.size // 4)
            # Pick whichever outer flank (left or right) is better lit (avoids dark side shadow)
            left_p = front_bgr[yc, cols[:flank_n], :].astype(np.float32)
            right_p = front_bgr[yc, cols[-flank_n:], :].astype(np.float32)
            pixels = left_p if np.mean(left_p) > np.mean(right_p) * 1.08 else right_p
        else:
            pixels = front_bgr[yc, cols, :].astype(np.float32)
        idx = np.linspace(0, len(pixels) - 1, max(1, width_out)).astype(np.int32)
        row_strips.append(pixels[idx])

    if not row_strips:
        return np.full((max(1, width_out), 3), 128.0, dtype=np.float32)
    return np.median(np.stack(row_strips, axis=0), axis=0)


def _extract_seamless_surface_patch(
    front_bgr: np.ndarray,
    fg: np.ndarray,
    y_start: int,
    y_end: int,
    x_left: int,
    x_right: int,
    target_h: int,
    target_w: int,
    preserve_seams: bool = False,
) -> np.ndarray:
    """
    Extract a coherent, highlight-free 2D material patch from the top-lit horizontal
    furniture surface (tabletop / seat cushions / frame). Selects the top-lit surface
    rows (excluding dark front overhang/underside shadows) and eliminates 1D barcode striping.
    """
    h, w = front_bgr.shape[:2]
    y0 = int(np.clip(y_start, 0, h - 2))
    y1 = int(np.clip(max(y0 + 3, y_end), y0 + 3, h))
    x0 = int(np.clip(x_left, 0, w - 2))
    x1 = int(np.clip(max(x0 + 4, x_right), x0 + 4, w))

    candidate_rows: List[Tuple[float, np.ndarray]] = []
    for y in range(y0, y1):
        cols = np.where(fg[y, x0:x1])[0] + x0
        if cols.size < max(6, int((x1 - x0) * 0.35)):
            continue
        if cols.size > 10:
            cols = cols[3:-3]
        row_pix = front_bgr[y, cols, :].astype(np.float32)
        pix_lum = 0.114 * row_pix[:, 0] + 0.587 * row_pix[:, 1] + 0.299 * row_pix[:, 2]
        row_lum = float(np.median(pix_lum))
        # Keep representative mid-to-lit material pixels (20th..88th percentile) so black leather stays black
        # and dark tabletop lip shadows are excluded without picking white specular glares!
        p_low = float(np.percentile(pix_lum, 20))
        p_high = float(np.percentile(pix_lum, 88))
        mid_mask = (pix_lum >= p_low) & (pix_lum <= max(p_low + 8.0, p_high))
        if np.count_nonzero(mid_mask) >= 6:
            row_pix = row_pix[mid_mask]
        resized_row = cv2.resize(row_pix[None, :, :], (target_w, 1), interpolation=cv2.INTER_LINEAR)[0]
        candidate_rows.append((row_lum, resized_row))

    if not candidate_rows:
        return np.full((target_h, target_w, 3), 128.0, dtype=np.float32)

    lums = np.array([r[0] for r in candidate_rows], dtype=np.float32)
    # If the surface has a bright top and dark shadow edge (high row-to-row luminance spread > 45),
    # select the top-lit rows; if it is uniform or dark matte black, keep the median band (25%..85%)!
    lum_spread = float(np.percentile(lums, 85) - np.percentile(lums, 15)) if len(candidate_rows) >= 5 else 0.0
    if lum_spread > 48.0 and float(np.median(lums)) < 75.0 and float(np.percentile(lums, 85)) > 95.0:
        lum_low = float(np.percentile(lums, 48))
        lum_high = float(np.percentile(lums, 96))
    else:
        lum_low = float(np.percentile(lums, 22))
        lum_high = float(np.percentile(lums, 86))
    rows_tex = [r[1] for r in candidate_rows if lum_low <= r[0] <= max(lum_low + 5.0, lum_high)]
    if not rows_tex:
        rows_tex = [r[1] for r in candidate_rows]

    patch = np.stack(rows_tex, axis=0)  # (N_rows, target_w, 3)
    dom_color = np.median(patch, axis=(0, 1))  # (3,)

    diff_dom = np.linalg.norm(patch - dom_color[None, None, :], axis=2, keepdims=True)
    inlier_w = np.clip(1.0 - np.maximum(0.0, diff_dom - 42.0) / 45.0, 0.18, 1.0)
    clean_patch = patch * inlier_w + dom_color[None, None, :] * (1.0 - inlier_w)

    if preserve_seams and clean_patch.shape[0] >= 4:
        base_profile_x = np.median(clean_patch, axis=0, keepdims=True)
        kw = max(9, (target_w // 12) | 1)
        base_profile_x = cv2.GaussianBlur(base_profile_x, (kw, 1), 0)
        grain_only = np.clip(clean_patch - np.median(clean_patch, axis=0, keepdims=True), -12.0, 12.0)
        tile_y = cv2.resize(grain_only, (target_w, max(target_h, clean_patch.shape[0])), interpolation=cv2.INTER_LINEAR)[:target_h]
        return np.clip(base_profile_x + tile_y * 0.55, 0, 255)

    med_x = np.median(clean_patch, axis=0, keepdims=True)
    kw = max(15, (target_w // 5) | 1)
    med_x_smooth = 0.55 * cv2.GaussianBlur(med_x, (kw, 1), 0) + 0.45 * dom_color[None, None, :]
    grain_res = np.clip(clean_patch - cv2.GaussianBlur(clean_patch, (1, 7), 0), -12.0, 12.0)
    grain_xy = cv2.resize(grain_res, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
    return np.clip(med_x_smooth + grain_xy * 0.70, 0, 255)


def _add_floor_shadow(
    canvas: np.ndarray,
    cx: float,
    cy: int,
    rx: float,
    ry: float,
    darkness: float = 0.24,
) -> np.ndarray:
    """Blend a realistic matte contact shadow onto a floor/studio canvas."""
    h, w = canvas.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - cx) / max(8.0, rx)) ** 2 + ((yy - cy) / max(4.0, ry)) ** 2
    shadow = darkness * np.exp(-1.8 * r2)
    out = canvas.astype(np.float32) * (1.0 - shadow[:, :, None])
    return np.clip(out, 0, 255).astype(np.uint8)


def _render_side_view(
    front_bgr: np.ndarray,
    alpha: np.ndarray,
    studio_bg: np.ndarray,
    struct: Dict[str, Any],
    category: str,
) -> np.ndarray:
    """
    Synthesize 90 deg Side Profile Elevation locked vertically 1:1 with Front View.
    Preserves top accessories (with exact leaf/part alpha mask), backrest tilt,
    curved side armrest panel, seat depth, crossbars, and outward leg splay.
    """
    h, w = front_bgr.shape[:2]
    if struct["empty"]:
        return front_bgr.copy()

    cat = category.strip().lower()
    has_table_slab = bool(struct.get("has_table_slab", False))
    eff_cat = struct.get("eff_cat", ("table" if has_table_slab else cat))
    depth_ratio = DEPTH_RATIOS.get(eff_cat, 0.72)
    if eff_cat == "sofa":
        depth_ratio = 0.58
    has_separated_legs = bool(struct.get("has_separated_legs", True))

    y_min, y_max = struct["y_min"], struct["y_max"]
    body_y_start = struct["body_y_start"]
    body_y_end = struct["body_y_end"]
    leg_y_start = struct["leg_y_start"]
    acc_y_end = struct["acc_y_end"]
    w_f = struct["w_f"]
    h_f = struct["h_f"]
    row_info = struct["row_info"]
    fg = struct["fg"]

    body_spans = [
        row_info[y]["span"]
        for y in range(body_y_start, min(y_max + 1, leg_y_start + 4))
        if y in row_info and row_info[y]["fill_ratio"] >= 0.55
    ]
    base_width = float(np.percentile(body_spans, 85)) if body_spans else float(w_f)
    raw_side_depth = base_width * depth_ratio
    if eff_cat in ("chair", "sofa") and base_width > 1.25 * h_f:
        raw_side_depth = min(raw_side_depth, h_f * 0.92)
    side_depth = max(44.0, min(w * 0.72, raw_side_depth))

    cx = w * 0.5
    z_back = cx - side_depth * 0.5
    z_front = cx + side_depth * 0.5
    leg_t = max(int(struct["typical_leg_thick"]), int(round(w_f * 0.052)), 10)

    body_h = max(1, body_y_end - body_y_start + 1)
    if eff_cat in ("chair", "sofa"):
        seat_top_y = body_y_start + int(0.42 * body_h)
        arm_top_y = body_y_start + int(0.24 * body_h)
    elif eff_cat == "bed":
        seat_top_y = body_y_start + int(0.50 * body_h)
        arm_top_y = seat_top_y
    else:
        seat_top_y = body_y_start
        arm_top_y = body_y_start

    side_bgr = studio_bg.astype(np.float32).copy()
    side_alpha = np.zeros((h, w), dtype=np.float32)

    # Estimate outward linear leg splay trend from 15%..75% of leg height (never splay inward!)
    leg_h_total = max(1, y_max - leg_y_start)
    leg_rows = [
        y
        for y in range(leg_y_start + int(0.10 * leg_h_total), y_max - int(0.15 * leg_h_total) + 1)
        if y in row_info and row_info[y]["n_segs"] >= 2
    ]
    splay_per_px = 0.0
    if len(leg_rows) >= 5:
        y_top_l, y_bot_l = leg_rows[0], leg_rows[-1]
        span_top = row_info[y_top_l]["span"]
        span_bot = row_info[y_bot_l]["span"]
        if y_bot_l > y_top_l:
            splay_per_px = float(np.clip(0.32 * ((span_bot - span_top) / (2.0 * (y_bot_l - y_top_l))), 0.0, 0.26))

    flank_patch = None
    if eff_cat in ("chair", "sofa", "bed", "cabinet") and body_y_end > body_y_start + 10:
        flank_x0 = max(0, int(struct["x_max"] - max(18, w_f * 0.22)))
        flank_patch = _extract_seamless_surface_patch(
            front_bgr,
            fg,
            struct["body_y_sample_start"],
            min(h, body_y_end + 1),
            flank_x0,
            struct["x_max"] + 1,
            max(10, body_y_end - body_y_start + 1),
            max(40, int(round(side_depth))),
            preserve_seams=False,
        )

    # Pre-compute a smooth, stripe-free 3D leg material color from the interior center of outer leg posts
    leg_color_samples = []
    for yy in range(leg_y_start, y_max + 1):
        inf_l = row_info.get(yy)
        if not inf_l or not inf_l["segs"]:
            continue
        for s_seg, e_seg in (inf_l["segs"][0], inf_l["segs"][-1]):
            seg_len = e_seg - s_seg + 1
            if seg_len < 5 or seg_len > max(38, int(w_f * 0.22)):
                continue
            # Sample strictly from the inner 50% core of each leg post (never the outer floor halo!)
            pad_in = max(2, seg_len // 4)
            c_core = np.arange(s_seg + pad_in, max(s_seg + pad_in + 1, e_seg + 1 - pad_in))
            pix_l = front_bgr[yy, c_core, :].astype(np.float32)
            leg_color_samples.append(np.median(pix_l, axis=0))
    if leg_color_samples:
        leg_base_color = np.median(np.stack(leg_color_samples, axis=0), axis=0)
    else:
        leg_base_color = np.array([45.0, 72.0, 110.0], dtype=np.float32)

    # For tables, also pre-compute clean sunlit top wood color so tabletop side profile has zero diagonal tears
    table_top_col = None
    if eff_cat == "table":
        top_patch = _extract_seamless_surface_patch(
            front_bgr,
            fg,
            body_y_start,
            max(body_y_start + 4, leg_y_start),
            struct["x_min"] + 8,
            struct["x_max"] - 8,
            16,
            max(32, int(round(side_depth))),
            preserve_seams=False,
        )
        table_top_col = np.median(top_patch, axis=(0, 1))

    for y in range(body_y_start, y_max + 1):
        info = row_info.get(y)
        if not info:
            continue

        # 2. Separated legs & lower horizontal stretcher bars (every row y >= leg_y_start)
        if has_separated_legs and y >= leg_y_start:
            dy_leg = max(0, y - leg_y_start)
            leg_prog = dy_leg / max(1.0, float(y_max - leg_y_start))
            offset = dy_leg * splay_per_px
            lx_back_c = z_back + 0.12 * side_depth - offset
            lx_front_c = z_front - 0.12 * side_depth + offset
            base_leg_w = min(leg_t, max(14, int(side_depth * 0.13)))
            taper = 1.0 - 0.24 * leg_prog
            t_row = int(np.clip(round(base_leg_w * taper), 8, max(12, int(side_depth * 0.15))))

            v_ao = 0.78 + 0.26 * min(1.0, dy_leg / max(6.0, 0.25 * leg_h_total))

            in_stretcher_zone = (leg_y_start + int(0.18 * leg_h_total)) <= y <= (y_max - int(0.24 * leg_h_total))
            has_stretcher = (
                in_stretcher_zone
                and (eff_cat == "table" or has_table_slab)
                and (info["fill_ratio"] >= 0.58 or (info["n_segs"] == 1 and info["span"] >= 0.50 * base_width))
            )
            if has_stretcher:
                rx0 = int(np.clip(round(lx_back_c), 0, w - 1))
                rx1 = int(np.clip(round(lx_front_c), rx0 + 2, w))
                rail_col = leg_base_color * 0.85
                side_bgr[y, rx0:rx1] = np.clip(rail_col[None, :], 0, 255)
                side_alpha[y, rx0:rx1] = 1.0

            for lc, shade in ((lx_back_c, 0.88), (lx_front_c, 1.04)):
                x0 = int(np.clip(round(lc - 0.5 * t_row), 0, w - 1))
                x1 = int(np.clip(round(lc + 0.5 * t_row), x0 + 2, w))
                nx = np.linspace(-1.0, 1.0, x1 - x0, dtype=np.float32)
                cyl_shade = (0.92 + 0.14 * np.cos(nx * 1.15) + 0.06 * nx)[:, None] * shade * v_ao
                side_bgr[y, x0:x1] = np.clip(leg_base_color[None, :] * cyl_shade, 0, 255)
                side_alpha[y, x0:x1] = 1.0
            continue

        # 3. Backrest + armrest profile for Chair / Sofa / Bed (continuous organic side elevation)
        if eff_cat in ("chair", "sofa", "bed") and body_y_end > body_y_start + 8:
            rake = max(0.0, 1.0 - (y - body_y_start) / max(1.0, float(seat_top_y - body_y_start))) * side_depth * 0.07
            top_round = (1.0 - min(1.0, (y - body_y_start) / 10.0)) ** 2 * 6.0
            x0 = int(np.clip(round(z_back - rake + top_round * 0.4), 0, w - 1))

            if y < arm_top_y:
                # Upper backrest extending above armrests
                back_thick = max(14.0, side_depth * (0.24 if eff_cat in ("chair", "bed") else 0.28)) - top_round
                x1 = int(np.clip(round(x0 + max(8.0, back_thick)), x0 + 4, w))
            else:
                # Armrest and seat body extending forward with curved waterfall front
                if y < seat_top_y:
                    arm_prog = (y - arm_top_y) / max(1.0, float(seat_top_y - arm_top_y))
                    arm_curve = (1.0 - min(1.0, arm_prog * 1.8)) ** 2 * side_depth * 0.08
                else:
                    arm_curve = 0.0
                x1 = int(np.clip(round(z_front - side_depth * 0.03 - arm_curve), x0 + 10, w))

            seg_w = max(4, x1 - x0)
            if flank_patch is not None and (y - body_y_start) < flank_patch.shape[0]:
                strip = cv2.resize(flank_patch[y - body_y_start : y - body_y_start + 1], (seg_w, 1))[0]
            else:
                strip = _sample_side_strip(front_bgr, fg, y, seg_w, prefer_outer=True)

            nx = np.linspace(-1.0, 1.0, seg_w, dtype=np.float32)[:, None]
            top_hi = 1.05 if (arm_top_y <= y <= arm_top_y + 4) else 1.0
            bevel = np.where((np.abs(nx) > 0.90), 0.91, 1.0)
            shade = (0.97 + 0.05 * nx - 0.03 * (nx ** 2)) * top_hi * bevel
            side_bgr[y, x0:x1] = np.clip(strip * shade, 0, 255)
            side_alpha[y, x0:x1] = 1.0
        else:
            # 4. Seat / frame / tabletop / cabinet side profile
            x0 = int(np.clip(round(z_back), 0, w - 1))
            x1 = int(np.clip(round(z_front), x0 + 4, w))
            seg_w = x1 - x0

            if eff_cat == "table" and table_top_col is not None:
                slab_h = max(1, leg_y_start - body_y_start)
                slab_prog = (y - body_y_start) / max(1.0, float(slab_h - 1))
                if slab_prog < 0.42:
                    row_col = table_top_col * (1.02 - 0.15 * (slab_prog / 0.42))
                else:
                    edge_t = (slab_prog - 0.42) / 0.58
                    row_col = (1.0 - edge_t) * (table_top_col * 0.65) + edge_t * (leg_base_color * 0.92)
                strip = np.tile(row_col[None, :], (seg_w, 1))
            elif flank_patch is not None and y >= body_y_start and (y - body_y_start) < flank_patch.shape[0]:
                f_row = cv2.resize(flank_patch[y - body_y_start : y - body_y_start + 1], (seg_w, 1))[0]
                seat_prog = (y - seat_top_y) / max(1.0, float(body_y_end - seat_top_y))
                v_atten = 1.02 - 0.18 * np.clip(seat_prog, 0.0, 1.0)
                strip = f_row * v_atten
            else:
                strip = _sample_side_strip(front_bgr, fg, y, seg_w, prefer_outer=True)

            nx = np.linspace(-1.0, 1.0, seg_w, dtype=np.float32)[:, None]
            bevel = np.where((np.abs(nx) > 0.92), 0.90, 1.0)
            shade = (0.97 + 0.06 * nx) * bevel
            side_bgr[y, x0:x1] = np.clip(strip * shade, 0, 255)
            side_alpha[y, x0:x1] = 1.0

    # 5. Composite resting top accessory (e.g. potted plant) OVER the tabletop top edge
    # so the bottom of the pot sits naturally on the center of the tabletop without being clipped!
    if acc_y_end is not None and acc_y_end >= y_min:
        acc_xs = [row_info[y]["xL"] for y in range(y_min, acc_y_end + 1) if y in row_info] + [
            row_info[y]["xR"] for y in range(y_min, acc_y_end + 1) if y in row_info
        ]
        if acc_xs:
            ax0_src = max(0, min(acc_xs) - 2)
            ax1_src = min(w - 1, max(acc_xs) + 2)
            # Extend source crop slightly into the top of the tabletop so the full pot base is included
            slab_h = max(1, leg_y_start - body_y_start)
            pot_y1 = min(h - 1, acc_y_end + min(14, int(slab_h * 0.36)))
            src_w = max(2, ax1_src - ax0_src + 1)
            src_h = max(2, pot_y1 - y_min + 1)
            dst_w = max(2, int(round(src_w * 0.94)))
            dx0 = int(np.clip(round(cx - 0.5 * dst_w), 0, w - dst_w))
            dx1 = dx0 + dst_w

            acc_crop_bgr = front_bgr[y_min : pot_y1 + 1, ax0_src : ax1_src + 1][:, ::-1].astype(np.float32)
            acc_crop_a = alpha[y_min : pot_y1 + 1, ax0_src : ax1_src + 1][:, ::-1].astype(np.float32)
            # In the tabletop overlap rows [acc_y_end - y_min : src_h], clamp horizontal mask to the pot's profile at acc_y_end - 2
            pot_ref_row = max(0, min(acc_crop_a.shape[0] - 1, (acc_y_end - y_min) - 2))
            pot_col_mask = acc_crop_a[pot_ref_row : pot_ref_row + 1, :]
            if (acc_y_end - y_min) < acc_crop_a.shape[0]:
                acc_crop_a[acc_y_end - y_min :, :] = np.minimum(acc_crop_a[acc_y_end - y_min :, :], pot_col_mask)
            acc_res_bgr = cv2.resize(acc_crop_bgr, (dst_w, src_h), interpolation=cv2.INTER_LINEAR)
            acc_res_a = cv2.resize(acc_crop_a, (dst_w, src_h), interpolation=cv2.INTER_LINEAR)

            nx_acc = np.linspace(-1.0, 1.0, dst_w, dtype=np.float32)[None, :, None]
            sh_acc = 0.96 + 0.05 * np.cos(nx_acc * 1.1) + 0.03 * nx_acc
            acc_shaded = np.clip(acc_res_bgr * sh_acc, 0, 255)
            roi_side = side_bgr[y_min : pot_y1 + 1, dx0:dx1]
            side_bgr[y_min : pot_y1 + 1, dx0:dx1] = acc_shaded * acc_res_a[:, :, None] + roi_side * (1.0 - acc_res_a[:, :, None])
            side_alpha[y_min : pot_y1 + 1, dx0:dx1] = np.maximum(side_alpha[y_min : pot_y1 + 1, dx0:dx1], acc_res_a)

    side_alpha = cv2.GaussianBlur(side_alpha, (3, 3), 0)
    shadowed_bg = _add_floor_shadow(studio_bg, cx, y_max + 2, side_depth * 0.62, max(8.0, h * 0.032), darkness=0.22)
    comp = side_bgr * side_alpha[:, :, None] + shadowed_bg.astype(np.float32) * (1.0 - side_alpha[:, :, None])
    return np.clip(comp, 0, 255).astype(np.uint8)


def _render_top_view(
    front_bgr: np.ndarray,
    alpha: np.ndarray,
    floor_bg: np.ndarray,
    struct: Dict[str, Any],
    category: str,
) -> np.ndarray:
    """
    Synthesize 90 deg Overhead Plan View (Bird's-Eye View) locked horizontally 1:1 with
    the Front View. Preserves true top-lit material grain, cushion seams, backrest crest,
    and any top resting accessory (such as a potted plant).
    """
    h, w = front_bgr.shape[:2]
    if struct["empty"]:
        return front_bgr.copy()

    cat = category.strip().lower()
    has_table_slab = bool(struct.get("has_table_slab", False))
    eff_cat = struct.get("eff_cat", ("table" if has_table_slab else cat))
    depth_ratio = DEPTH_RATIOS.get(eff_cat, 0.72)
    if eff_cat == "sofa":
        depth_ratio = 0.58

    x_min, x_max = struct["x_min"], struct["x_max"]
    body_y_start = struct["body_y_start"]
    body_y_end = struct["body_y_end"]
    body_y_sample_start = struct["body_y_sample_start"]
    acc_y_end = struct["acc_y_end"]
    row_info = struct["row_info"]
    fg = struct["fg"]

    solid_xL = [row_info[y]["xL"] for y in struct["solid_rows"] if y in row_info]
    solid_xR = [row_info[y]["xR"] for y in struct["solid_rows"] if y in row_info]
    bx0 = int(np.percentile(solid_xL, 10)) if solid_xL else x_min
    bx1 = int(np.percentile(solid_xR, 90)) if solid_xR else x_max
    bx0 = max(16, bx0)
    bx1 = min(w - 16, max(bx0 + 40, bx1))
    top_w = bx1 - bx0 + 1

    raw_top_d = top_w * depth_ratio
    if eff_cat in ("chair", "sofa") and top_w > 1.25 * struct["h_f"]:
        raw_top_d = min(raw_top_d, struct["h_f"] * 0.92)
    top_d = int(np.clip(round(raw_top_d), int(h * 0.28), int(h * 0.74)))
    by0 = int((h - top_d) // 2)
    by1 = by0 + top_d

    canvas = _add_floor_shadow(
        floor_bg,
        0.5 * (bx0 + bx1) + 6,
        0.5 * (by0 + by1) + 12,
        top_w * (0.50 if struct["is_oval_top"] else 0.56),
        top_d * (0.50 if struct["is_oval_top"] else 0.56),
        darkness=0.28,
    )
    out = canvas.astype(np.float32).copy()

    sample_y1 = (
        body_y_start + max(6, int((body_y_end - body_y_start) * 0.75))
        if eff_cat in ("chair", "sofa", "bed") and (body_y_end - body_y_start) > 20
        else body_y_end + 1
    )
    main_patch = _extract_seamless_surface_patch(
        front_bgr,
        fg,
        body_y_sample_start,
        max(body_y_sample_start + 4, sample_y1),
        bx0 + (12 if struct["is_oval_top"] else 4),
        bx1 - (12 if struct["is_oval_top"] else 4),
        top_d,
        top_w,
        preserve_seams=(eff_cat in ("sofa", "chair", "bed")),
    )

    yy, xx = np.mgrid[0:top_d, 0:top_w].astype(np.float32)
    yn = (yy - 0.5 * (top_d - 1)) / max(1.0, 0.5 * (top_d - 2))
    xn = (xx - 0.5 * (top_w - 1)) / max(1.0, 0.5 * (top_w - 2))
    if struct["is_oval_top"]:
        shape_r = np.sqrt(xn * xn + yn * yn)
        rect_mask = np.clip((1.0 - shape_r) * (min(top_d, top_w) * 0.25), 0.0, 1.0)
        edge_factor = np.clip(1.0 - np.maximum(0.0, shape_r - 0.92) * 1.4, 0.86, 1.0)
    else:
        p = 10.0
        shape_r = (np.abs(xn) ** p + np.abs(yn) ** p) ** (1.0 / p)
        rect_mask = np.clip((1.0 - shape_r) * (min(top_d, top_w) * 0.28), 0.0, 1.0)
        edge_factor = np.clip(1.0 - np.maximum(0.0, shape_r - 0.94) * 1.6, 0.88, 1.0)

    rect_mask = cv2.GaussianBlur(rect_mask, (3, 3), 0)

    light = 1.04 - 0.12 * (xn * xn + yn * yn)
    shaded_top = np.clip(main_patch * (light * edge_factor)[:, :, None], 0, 255)

    if eff_cat in ("chair", "sofa", "bed"):
        back_depth = max(16, int(top_d * (0.22 if eff_cat != "bed" else 0.12)))
        crest_patch = _extract_seamless_surface_patch(
            front_bgr,
            fg,
            body_y_start + 2,
            min(body_y_end, body_y_start + max(8, int((body_y_end - body_y_start) * 0.28))),
            bx0 + 6,
            bx1 - 6,
            back_depth,
            top_w,
            preserve_seams=True,
        )
        # Rear backrest band with top-lit crest
        shaded_top[:back_depth] = np.clip(crest_patch * 1.02, 0, 255)
        # Drop shadow behind backrest into seating well
        sh_end = min(top_d, back_depth + 14)
        for dy in range(back_depth, sh_end):
            atten = 0.82 + 0.18 * ((dy - back_depth) / max(1, sh_end - back_depth))
            shaded_top[dy] *= atten

        if eff_cat in ("chair", "sofa") and top_w > 60:
            arm_w = max(14, int(top_w * (0.13 if eff_cat == "chair" else 0.12)))
            # Left and right armrest caps
            arm_col = np.median(crest_patch, axis=(0, 1))
            arm_yn = np.linspace(-1.0, 1.0, top_d - back_depth // 2, dtype=np.float32)[:, None, None]
            arm_xn = np.linspace(-1.0, 1.0, arm_w, dtype=np.float32)[None, :, None]
            arm_sh = 0.98 - 0.08 * (arm_xn ** 2) - 0.04 * (arm_yn ** 2)
            arm_surf = np.clip(arm_col[None, None, :] * arm_sh, 0, 255)
            shaded_top[back_depth // 2 :, :arm_w] = 0.72 * arm_surf + 0.28 * shaded_top[back_depth // 2 :, :arm_w]
            shaded_top[back_depth // 2 :, -arm_w:] = 0.72 * arm_surf + 0.28 * shaded_top[back_depth // 2 :, -arm_w:]
            # Inner armrest crevice shadow
            shaded_top[back_depth :, arm_w : min(top_w, arm_w + 5)] *= 0.82
            shaded_top[back_depth :, max(0, top_w - arm_w - 5) : top_w - arm_w] *= 0.82

            # Individual Seat Cushions inside the seating well
            well_x0 = arm_w + 2
            well_x1 = max(well_x0 + 20, top_w - arm_w - 2)
            well_w = well_x1 - well_x0
            well_y0 = back_depth + 2
            well_y1 = max(well_y0 + 20, top_d - 4)
            well_d = well_y1 - well_y0

            aspect_ratio = struct.get("aspect", float(top_w) / max(1.0, float(top_d)))
            n_cush = 1 if eff_cat == "chair" else (3 if (aspect_ratio >= 1.50 or top_w / max(1.0, float(top_d)) >= 1.55) else 2)
            cush_w_each = well_w / float(n_cush)

            for ci in range(n_cush):
                cx0 = int(well_x0 + ci * cush_w_each)
                cx1 = int(well_x0 + (ci + 1) * cush_w_each) if ci < n_cush - 1 else well_x1
                cw_cur = max(4, cx1 - cx0)

                # Pillowed 3D convex dome for each cushion
                yy_c, xx_c = np.mgrid[0:well_d, 0:cw_cur].astype(np.float32)
                x_norm = (xx_c - 0.5 * (cw_cur - 1)) / max(1.0, 0.5 * (cw_cur - 2))
                y_norm = (yy_c - 0.5 * (well_d - 1)) / max(1.0, 0.5 * (well_d - 2))
                dome = 1.05 - 0.20 * (x_norm ** 4 + y_norm ** 4)
                # Front bullnose highlight
                front_lip = np.where(y_norm > 0.82, 1.06, 1.0)
                # Apply cushion dome
                shaded_top[well_y0:well_y1, cx0:cx1] = np.clip(
                    shaded_top[well_y0:well_y1, cx0:cx1] * (dome * front_lip)[:, :, None], 0, 255
                )

                # Seam crevice shadow between adjacent cushions
                if ci > 0:
                    seam_x = cx0
                    for dx in range(-2, 3):
                        px = seam_x + dx
                        if 0 <= px < top_w:
                            s_factor = 0.65 + 0.12 * abs(dx)
                            shaded_top[well_y0:well_y1, px] *= s_factor

    roi = out[by0:by1, bx0 : bx0 + top_w]
    m3 = rect_mask[:, :, None]
    out[by0:by1, bx0 : bx0 + top_w] = shaded_top * m3 + roi * (1.0 - m3)

    # Top resting accessory (e.g. potted plant) overhead projection - ONLY for Tables!
    if eff_cat == "table" and acc_y_end is not None and struct["acc_x_center"] is not None:
        acc_cx = float(np.clip(struct["acc_x_center"], bx0 + 24, bx1 - 24))
        acc_cy = float(0.5 * (by0 + by1))
        acc_h = max(6, acc_y_end - struct["y_min"] + 1)
        acc_r = max(16.0, min(top_d * 0.36, float(struct["acc_w"]) * 0.42, float(acc_h) * 0.42))

        split_y = struct["y_min"] + max(3, int(acc_h * 0.58))
        # Sample vivid foliage colors (upper 58% of accessory) & ceramic pot color (lower 42%)
        leaf_pixels = []
        pot_pixels = []
        for y in range(struct["y_min"], acc_y_end + 1):
            cols = np.where(fg[y])[0]
            if cols.size == 0:
                continue
            pix = front_bgr[y, cols, :].astype(np.float32)
            if y < split_y:
                leaf_pixels.append(pix)
            else:
                pot_pixels.append(pix)

        if leaf_pixels:
            all_leaf = np.concatenate(leaf_pixels, axis=0)
            # Prefer green-dominant foliage pixels if present
            green_score = all_leaf[:, 1] - 0.5 * (all_leaf[:, 0] + all_leaf[:, 2])
            vivid = all_leaf[green_score >= np.percentile(green_score, 45)]
            leaf_col = np.median(vivid if vivid.size else all_leaf, axis=0)
        else:
            leaf_col = np.array([45.0, 125.0, 60.0], dtype=np.float32)

        pot_col = np.median(np.concatenate(pot_pixels, axis=0), axis=0) if pot_pixels else leaf_col

        ay0 = max(0, int(acc_cy - acc_r - 10))
        ay1 = min(h, int(acc_cy + acc_r + 12))
        ax0 = max(0, int(acc_cx - acc_r - 10))
        ax1 = min(w, int(acc_cx + acc_r + 12))
        yy_a, xx_a = np.mgrid[ay0:ay1, ax0:ax1].astype(np.float32)
        dx = xx_a - acc_cx
        dy = yy_a - acc_cy
        dist_a = np.hypot(dx, dy)
        sh_dist2 = ((dx - 4.0) / (acc_r * 0.85)) ** 2 + ((dy - 5.0) / (acc_r * 0.85)) ** 2
        out[ay0:ay1, ax0:ax1] *= (1.0 - 0.30 * np.exp(-2.2 * sh_dist2))[:, :, None]

        # Render ceramic pot rim circle + radiating organic leaf blades from overhead
        pot_r = acc_r * 0.56
        pot_mask = np.clip((pot_r - dist_a) * 0.8, 0.0, 1.0)
        pot_shade = np.clip(1.06 - 0.22 * (dist_a / max(1.0, pot_r)) ** 2, 0.78, 1.08)
        pot_layer = np.clip(pot_col[None, None, :] * pot_shade[:, :, None], 0, 255)
        # Soil center inside pot
        soil_mask = np.clip((pot_r * 0.78 - dist_a) * 0.8, 0.0, 1.0)[:, :, None]
        pot_layer = pot_layer * (1.0 - 0.55 * soil_mask)
        out[ay0:ay1, ax0:ax1] = pot_layer * pot_mask[:, :, None] + out[ay0:ay1, ax0:ax1] * (1.0 - pot_mask[:, :, None])

        theta = np.arctan2(dy, dx)
        petal_wave = 0.55 + 0.45 * np.abs(np.cos(3.0 * theta + 0.4)) ** 1.4
        eff_r = acc_r * petal_wave
        leaf_mask = np.clip((eff_r - dist_a) * 0.75, 0.0, 1.0)
        leaf_shade = np.clip(0.88 + 0.24 * (dist_a / max(1.0, acc_r)) - 0.08 * np.abs(np.sin(6.0 * theta)), 0.75, 1.12)
        leaf_layer = np.clip(leaf_col[None, None, :] * leaf_shade[:, :, None], 0, 255)
        out[ay0:ay1, ax0:ax1] = leaf_layer * leaf_mask[:, :, None] + out[ay0:ay1, ax0:ax1] * (1.0 - leaf_mask[:, :, None])

    return np.clip(out, 0, 255).astype(np.uint8)


def _render_back_view(
    front_bgr: np.ndarray,
    alpha: np.ndarray,
    studio_bg: np.ndarray,
    struct: Dict[str, Any],
    category: str,
) -> np.ndarray:
    """
    Synthesize 180 deg Back View Elevation preserving exact 2D silhouette, mirrored
    symmetry, resting accessories, legs, and a solid enclosed rear backrest shell
    for sofas, chairs, beds, and cabinets (completely occluding front cushions/pillows).
    """
    if struct["empty"]:
        return front_bgr[:, ::-1].copy()

    cat = category.strip().lower()
    has_table_slab = bool(struct.get("has_table_slab", False))
    eff_cat = struct.get("eff_cat", ("table" if has_table_slab else cat))
    h, w = front_bgr.shape[:2]

    back_bgr = front_bgr[:, ::-1].astype(np.float32).copy()
    back_alpha = alpha[:, ::-1].copy()

    x_min_m = max(0, w - 1 - struct["x_max"])
    x_max_m = min(w - 1, w - 1 - struct["x_min"])
    b_y0 = struct["body_y_start"]
    b_y1 = struct["body_y_end"]

    if eff_cat in ("chair", "sofa", "bed", "cabinet") and b_y1 > b_y0 + 16 and x_max_m > x_min_m + 16:
        panel_h = b_y1 - b_y0 + 1
        panel_w = x_max_m - x_min_m + 1
        roi_bgr = back_bgr[b_y0 : b_y1 + 1, x_min_m : x_max_m + 1]
        roi_alpha = back_alpha[b_y0 : b_y1 + 1, x_min_m : x_max_m + 1]

        # Extract outer structural frame / upholstery color from outer flanks and lower frame
        # (excluding interior accent throw pillows) to build a solid rear back shell
        frame_pixels = []
        for yy in range(panel_h):
            cols = np.where(roi_alpha[yy] > 0.55)[0]
            if cols.size < 6:
                continue
            flank_w = max(4, int(cols.size * 0.16))
            if yy > int(panel_h * 0.62):
                # Lower base / frame upholstery
                c_idx = cols[2:-2] if cols.size > 8 else cols
            else:
                # Left and right outer frame flanks
                c_idx = np.concatenate([cols[:flank_w], cols[-flank_w:]])
            frame_pixels.append(roi_bgr[yy, c_idx, :])

        if frame_pixels:
            all_fp = np.concatenate(frame_pixels, axis=0)
            base_frame_col = np.median(all_fp, axis=0)
        else:
            base_frame_col = np.median(roi_bgr[roi_alpha > 0.5], axis=0) if np.any(roi_alpha > 0.5) else np.array([90.0, 100.0, 120.0], dtype=np.float32)

        # Build row-wise rear material profile clamped near the structural frame tone
        row_cols = np.zeros((panel_h, 3), dtype=np.float32)
        for yy in range(panel_h):
            cols = np.where(roi_alpha[yy] > 0.55)[0]
            if cols.size >= 6:
                flank_w = max(3, int(cols.size * 0.18))
                flank_pix = np.concatenate([roi_bgr[yy, cols[:flank_w], :], roi_bgr[yy, cols[-flank_w:], :]], axis=0)
                med_r = np.median(flank_pix, axis=0)
                # Blend toward base_frame_col if row flank has accent pillow bleed
                dist_f = float(np.linalg.norm(med_r - base_frame_col))
                w_base = float(np.clip((dist_f - 28.0) / 45.0, 0.25, 0.85))
                row_cols[yy] = (1.0 - w_base) * med_r + w_base * base_frame_col
            else:
                row_cols[yy] = base_frame_col

        kv = max(9, (panel_h // 6) | 1)
        row_cols_smooth = cv2.GaussianBlur(row_cols[:, None, :], (1, kv), 0)

        nx = np.linspace(-1.0, 1.0, panel_w, dtype=np.float32)[None, :, None]
        ny = np.linspace(-1.0, 1.0, panel_h, dtype=np.float32)[:, None, None]
        # Convex 3D rear upholstery shading + authentic vertical tailored seams
        cyl_x = 0.94 + 0.08 * np.cos(nx * 1.25) + 0.03 * nx
        vert_y = 1.02 - 0.10 * np.clip((ny + 1.0) * 0.5, 0.0, 1.0)
        aspect_ratio = struct.get("aspect", float(panel_w) / max(1.0, float(panel_h)))
        if aspect_ratio >= 1.50:
            # 3-cushion division: 2 vertical tailored seams
            seam_atten = (
                1.0
                - 0.07 * np.exp(-((nx - 0.33) / 0.022) ** 2)
                - 0.07 * np.exp(-((nx + 0.33) / 0.022) ** 2)
            )
        else:
            # 2-cushion division: 1 center tailored seam
            seam_atten = 1.0 - 0.08 * np.exp(-(nx / 0.025) ** 2)
        rear_shell = np.clip(row_cols_smooth * cyl_x * vert_y * seam_atten, 0, 255)

        # Preserve fine surface grain without letting front throw pillows bleed through
        k_grain = 7
        high_freq = np.clip(roi_bgr - cv2.GaussianBlur(roi_bgr, (k_grain, k_grain), 0), -6.0, 6.0)
        rear_shell = np.clip(rear_shell + high_freq * 0.30, 0, 255)

        # 100% occlusion of front cushions, pillows, and seating seams
        body_mask = (roi_alpha > 0.40).astype(np.float32)
        body_mask_f = cv2.GaussianBlur(body_mask, (5, 5), 0)[:, :, None]
        flank_mask = cv2.erode(body_mask, np.ones((7, 7), np.uint8))[:, :, None]
        solid_rear = rear_shell * flank_mask + roi_bgr * (1.0 - flank_mask)
        back_bgr[b_y0 : b_y1 + 1, x_min_m : x_max_m + 1] = (
            solid_rear * body_mask_f + back_bgr[b_y0 : b_y1 + 1, x_min_m : x_max_m + 1] * (1.0 - body_mask_f)
        )

    cx_m = float(w - 1) - struct["x_c"]
    shadowed_bg = _add_floor_shadow(
        studio_bg, cx_m, struct["y_max"] + 2, struct["w_f"] * 0.56, max(8.0, h * 0.032), darkness=0.22
    )
    comp = back_bgr * back_alpha[:, :, None] + shadowed_bg.astype(np.float32) * (1.0 - back_alpha[:, :, None])
    return np.clip(comp, 0, 255).astype(np.uint8)


def _rasterize_3d_view_onto_bg(
    verts: np.ndarray,
    faces: np.ndarray,
    v_normals: np.ndarray,
    v_colors_rgb: np.ndarray,
    yaw_deg: float,
    pitch_deg: float,
    bg_bgr: np.ndarray,
    target_bbox: Optional[Tuple[int, int, int, int]] = None,
    is_top_view: bool = False,
) -> np.ndarray:
    """
    Supersampled software 3D z-buffer rasterizer with barycentric normal & color
    interpolation, studio 3-point lighting, ambient occlusion, and contact shadow.
    """
    out_h, out_w = bg_bgr.shape[:2]
    ss = 768
    scale_ss = ss / float(max(out_h, out_w))

    yr = np.deg2rad(yaw_deg)
    pr = np.deg2rad(pitch_deg)
    cy, sy = np.cos(yr), np.sin(yr)
    cp, sp = np.cos(pr), np.sin(pr)

    ry = np.array([[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]], dtype=np.float32)
    rx = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]], dtype=np.float32)
    rot = rx @ ry

    v = verts @ rot.T
    n = v_normals @ rot.T
    n_len = np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)
    n = n / n_len

    vmin = v.min(axis=0)
    vmax = v.max(axis=0)
    v_ext = np.maximum(vmax - vmin, 1e-4)

    # Studio 3-point lighting + vertical ground ambient occlusion per vertex
    key_dir = np.array([0.28, 0.46, 0.84], dtype=np.float32)
    fill_dir = np.array([-0.45, 0.25, 0.65], dtype=np.float32)
    rim_dir = np.array([0.0, 0.75, -0.55], dtype=np.float32)

    ndotl_key = np.clip(n @ key_dir, 0.0, 1.0)
    ndotl_fill = np.clip(n @ fill_dir, 0.0, 1.0)
    ndotl_rim = np.clip(n @ rim_dir, 0.0, 1.0)

    # Height fraction in world Y before camera pitch for realistic floor AO
    y_world_norm = np.clip((verts[:, 1] - verts[:, 1].min()) / max(float(verts[:, 1].max() - verts[:, 1].min()), 1e-4), 0.0, 1.0)
    ao = 0.90 + 0.10 * np.clip(y_world_norm / 0.25, 0.0, 1.0)
    shade = ((0.76 + 0.20 * ndotl_key + 0.07 * ndotl_fill + 0.04 * ndotl_rim) * ao)[:, None]
    lit_rgb = np.clip(v_colors_rgb * shade, 0.0, 1.0)

    # Map projected (X, Y) to match the Front View floor line & height
    if target_bbox is not None and not is_top_view:
        fx0, fy0, fx1, fy1 = target_bbox
        fh = max(32.0, float(fy1 - fy0))
        max_w = float(out_w) * 0.82
        px_per_unit = min(fh / float(v_ext[1]), max_w / float(v_ext[0]))
        proj_w = float(v_ext[0]) * px_per_unit
        proj_h = float(v_ext[1]) * px_per_unit
        cx_px = float(out_w) * 0.5
        bot_y_px = float(fy1)
        top_y_px = bot_y_px - proj_h
        vx_px = (cx_px + (v[:, 0] - 0.5 * (vmin[0] + vmax[0])) * px_per_unit) * scale_ss
        vy_px = (bot_y_px - (v[:, 1] - vmin[1]) * px_per_unit) * scale_ss
        shadow_cy = int(round(bot_y_px))
        shadow_rx = max(16.0, proj_w * 0.54)
        shadow_ry = max(8.0, out_h * 0.034)
    else:
        if target_bbox is not None:
            fx0, fy0, fx1, fy1 = target_bbox
            fw = max(48.0, float(fx1 - fx0))
            max_h = float(out_h) * 0.76
            px_per_unit = min(fw / float(v_ext[0]), max_h / float(v_ext[1]))
        else:
            px_per_unit = (float(min(out_w, out_h)) * 0.72) / float(max(v_ext[0], v_ext[1]))
        proj_w = float(v_ext[0]) * px_per_unit
        proj_h = float(v_ext[1]) * px_per_unit
        cx_px = float(out_w) * 0.5
        cy_px = float(out_h) * 0.5
        vx_px = (cx_px + (v[:, 0] - 0.5 * (vmin[0] + vmax[0])) * px_per_unit) * scale_ss
        vy_px = (cy_px - (v[:, 1] - 0.5 * (vmin[1] + vmax[1])) * px_per_unit) * scale_ss
        shadow_cy = int(round(cy_px + 8))
        shadow_rx = max(20.0, proj_w * 0.54)
        shadow_ry = max(16.0, proj_h * 0.54)

    vz = v[:, 2]

    # Pre-filter faces to front-facing or double-sided sorted by depth
    f0 = faces[:, 0]
    f1 = faces[:, 1]
    f2 = faces[:, 2]
    x0, y0, z0 = vx_px[f0], vy_px[f0], vz[f0]
    x1, y1, z1 = vx_px[f1], vy_px[f1], vz[f1]
    x2, y2, z2 = vx_px[f2], vy_px[f2], vz[f2]

    denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    valid_tri = np.abs(denom) > 1e-4
    valid_idx = np.where(valid_tri)[0]

    zbuf = np.full((ss, ss), -1e9, dtype=np.float32)
    cbuf = np.zeros((ss, ss, 3), dtype=np.float32)
    abuf = np.zeros((ss, ss), dtype=np.float32)

    ix0 = np.clip(np.floor(np.minimum(np.minimum(x0, x1), x2)).astype(np.int32), 0, ss - 1)
    ix1 = np.clip(np.ceil(np.maximum(np.maximum(x0, x1), x2)).astype(np.int32), 0, ss - 1)
    iy0 = np.clip(np.floor(np.minimum(np.minimum(y0, y1), y2)).astype(np.int32), 0, ss - 1)
    iy1 = np.clip(np.ceil(np.maximum(np.maximum(y0, y1), y2)).astype(np.int32), 0, ss - 1)
    inv_denom = np.where(valid_tri, 1.0 / np.where(valid_tri, denom, 1.0), 0.0)

    c0_all = lit_rgb[f0]
    c1_all = lit_rgb[f1]
    c2_all = lit_rgb[f2]

    for idx in valid_idx:
        bx0, bx1 = int(ix0[idx]), int(ix1[idx])
        by0, by1 = int(iy0[idx]), int(iy1[idx])
        if bx1 < bx0 or by1 < by0:
            continue
        tx0, ty0, tz0 = float(x0[idx]), float(y0[idx]), float(z0[idx])
        tx1, ty1, tz1 = float(x1[idx]), float(y1[idx]), float(z1[idx])
        tx2, ty2, tz2 = float(x2[idx]), float(y2[idx]), float(z2[idx])
        inv_d = float(inv_denom[idx])

        py, px = np.mgrid[by0 : by1 + 1, bx0 : bx1 + 1].astype(np.float32)
        w0 = ((ty1 - ty2) * (px - tx2) + (tx2 - tx1) * (py - ty2)) * inv_d
        w1 = ((ty2 - ty0) * (px - tx2) + (tx0 - tx2) * (py - ty2)) * inv_d
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not np.any(inside):
            continue
        pz = w0 * tz0 + w1 * tz1 + w2 * tz2
        cur_z = zbuf[by0 : by1 + 1, bx0 : bx1 + 1]
        upd = inside & (pz > cur_z)
        if not np.any(upd):
            continue
        cur_z[upd] = pz[upd]
        col = (
            w0[upd, None] * c0_all[idx]
            + w1[upd, None] * c1_all[idx]
            + w2[upd, None] * c2_all[idx]
        )
        cbuf[by0 : by1 + 1, bx0 : bx1 + 1][upd] = col
        abuf[by0 : by1 + 1, bx0 : bx1 + 1][upd] = 1.0

    # Fill any tiny 1px inter-triangle gaps inside the silhouette before downsampling
    abuf_u8 = (abuf > 0.5).astype(np.uint8) * 255
    closed_u8 = cv2.morphologyEx(abuf_u8, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    gap_mask = (closed_u8 > 0) & (abuf <= 0.5)
    if np.any(gap_mask):
        blurred_c = cv2.GaussianBlur(cbuf, (3, 3), 0)
        blurred_a = np.maximum(1e-4, cv2.GaussianBlur(abuf, (3, 3), 0))[:, :, None]
        cbuf[gap_mask] = (blurred_c / blurred_a)[gap_mask]
        abuf[gap_mask] = 1.0

    rgb_512 = cv2.resize(cbuf, (out_w, out_h), interpolation=cv2.INTER_AREA)
    alpha_512 = cv2.resize(abuf, (out_w, out_h), interpolation=cv2.INTER_AREA)
    alpha_512 = np.clip(cv2.GaussianBlur(alpha_512, (3, 3), 0), 0.0, 1.0)

    # Unsharp RGB divide on premultiplied edges so silhouette edges have zero dark halo
    fg_bgr = np.clip(rgb_512[:, :, ::-1] * 255.0, 0.0, 255.0)
    safe_a = np.maximum(alpha_512[:, :, None], 1e-3)
    unpremult_bgr = np.where(alpha_512[:, :, None] > 0.05, np.clip(fg_bgr / safe_a, 0.0, 255.0), fg_bgr)

    shadowed_bg = _add_floor_shadow(
        bg_bgr,
        out_w * 0.5 + (5.0 if is_top_view else 0.0),
        shadow_cy,
        shadow_rx,
        shadow_ry,
        darkness=0.26 if is_top_view else 0.22,
    )
    comp = unpremult_bgr * alpha_512[:, :, None] + shadowed_bg.astype(np.float32) * (1.0 - alpha_512[:, :, None])
    return np.clip(comp, 0, 255).astype(np.uint8)


def _clean_studio_bg_from_alpha(front_bgr: np.ndarray, alpha: np.ndarray, fallback_bg: np.ndarray) -> np.ndarray:
    """
    Rebuild an empty studio wall + floor from true background pixels only (furniture
    mask dilated, cast shadows rejected), so no furniture color streaks ever appear.
    """
    h, w = front_bgr.shape[:2]
    fg = cv2.dilate((alpha > 0.08).astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    lum = (0.114 * front_bgr[:, :, 0] + 0.587 * front_bgr[:, :, 1] + 0.299 * front_bgr[:, :, 2]).astype(np.float32)
    half = w // 2
    left_cols = np.zeros((h, 3), dtype=np.float32)
    right_cols = np.zeros((h, 3), dtype=np.float32)
    valid_l = np.zeros(h, dtype=bool)
    valid_r = np.zeros(h, dtype=bool)
    for y in range(h):
        bg_row = ~fg[y]
        if np.count_nonzero(bg_row) < 6:
            continue
        ref = float(np.percentile(lum[y][bg_row], 80))
        good = bg_row & (lum[y] > ref - 22.0)
        gl = good.copy()
        gl[half:] = False
        gr = good.copy()
        gr[:half] = False
        if np.count_nonzero(gl) >= 4:
            left_cols[y] = np.median(front_bgr[y][gl], axis=0)
            valid_l[y] = True
        if np.count_nonzero(gr) >= 4:
            right_cols[y] = np.median(front_bgr[y][gr], axis=0)
            valid_r[y] = True
    if not valid_l.any() and not valid_r.any():
        return fallback_bg
    if not valid_l.any():
        left_cols, valid_l = right_cols.copy(), valid_r.copy()
    if not valid_r.any():
        right_cols, valid_r = left_cols.copy(), valid_l.copy()
    rows = np.arange(h)
    for cols, valid in ((left_cols, valid_l), (right_cols, valid_r)):
        idx = np.where(valid)[0]
        for c in range(3):
            cols[:, c] = np.interp(rows, idx, cols[idx, c])
    k_v = max(9, (h // 20) | 1)
    left_s = cv2.GaussianBlur(left_cols[:, None, :], (1, k_v), 0)[:, 0, :]
    right_s = cv2.GaussianBlur(right_cols[:, None, :], (1, k_v), 0)[:, 0, :]
    t = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :, None]
    bg = left_s[:, None, :] * (1.0 - t) + right_s[:, None, :] * t
    return np.clip(bg, 0, 255).astype(np.uint8)


def render_multiviews_from_3d_mesh(
    mesh: Any,
    front_bgr: np.ndarray,
    prefix: str,
    output_dir: Path,
    front_url: Optional[str] = None,
    srgb_colors: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """
    Render 100% geometrically consistent Side (90 deg), Top (90 deg Overhead),
    Back (180 deg), and 2x2 Multi-View Sheet directly from the leveled 3D mesh.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    verts = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.int32)
    v_normals = np.asarray(mesh.vertex_normals, dtype=np.float32)

    if srgb_colors is not None and len(srgb_colors) == len(verts):
        sc = np.asarray(srgb_colors, dtype=np.float32)
        if sc.max() > 1.05:
            sc = sc / 255.0
        v_colors_rgb = np.clip(sc[:, :3], 0.0, 1.0)
    elif hasattr(mesh, "visual") and hasattr(mesh.visual, "vertex_colors") and mesh.visual.vertex_colors is not None:
        vc = np.asarray(mesh.visual.vertex_colors, dtype=np.float32)[:, :3]
        if vc.max() > 1.05:
            vc = vc / 255.0
        v_colors_rgb = np.clip(vc, 0.0, 1.0)
    else:
        v_colors_rgb = np.full((len(verts), 3), 0.72, dtype=np.float32)

    edge_hint = _find_associated_edge_map(prefix, output_dir, front_bgr.shape[:2])
    initial_bg = _reconstruct_studio_bg(front_bgr)
    alpha = _segment_front_image(front_bgr, initial_bg, edge_hint=edge_hint)
    studio_bg = _clean_studio_bg_from_alpha(front_bgr, alpha, initial_bg)
    floor_bg = _reconstruct_floor_bg(front_bgr, studio_bg)

    ys, xs = np.where(alpha > 0.35)
    h, w = front_bgr.shape[:2]
    if ys.size >= 25:
        target_bbox: Optional[Tuple[int, int, int, int]] = (
            int(xs.min()),
            int(ys.min()),
            int(xs.max()),
            int(ys.max()),
        )
    else:
        target_bbox = (w // 6, h // 6, (5 * w) // 6, (5 * h) // 6)

    side_bgr = _rasterize_3d_view_onto_bg(
        verts, faces, v_normals, v_colors_rgb,
        yaw_deg=-90.0, pitch_deg=4.0, bg_bgr=studio_bg, target_bbox=target_bbox, is_top_view=False,
    )
    top_bgr = _rasterize_3d_view_onto_bg(
        verts, faces, v_normals, v_colors_rgb,
        yaw_deg=0.0, pitch_deg=90.0, bg_bgr=floor_bg, target_bbox=target_bbox, is_top_view=True,
    )
    back_bgr = _rasterize_3d_view_onto_bg(
        verts, faces, v_normals, v_colors_rgb,
        yaw_deg=180.0, pitch_deg=4.0, bg_bgr=studio_bg, target_bbox=target_bbox, is_top_view=False,
    )

    sheet_bgr = _render_quad_sheet(
        (
            ("FRONT VIEW (0 deg)", front_bgr),
            ("SIDE VIEW (90 deg)", side_bgr),
            ("TOP VIEW (OVERHEAD)", top_bgr),
            ("BACK VIEW (180 deg)", back_bgr),
        )
    )

    side_name = f"{prefix}_side.png"
    top_name = f"{prefix}_top.png"
    back_name = f"{prefix}_back.png"
    sheet_name = f"{prefix}_multiview.png"

    cv2.imwrite(str(output_dir / side_name), side_bgr)
    cv2.imwrite(str(output_dir / top_name), top_bgr)
    cv2.imwrite(str(output_dir / back_name), back_bgr)
    cv2.imwrite(str(output_dir / sheet_name), sheet_bgr)

    resolved_front_url = front_url or f"/outputs/{prefix}.png"
    side_url = f"/outputs/{side_name}"
    top_url = f"/outputs/{top_name}"
    back_url = f"/outputs/{back_name}"
    sheet_url = f"/outputs/{sheet_name}"

    return {
        "front": resolved_front_url,
        "side": side_url,
        "top": top_url,
        "back": back_url,
        "sheet": sheet_url,
        "views": [
            {"id": "front", "label": "Front View", "angle": "0° Front", "image_url": resolved_front_url},
            {"id": "side", "label": "Side View", "angle": "90° Side", "image_url": side_url},
            {"id": "top", "label": "Top View", "angle": "90° Top", "image_url": top_url},
            {"id": "back", "label": "Back View", "angle": "180° Back", "image_url": back_url},
        ],
    }



def _render_quad_sheet(
    views: Tuple[Tuple[str, np.ndarray], ...],
    tile_size: int = 512,
) -> np.ndarray:
    """Arrange Front, Side, Top, and Back views into a crisp 1024x1024 2x2 sheet."""
    tiles: List[np.ndarray] = []
    for label, img in views:
        tile = cv2.resize(img, (tile_size, tile_size), interpolation=cv2.INTER_AREA) if img.shape[:2] != (tile_size, tile_size) else img.copy()
        cv2.rectangle(tile, (0, 0), (tile_size - 1, tile_size - 1), (226, 218, 203), 2)
        badge_w = min(tile_size - 24, 18 + len(label) * 9)
        cv2.rectangle(tile, (12, 12), (12 + badge_w, 40), (26, 26, 30), -1)
        cv2.putText(tile, label, (20, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)

    top_row = np.hstack([tiles[0], tiles[1]])
    bot_row = np.hstack([tiles[2], tiles[3]])
    return np.vstack([top_row, bot_row])


def generate_multi_views(
    front_bgr: np.ndarray,
    prefix: str,
    category: str,
    output_dir: Path,
    front_url: Optional[str] = None,
    mask_gray: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """
    Generate consistent Side, Top, Back views and 2x2 Multi-View Sheet from
    a single generated Front View photoreal image. Automatically uses the
    reconstructed 3D mesh whenever available on disk for `prefix`.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    if mask_gray is None:
        m = re.match(r"^render_(furn_[a-zA-Z0-9]+)_\d+$", prefix)
        gen_id = m.group(1) if m else (prefix if prefix.startswith("spec_") else None)
        if gen_id:
            obj_candidates = [
                output_dir / "models3d" / gen_id / "obj" / "model.obj",
                output_dir.parent / "outputs" / "models3d" / gen_id / "obj" / "model.obj",
            ]
            for obj_cand in obj_candidates:
                if obj_cand.exists():
                    try:
                        import trimesh

                        loaded = trimesh.load(str(obj_cand), process=False)
                        if hasattr(loaded, "vertices") and len(loaded.vertices) > 100:
                            return render_multiviews_from_3d_mesh(
                                mesh=loaded,
                                front_bgr=front_bgr,
                                prefix=prefix,
                                output_dir=output_dir,
                                front_url=front_url,
                            )
                    except Exception as exc:
                        logger.debug("3D mesh multi-view render fallback for %s: %s", prefix, exc)

    edge_hint = _find_associated_edge_map(prefix, output_dir, front_bgr.shape[:2]) if mask_gray is None else None
    initial_bg = _reconstruct_studio_bg(front_bgr)
    alpha = _segment_front_image(front_bgr, initial_bg, mask_gray=mask_gray, edge_hint=edge_hint)
    studio_bg = _reconstruct_studio_bg(front_bgr, fg_hint=alpha)
    floor_bg = _reconstruct_floor_bg(front_bgr, studio_bg)
    struct = _analyze_structure(alpha, category=category)

    side_bgr = _render_side_view(front_bgr, alpha, studio_bg, struct, category=category)
    top_bgr = _render_top_view(front_bgr, alpha, floor_bg, struct, category=category)
    back_bgr = _render_back_view(front_bgr, alpha, studio_bg, struct, category=category)

    sheet_bgr = _render_quad_sheet(
        (
            ("FRONT VIEW (0 deg)", front_bgr),
            ("SIDE VIEW (90 deg)", side_bgr),
            ("TOP VIEW (OVERHEAD)", top_bgr),
            ("BACK VIEW (180 deg)", back_bgr),
        )
    )

    side_name = f"{prefix}_side.png"
    top_name = f"{prefix}_top.png"
    back_name = f"{prefix}_back.png"
    sheet_name = f"{prefix}_multiview.png"

    cv2.imwrite(str(output_dir / side_name), side_bgr)
    cv2.imwrite(str(output_dir / top_name), top_bgr)
    cv2.imwrite(str(output_dir / back_name), back_bgr)
    cv2.imwrite(str(output_dir / sheet_name), sheet_bgr)

    resolved_front_url = front_url or f"/outputs/{prefix}.png"
    side_url = f"/outputs/{side_name}"
    top_url = f"/outputs/{top_name}"
    back_url = f"/outputs/{back_name}"
    sheet_url = f"/outputs/{sheet_name}"

    return {
        "front": resolved_front_url,
        "side": side_url,
        "top": top_url,
        "back": back_url,
        "sheet": sheet_url,
        "views": [
            {"id": "front", "label": "Front View", "angle": "0° Front", "image_url": resolved_front_url},
            {"id": "side", "label": "Side View", "angle": "90° Side", "image_url": side_url},
            {"id": "top", "label": "Top View", "angle": "90° Top", "image_url": top_url},
            {"id": "back", "label": "Back View", "angle": "180° Back", "image_url": back_url},
        ],
    }
