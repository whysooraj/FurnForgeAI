"""
FurnForge AI - Image-to-3D Reconstruction Engine.

Model priority chain:
  1. Primary (Priority 1): stabilityai/TripoSR (supports CUDA GPU and CPU)
  2. Fallback (Priority 2): tencent/Hunyuan3D-2mini (requires CUDA GPU + hy3dgen)

Design guarantees:
- Accepts ONLY the final photorealistic 2D render produced by FurnForge AI.
- Rejects sketches, ControlNet/OpenCV edge maps, and unverified image paths.
- Never generates procedural/random placeholder meshes or fake 3D views.
"""
from __future__ import annotations

import gc
import importlib.util
import json
import logging
import platform
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import cv2
import numpy as np
from PIL import Image

from app.config import (
    HUNYUAN3D_ENABLE_TEXTURE,
    HUNYUAN3D_MIN_VRAM_GB,
    HUNYUAN3D_MODEL,
    HUNYUAN3D_OCTREE_RES,
    HUNYUAN3D_STEPS,
    HUNYUAN3D_SUBFOLDER,
    MODEL_3D_DIR,
    OUTPUT_DIR,
    TRIPOSR_BAKE_TEXTURE,
    TRIPOSR_CHUNK_SIZE,
    TRIPOSR_FOREGROUND_RATIO,
    TRIPOSR_MC_RESOLUTION,
    TRIPOSR_MODEL,
    TRIPOSR_TEXTURE_RESOLUTION,
)
from app.pipeline.multiview_renderer import (
    _find_associated_edge_map,
    _reconstruct_studio_bg,
    _segment_front_image,
    _trim_floor_reflection_tags,
    generate_multi_views,
    render_multiviews_from_3d_mesh,
)

logger = logging.getLogger("FurnForgeAI.Mesh3D")

ProgressCallback = Callable[[int, int, str], None]


class PhotorealInputError(ValueError):
    """Raised when the requested 3D input is not a valid generated photoreal render."""


class Mesh3DIncompatibleError(RuntimeError):
    """Raised when neither Priority 1 (TripoSR) nor Priority 2 (Hunyuan3D-2mini) can run."""


class Mesh3DGenerationError(RuntimeError):
    """Raised when 3D reconstruction or mesh export fails."""


def check_3d_capabilities() -> Dict[str, Any]:
    """
    Inspect hardware & library support for Priority 1 (TripoSR) and
    Priority 2 Fallback (tencent/Hunyuan3D-2mini).
    """
    os_name = platform.system()
    torch_version = None
    cuda_available = False
    cuda_version = None
    gpu_name = None
    vram_gb = 0.0

    try:
        import torch

        torch_version = torch.__version__
        cuda_available = bool(torch.cuda.is_available())
        cuda_version = getattr(torch.version, "cuda", None)
        if cuda_available:
            props = torch.cuda.get_device_properties(0)
            gpu_name = props.name
            vram_gb = round(props.total_memory / (1024 ** 3), 2)
    except ImportError as exc:
        return {
            "ready": False,
            "os": os_name,
            "torch_version": None,
            "cuda_available": False,
            "device": "cpu",
            "gpu_name": None,
            "vram_gb": 0.0,
            "primary": {
                "name": "TripoSR",
                "model_id": TRIPOSR_MODEL,
                "available": False,
                "blocking_reasons": [f"PyTorch is not installed: {exc}"],
            },
            "fallback": {
                "name": "Hunyuan3D-2mini",
                "model_id": HUNYUAN3D_MODEL,
                "available": False,
                "blocking_reasons": [f"PyTorch is not installed: {exc}"],
            },
            "blocking_reasons": [f"PyTorch is not installed: {exc}"],
        }

    # Check Priority 1: TripoSR (supports CUDA GPU and CPU)
    triposr_missing = [
        pkg for pkg in ("einops", "omegaconf", "trimesh", "rembg")
        if importlib.util.find_spec(pkg) is None
    ]
    has_torchmcubes = importlib.util.find_spec("torchmcubes") is not None
    has_skimage = importlib.util.find_spec("skimage") is not None
    if not has_torchmcubes and not has_skimage:
        triposr_missing.append("torchmcubes or scikit-image")

    has_uv_bake = (
        importlib.util.find_spec("xatlas") is not None
        and importlib.util.find_spec("moderngl") is not None
    )
    triposr_reasons: List[str] = []
    if triposr_missing:
        triposr_reasons.append(
            "Missing TripoSR Python packages: " + ", ".join(triposr_missing)
        )
    triposr_available = len(triposr_reasons) == 0

    # Check Priority 2 Fallback: tencent/Hunyuan3D-2mini (requires CUDA GPU + hy3dgen)
    hy3d_installed = importlib.util.find_spec("hy3dgen") is not None
    hunyuan_reasons: List[str] = []
    if not cuda_available:
        hunyuan_reasons.append(
            f"{HUNYUAN3D_MODEL} requires an NVIDIA CUDA GPU (detected CPU-only PyTorch {torch_version})."
        )
    elif vram_gb < HUNYUAN3D_MIN_VRAM_GB:
        hunyuan_reasons.append(
            f"{HUNYUAN3D_MODEL} requires >= {HUNYUAN3D_MIN_VRAM_GB:.0f} GB VRAM (detected {vram_gb} GB on {gpu_name})."
        )
    if not hy3d_installed:
        hunyuan_reasons.append(
            "Package 'hy3dgen' is not installed (install from https://github.com/Tencent-Hunyuan/Hunyuan3D-2)."
        )
    hunyuan_available = len(hunyuan_reasons) == 0

    blocking_reasons = []
    if not triposr_available and not hunyuan_available:
        blocking_reasons = triposr_reasons + hunyuan_reasons

    return {
        "ready": triposr_available or hunyuan_available,
        "os": os_name,
        "torch_version": torch_version,
        "cuda_available": cuda_available,
        "cuda_version": cuda_version,
        "device": "cuda" if cuda_available else "cpu",
        "gpu_name": gpu_name,
        "vram_gb": vram_gb,
        "priority_order": ["triposr", "hunyuan3d"],
        "primary": {
            "key": "triposr",
            "name": "TripoSR",
            "model_id": TRIPOSR_MODEL,
            "model_url": f"https://huggingface.co/{TRIPOSR_MODEL}",
            "available": triposr_available,
            "device": "cuda" if cuda_available else "cpu",
            "marching_cubes_backend": "torchmcubes" if has_torchmcubes else "scikit-image",
            "uv_texture_baking": has_uv_bake,
            "blocking_reasons": triposr_reasons,
        },
        "fallback": {
            "key": "hunyuan3d",
            "name": "Hunyuan3D-2mini",
            "model_id": HUNYUAN3D_MODEL,
            "model_url": f"https://huggingface.co/{HUNYUAN3D_MODEL}",
            "available": hunyuan_available,
            "device": "cuda" if cuda_available else "unavailable",
            "min_vram_gb": HUNYUAN3D_MIN_VRAM_GB,
            "blocking_reasons": hunyuan_reasons,
        },
        "blocking_reasons": blocking_reasons,
    }


def resolve_photoreal_render_path(
    generation_record: Dict[str, Any],
    requested_image_url: Optional[str] = None,
    variation_index: Optional[int] = 0,
) -> tuple[Path, str]:
    """
    Resolve and strictly validate the generated 2D photorealistic image on disk.

    Rejects sketches, ControlNet/OpenCV edge maps, and any path outside OUTPUT_DIR.
    Accepts both relative paths (/outputs/...) and full public URLs (https://.../outputs/...).
    """
    def _clean_path(u: Optional[str]) -> Optional[str]:
        if not u or not isinstance(u, str):
            return None
        cleaned = u.split("?", 1)[0].strip()
        if "://" in cleaned:
            from urllib.parse import urlparse
            cleaned = urlparse(cleaned).path
        return cleaned

    candidate_url = requested_image_url
    if not candidate_url:
        variations = generation_record.get("variations") or []
        if variation_index is not None and 0 <= variation_index < len(variations):
            candidate_url = variations[variation_index].get("image_url")
        candidate_url = candidate_url or generation_record.get("result_image_url")

    if not candidate_url:
        raise PhotorealInputError("Generation record does not contain a photoreal render URL.")

    normalized = _clean_path(candidate_url)
    forbidden_urls = {
        _clean_path(generation_record.get("original_image_url")),
        _clean_path(generation_record.get("preprocessed_edge_url")),
    }

    if not normalized or normalized in forbidden_urls or "/sample_sketches/" in normalized or "/uploads/" in normalized:
        raise PhotorealInputError(
            "3D reconstruction requires the final generated photorealistic render, not a sketch or ControlNet edge map."
        )

    filename = Path(normalized).name
    if filename.startswith("edge_") or filename.startswith("mask_") or filename.startswith("upload_"):
        raise PhotorealInputError(
            f"Refusing non-photoreal input '{filename}'. Only generated photorealistic furniture renders are allowed."
        )

    allowed_urls = {_clean_path(generation_record.get("result_image_url"))}
    top_mv = generation_record.get("multi_views")
    if isinstance(top_mv, dict):
        for k in ("front", "side", "top", "back"):
            if top_mv.get(k):
                allowed_urls.add(_clean_path(top_mv[k]))
    for var in generation_record.get("variations") or []:
        if var.get("image_url"):
            allowed_urls.add(_clean_path(var["image_url"]))
        var_mv = var.get("multi_views")
        if isinstance(var_mv, dict):
            for k in ("front", "side", "top", "back"):
                if var_mv.get(k):
                    allowed_urls.add(_clean_path(var_mv[k]))

    if normalized not in allowed_urls or not normalized.startswith("/outputs/"):
        raise PhotorealInputError(
            f"Image URL '{normalized}' does not match a verified photoreal render of generation '{generation_record.get('id')}'."
        )

    output_root = OUTPUT_DIR.resolve()
    image_path = (output_root / filename).resolve()
    if image_path.parent != output_root or not image_path.exists():
        raise PhotorealInputError(f"Generated photoreal image file not found on disk: {normalized}")

    try:
        with Image.open(image_path) as img:
            img.verify()
    except Exception as exc:
        raise PhotorealInputError(f"Photoreal image '{filename}' is unreadable or corrupted: {exc}") from exc

    return image_path, normalized


def _extract_mesh_stats(scene_or_mesh: Any, has_uv: bool, pbr_materials: bool) -> Dict[str, Any]:
    import trimesh

    if isinstance(scene_or_mesh, trimesh.Scene):
        geometries = list(scene_or_mesh.geometry.values())
        vertices = sum(len(g.vertices) for g in geometries if hasattr(g, "vertices"))
        faces = sum(len(g.faces) for g in geometries if hasattr(g, "faces"))
        bounds = scene_or_mesh.bounds.tolist() if scene_or_mesh.bounds is not None else None
    else:
        vertices = int(len(getattr(scene_or_mesh, "vertices", [])))
        faces = int(len(getattr(scene_or_mesh, "faces", [])))
        bounds_arr = getattr(scene_or_mesh, "bounds", None)
        bounds = bounds_arr.tolist() if bounds_arr is not None else None

    return {
        "vertex_count": int(vertices),
        "face_count": int(faces),
        "uv_mapped": bool(has_uv),
        "pbr_materials": bool(pbr_materials),
        "bounding_box": bounds,
    }


def _package_sidecars_if_needed(target_dir: Path, primary_file: Path, bundle_zip_path: Path) -> Path:
    files = [p for p in target_dir.iterdir() if p.is_file()]
    if len(files) <= 1:
        return primary_file
    with zipfile.ZipFile(bundle_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(files):
            zf.write(file_path, arcname=file_path.name)
    return bundle_zip_path


def _srgb_to_linear_rgba(rgba_float: np.ndarray) -> np.ndarray:
    """Convert [0..1] sRGB RGBA vertex colors to tone-balanced RGBA uint8 for Three.js PBR viewing."""
    rgb = np.clip(rgba_float[:, :3], 0.0, 1.0)
    # Gentle gamma (1.30) keeps midtones and dark materials vibrant under Three.js ACES studio lighting
    balanced = np.clip(rgb ** 1.30, 0.0, 1.0)
    out = np.ones((len(rgb), 4), dtype=np.uint8) * 255
    out[:, :3] = np.clip(np.round(balanced * 255.0), 0, 255).astype(np.uint8)
    if rgba_float.shape[1] == 4:
        out[:, 3] = np.clip(np.round(rgba_float[:, 3] * 255.0), 0, 255).astype(np.uint8)
    return out


def _export_trimesh_formats(
    mesh: Any,
    generation_id: str,
    srgb_vertex_colors: Optional[np.ndarray] = None,
) -> List[str]:
    """Export a smooth trimesh Mesh/Scene to real GLB, GLTF, and OBJ files."""
    import trimesh

    asset_dir = MODEL_3D_DIR / generation_id
    gltf_dir = asset_dir / "gltf"
    obj_dir = asset_dir / "obj"
    for folder in (asset_dir, gltf_dir, obj_dir):
        folder.mkdir(parents=True, exist_ok=True)

    for old_zip in (asset_dir / "model-gltf.zip", asset_dir / "model-obj.zip"):
        old_zip.unlink(missing_ok=True)

    # Ensure vertex normals exist so Three.js & glTF viewers use smooth shading
    _ = mesh.vertex_normals

    glb_path = asset_dir / "model.glb"
    try:
        glb_path.write_bytes(trimesh.exchange.gltf.export_glb(mesh, include_normals=True))
    except TypeError:
        mesh.export(str(glb_path))

    supported = ["glb"]
    try:
        gltf_files = trimesh.exchange.gltf.export_gltf(mesh, include_normals=True)
        for name, data in gltf_files.items():
            out_name = "model.gltf" if name.endswith(".gltf") else name
            content = data.encode("utf-8") if isinstance(data, str) else data
            if out_name == "model.gltf" and isinstance(content, bytes):
                # Fix internal buffer URI if renamed
                (gltf_dir / out_name).write_bytes(content)
            else:
                (gltf_dir / name).write_bytes(content)
        _package_sidecars_if_needed(gltf_dir, gltf_dir / "model.gltf", asset_dir / "model-gltf.zip")
        supported.append("gltf")
    except Exception as exc:
        logger.warning("GLTF export skipped for %s: %s", generation_id, exc)

    try:
        obj_mesh = mesh
        if srgb_vertex_colors is not None:
            obj_mesh = mesh.copy()
            obj_mesh.visual = trimesh.visual.ColorVisuals(mesh=obj_mesh, vertex_colors=srgb_vertex_colors)
        obj_path = obj_dir / "model.obj"
        obj_mesh.export(str(obj_path), include_normals=True)
        _package_sidecars_if_needed(obj_dir, obj_path, asset_dir / "model-obj.zip")
        supported.append("obj")
    except Exception as exc:
        logger.warning("OBJ export skipped for %s: %s", generation_id, exc)

    return supported


def _clean_furniture_foreground(pil_rgb: Image.Image, rembg_session: Any) -> Image.Image:
    """
    Remove studio backdrop cleanly, pruning any border-connected wall vignette or
    drop shadow that u2net occasionally merges with rectangular furniture (e.g. cabinets).
    """
    from app.pipeline.tsr.utils import remove_background

    rgba = np.array(remove_background(pil_rgb, rembg_session))
    alpha = rgba[:, :, 3]
    bgr = cv2.cvtColor(np.array(pil_rgb), cv2.COLOR_RGB2BGR)
    h, w = alpha.shape

    touches_border = (
        np.mean(alpha[:8, :] > 20) > 0.03
        or np.mean(alpha[-8:, :] > 20) > 0.03
        or np.mean(alpha[:, :8] > 20) > 0.03
        or np.mean(alpha[:, -8:] > 20) > 0.03
    )
    if not touches_border:
        alpha = _trim_floor_reflection_tags(bgr, alpha)
        rgba[:, :, 3] = cv2.GaussianBlur(alpha, (3, 3), 0)
        return Image.fromarray(rgba)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    gx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)

    barrier = cv2.dilate((grad > 28.0).astype(np.uint8), np.ones((3, 3), np.uint8))
    passable = (barrier == 0).astype(np.uint8)
    _num_cc, labels = cv2.connectedComponents(passable, connectivity=4)

    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[:4, :] = True
    border_mask[-4:, :] = True
    border_mask[:, :4] = True
    border_mask[:, -4:] = True
    border_labels = set(np.unique(labels[border_mask])) - {0}
    border_wall = np.isin(labels, list(border_labels))

    gc_mask = np.full((h, w), cv2.GC_PR_BGD, dtype=np.uint8)
    gc_mask[alpha >= 160] = cv2.GC_PR_FGD
    core_fg = (
        cv2.erode(((alpha >= 230) & (~border_wall)).astype(np.uint8), np.ones((11, 11), np.uint8))
        > 0
    )
    gc_mask[core_fg] = cv2.GC_FGD
    gc_mask[(alpha < 20) | border_wall] = cv2.GC_BGD

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, gc_mask, None, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_MASK)
        refined = np.where(
            (gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0
        ).astype(np.uint8)
    except Exception:
        refined = np.where((alpha > 127) & (~border_wall), 255, 0).astype(np.uint8)

    n_fg, fg_labels, stats, _ = cv2.connectedComponentsWithStats(refined)
    if n_fg > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        max_area = areas.max()
        keep = np.zeros_like(refined)
        for idx, area in enumerate(areas, start=1):
            if area >= max_area * 0.15:
                keep[fg_labels == idx] = 255
        refined = keep

    alpha = np.where(refined > 0, np.maximum(alpha, 235), 0).astype(np.uint8)
    alpha = _trim_floor_reflection_tags(bgr, alpha)
    rgba[:, :, 3] = cv2.GaussianBlur(alpha, (3, 3), 0)
    return Image.fromarray(rgba)


def _auto_level_and_orient_mesh(
    raw_mesh: Any,
    front_bbox: Optional[tuple[int, int, int, int]] = None,
    already_threejs_oriented: bool = False,
) -> Any:
    """
    Produce an ultra-smooth, floor-leveled, canonically oriented 3D furniture mesh:
      1. Prune tiny disconnected marching-cubes floating islands (< 3% of main body).
      2. Apply 14 iterations of volume-preserving Taubin smoothing.
      3. Transform to Three.js studio coordinates (+Z Front, -Z Back, +X Right, +Y Up).
      4. Align horizontal yaw via 2D PCA on middle-height (X, Z) vertices.
      5. Level floor pitch (X-axis tilt) and roll (Z-axis tilt) so all legs/bases sit flat on Y=0.
      6. Gently calibrate horizontal width/height ratio without clamping to 2D polygons.
    """
    import trimesh

    mesh = raw_mesh.copy()

    # 1. Prune tiny floating islands if present while preserving vertex order when single component
    try:
        parts = mesh.split(only_watertight=False)
        if len(parts) > 1:
            max_v = max(len(p.vertices) for p in parts)
            kept = [p for p in parts if len(p.vertices) >= max(40, int(0.03 * max_v))]
            if kept and len(kept) < len(parts):
                mesh = trimesh.util.concatenate(kept)
    except Exception:
        pass

    # 2. High-iteration volume-preserving Taubin smoothing for smooth 3D surfaces
    try:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.50, nu=-0.53, iterations=14)
        mesh.fix_normals()
    except Exception:
        pass

    # 3. Canonical Three.js studio space (+Z Front, -Z Back, +X Right, +Y Up)
    if not already_threejs_oriented:
        mesh = _orient_to_threejs_studio(mesh)

    v = np.asarray(mesh.vertices, dtype=np.float64).copy()
    if len(v) < 20:
        return mesh

    vmin = v.min(axis=0)
    vmax = v.max(axis=0)
    v[:, 0] -= 0.5 * (vmin[0] + vmax[0])
    v[:, 2] -= 0.5 * (vmin[2] + vmax[2])
    v[:, 1] -= vmin[1]
    sy = max(float(vmax[1] - vmin[1]), 1e-4)

    # 4. Horizontal Yaw alignment via 2D PCA on mid-height [25%..85%] (X, Z) slice
    mid_mask = (v[:, 1] >= 0.25 * sy) & (v[:, 1] <= 0.85 * sy)
    xz = v[mid_mask][:, [0, 2]] if np.sum(mid_mask) > 50 else v[:, [0, 2]]
    cov = np.cov(xz.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    major = eigvecs[:, int(np.argmax(eigvals))]
    if major[0] < 0:
        major = -major
    yaw = float(np.arctan2(major[1], major[0]))
    if abs(yaw) > np.pi / 4.0:
        yaw = 0.0
    else:
        yaw = float(np.clip(yaw, -np.deg2rad(25.0), np.deg2rad(25.0)))

    cy, sy_rot = np.cos(-yaw), np.sin(-yaw)
    x_new = cy * v[:, 0] - sy_rot * v[:, 2]
    z_new = sy_rot * v[:, 0] + cy * v[:, 2]
    v[:, 0], v[:, 2] = x_new, z_new

    # 5. Automatic Floor-Plane Pitch Leveling (front vs back bottom 3rd percentile Y)
    vmin = v.min(axis=0)
    vmax = v.max(axis=0)
    v[:, 0] -= 0.5 * (vmin[0] + vmax[0])
    v[:, 2] -= 0.5 * (vmin[2] + vmax[2])
    v[:, 1] -= vmin[1]
    sz = max(float(vmax[2] - vmin[2]), 1e-4)
    sx = max(float(vmax[0] - vmin[0]), 1e-4)

    front_mask = v[:, 2] > 0.12 * sz
    back_mask = v[:, 2] < -0.12 * sz
    if np.sum(front_mask) > 30 and np.sum(back_mask) > 30:
        y_front_bot = float(np.percentile(v[front_mask, 1], 3))
        y_back_bot = float(np.percentile(v[back_mask, 1], 3))
        z_front_med = float(np.median(v[front_mask, 2]))
        z_back_med = float(np.median(v[back_mask, 2]))
        dz = max(abs(z_front_med - z_back_med), 0.25 * sz)
        pitch = float(np.clip(np.arctan2(y_front_bot - y_back_bot, dz), -np.deg2rad(18.0), np.deg2rad(18.0)))
        cp, sp = np.cos(pitch), np.sin(pitch)
        y_p = cp * v[:, 1] - sp * v[:, 2]
        z_p = sp * v[:, 1] + cp * v[:, 2]
        v[:, 1], v[:, 2] = y_p, z_p

    # Also level any slight left-right roll tilt
    left_mask = v[:, 0] < -0.15 * sx
    right_mask = v[:, 0] > 0.15 * sx
    if np.sum(left_mask) > 30 and np.sum(right_mask) > 30:
        y_left_bot = float(np.percentile(v[left_mask, 1], 3))
        y_right_bot = float(np.percentile(v[right_mask, 1], 3))
        dx = max(abs(float(np.median(v[right_mask, 0]) - np.median(v[left_mask, 0]))), 0.30 * sx)
        roll = float(np.clip(np.arctan2(y_right_bot - y_left_bot, dx), -np.deg2rad(8.0), np.deg2rad(8.0)))
        cr, sr = np.cos(-roll), np.sin(-roll)
        x_r = cr * v[:, 0] - sr * v[:, 1]
        y_r = sr * v[:, 0] + cr * v[:, 1]
        v[:, 0], v[:, 1] = x_r, y_r

    # 6. Gentle front width/height calibration preserving true 3D depth
    vmin = v.min(axis=0)
    vmax = v.max(axis=0)
    ext = np.maximum(vmax - vmin, 1e-4)
    v[:, 0] -= 0.5 * (vmin[0] + vmax[0])
    v[:, 2] -= 0.5 * (vmin[2] + vmax[2])
    v[:, 1] -= vmin[1]

    if front_bbox is not None:
        fx0, fy0, fx1, fy1 = front_bbox
        fw = max(1, fx1 - fx0 + 1)
        fh = max(1, fy1 - fy0 + 1)
        front_ratio = float(np.clip(fw / float(fh), 0.35, 2.8))
        cur_ratio = float(ext[0] / ext[1])
        blended_ratio = 0.60 * cur_ratio + 0.40 * front_ratio
        scale_x = float(np.clip((ext[1] * blended_ratio) / ext[0], 0.78, 1.32))
        v[:, 0] *= scale_x

    fmin = v.min(axis=0)
    fmax = v.max(axis=0)
    v[:, 0] -= 0.5 * (fmin[0] + fmax[0])
    v[:, 2] -= 0.5 * (fmin[2] + fmax[2])
    v[:, 1] -= fmin[1]

    mesh.vertices = v
    try:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.45, nu=-0.48, iterations=4)
        mesh.fix_normals()
    except Exception:
        pass

    final_v = np.asarray(mesh.vertices, dtype=np.float64).copy()
    if len(final_v) > 0:
        bmin = final_v.min(axis=0)
        bmax = final_v.max(axis=0)
        final_v[:, 0] -= 0.5 * (bmin[0] + bmax[0])
        final_v[:, 2] -= 0.5 * (bmin[2] + bmax[2])
        final_v[:, 1] -= bmin[1]
        mesh.vertices = final_v
    return mesh


def _smooth_vertex_colors_1ring(faces: np.ndarray, colors: np.ndarray, iterations: int = 3) -> np.ndarray:
    """Smooth per-vertex RGB colors across 1-ring triangle neighbors to eliminate voxel color noise."""
    n_verts = len(colors)
    if n_verts == 0 or len(faces) == 0:
        return colors
    out = colors.astype(np.float32).copy()
    f0, f1, f2 = faces[:, 0], faces[:, 1], faces[:, 2]
    deg = np.zeros((n_verts, 1), dtype=np.float32)
    np.add.at(deg[:, 0], f0, 2.0)
    np.add.at(deg[:, 0], f1, 2.0)
    np.add.at(deg[:, 0], f2, 2.0)
    deg = np.maximum(deg, 1.0)

    for _ in range(iterations):
        acc = np.zeros_like(out)
        np.add.at(acc, f0, out[f1] + out[f2])
        np.add.at(acc, f1, out[f0] + out[f2])
        np.add.at(acc, f2, out[f0] + out[f1])
        neighbor_avg = acc / deg
        out = 0.62 * out + 0.38 * neighbor_avg
    return np.clip(out, 0.0, 1.0)


def _bake_true_3d_vertex_colors(
    mesh: Any,
    base_rgb: Optional[np.ndarray],
    front_bgr: np.ndarray,
    fg_alpha: np.ndarray,
) -> np.ndarray:
    """
    Calibrate TripoSR's 360-degree 3D neural triplane colors to the exact foreground
    palette of the photoreal Front View (strictly masked by `fg_alpha` so zero background
    wall/floor colors ever bleed onto the 3D mesh) and anchor front-facing details.
    """
    verts = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.int32)
    normals = np.asarray(mesh.vertex_normals, dtype=np.float32)
    n_verts = len(verts)
    if n_verts == 0:
        return np.zeros((0, 3), dtype=np.float32)

    fg_clean_rgb = _dilate_foreground_rgb(front_bgr, fg_alpha)
    raw_rgb = cv2.cvtColor(front_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0

    # Extract true furniture foreground pixels (eroded by 3px so boundary halo is excluded)
    core_mask = cv2.erode((fg_alpha > 0.65).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    if np.sum(core_mask) < 50:
        core_mask = fg_alpha > 0.45

    ys, xs = np.where(fg_alpha > 0.40)
    h, w = fg_alpha.shape[:2]
    if ys.size >= 25:
        fx0, fy0, fx1, fy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    else:
        fx0, fy0, fx1, fy1 = w // 6, h // 6, (5 * w) // 6, (5 * h) // 6

    b_min = verts.min(axis=0)
    b_ext = np.maximum(verts.max(axis=0) - b_min, 1e-4)
    u_x = np.clip((verts[:, 0] - b_min[0]) / b_ext[0], 0.0, 1.0)
    u_y = np.clip((verts[:, 1] - b_min[1]) / b_ext[1], 0.0, 1.0)

    front_sample = _bilinear_sample_rgb(
        fg_clean_rgb,
        fx0 + u_x * (fx1 - fx0),
        fy0 + (1.0 - u_y) * (fy1 - fy0),
    )

    if base_rgb is not None and len(base_rgb) == n_verts:
        tri_rgb = np.clip(np.asarray(base_rgb, dtype=np.float32)[:, :3], 0.0, 1.0)
        tri_rgb = _smooth_vertex_colors_1ring(faces, tri_rgb, iterations=3)

        # Match global per-channel mean & contrast of tri_rgb to the Front View furniture foreground
        if np.sum(core_mask) >= 50:
            fg_pix = raw_rgb[core_mask]
            fg_mean = np.mean(fg_pix, axis=0, keepdims=True)
            fg_std = np.maximum(np.std(fg_pix, axis=0, keepdims=True), 0.04)
            tri_mean = np.mean(tri_rgb, axis=0, keepdims=True)
            tri_std = np.maximum(np.std(tri_rgb, axis=0, keepdims=True), 0.04)
            gain = np.clip(fg_std / tri_std, 0.78, 1.45)
            tri_cal = (tri_rgb - tri_mean) * gain + fg_mean
            # Gentle saturation boost so 3D surface colors match 2D render vibrancy
            lum = (0.299 * tri_cal[:, 0:1] + 0.587 * tri_cal[:, 1:2] + 0.114 * tri_cal[:, 2:3])
            tri_cal = np.clip(lum + (tri_cal - lum) * 1.12, 0.0, 1.0)
        else:
            tri_cal = tri_rgb

        # Anchor front-facing vertices (n_z > 0.25) smoothly to clean Front View foreground pixels
        n_len = np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-6)
        n_z = (normals / n_len)[:, 2]
        w_front = (np.clip((n_z - 0.22) / 0.78, 0.0, 1.0) ** 1.8)[:, None] * 0.58
        fused = (1.0 - w_front) * tri_cal + w_front * front_sample
        return _smooth_vertex_colors_1ring(faces, fused, iterations=2)

    return _smooth_vertex_colors_1ring(faces, front_sample, iterations=3)


def _dilate_foreground_rgb(bgr: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """
    Create a background-free [0..1] float32 RGB map by extending clean interior
    furniture pixels outward so studio walls/floors never bleed onto 3D edges.
    """
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    fg = (alpha > 0.40).astype(np.uint8)
    eroded = cv2.erode(fg, np.ones((3, 3), np.uint8))
    core = eroded if np.sum(eroded) >= 64 else fg
    if np.sum(core) < 8:
        return rgb
    _, labels = cv2.distanceTransformWithLabels(
        (1 - core).astype(np.uint8),
        cv2.DIST_L2,
        5,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    fg_coords = np.column_stack(np.where(core > 0))
    idx = np.clip(labels - 1, 0, len(fg_coords) - 1)
    nearest_yx = fg_coords[idx]
    return rgb[nearest_yx[:, 0], nearest_yx[:, 1]]


def _analyze_view_silhouette(bgr: np.ndarray, view_id: str) -> Dict[str, Any]:
    """Segment one orthogonal view (front/side/top/back) and extract bbox, spans, and clean RGB."""
    h, w = bgr.shape[:2]
    bg = _reconstruct_studio_bg(bgr)
    alpha = _segment_front_image(bgr, bg)
    fg = alpha > 0.35
    ys, xs = np.where(fg)
    if ys.size < 25:
        x0, x1, y0, y1 = w // 6, (5 * w) // 6, h // 6, (5 * h) // 6
    else:
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())

    bw = max(1, x1 - x0 + 1)
    bh = max(1, y1 - y0 + 1)

    # Row-wise normalized horizontal span [0..1] indexed by height fraction u_y (0=bottom, 1=top)
    n_bins = 64
    span_min = np.zeros(n_bins, dtype=np.float32)
    span_max = np.ones(n_bins, dtype=np.float32)
    for b in range(n_bins):
        u_y = b / max(1, n_bins - 1)
        row_y = int(np.clip(round(y1 - u_y * (y1 - y0)), 0, h - 1))
        row_cols = np.where(fg[row_y])[0]
        if row_cols.size >= 2:
            span_min[b] = np.clip((row_cols.min() - x0) / bw, 0.0, 1.0)
            span_max[b] = np.clip((row_cols.max() - x0) / bw, 0.0, 1.0)
        elif b > 0:
            span_min[b] = span_min[b - 1]
            span_max[b] = span_max[b - 1]

    rgb_clean = _dilate_foreground_rgb(bgr, alpha)
    return {
        "view_id": view_id,
        "h": h,
        "w": w,
        "bbox": (x0, y0, x1, y1),
        "bw": bw,
        "bh": bh,
        "span_min": span_min,
        "span_max": span_max,
        "rgb": rgb_clean,
    }


def _resolve_front_source_path(image_path: Path) -> Path:
    """Resolve the canonical Front View image even if triggered from a side/top/back view URL."""
    stem = image_path.stem
    for suffix in ("_side", "_top", "_back", "_multiview"):
        if stem.endswith(suffix):
            base_candidate = image_path.with_name(f"{stem[:-len(suffix)]}{image_path.suffix}")
            if base_candidate.exists():
                return base_candidate
    return image_path


def _prepare_multiview_info_for_3d(
    image_path: Path,
    category: str = "Chair",
    multi_views: Optional[Dict[str, Any]] = None,
) -> tuple[Path, Dict[str, Any]]:
    """
    Ensure consistent Front, Side, Top, and Back view images exist on disk and
    analyze all 4 orthogonal views for multi-view 3D geometry & texture fusion.
    """
    front_path = _resolve_front_source_path(image_path)
    front_bgr = cv2.imread(str(front_path))
    if front_bgr is None:
        raise PhotorealInputError(f"Unreadable photoreal source image: {front_path.name}")

    prefix = front_path.stem
    view_paths: Dict[str, Path] = {"front": front_path}
    mv_dict: Optional[Dict[str, Any]] = dict(multi_views) if isinstance(multi_views, dict) else None

    if mv_dict:
        for k in ("side", "top", "back"):
            raw_u = mv_dict.get(k)
            if isinstance(raw_u, str) and raw_u:
                fname = Path(raw_u.split("?", 1)[0]).name
                cand = front_path.parent / fname
                if not cand.exists():
                    cand = OUTPUT_DIR / fname
                if cand.exists():
                    view_paths[k] = cand

    if not all(k in view_paths for k in ("side", "top", "back")):
        # Check default naming convention next to front_path first
        out_dir = front_path.parent
        all_present = True
        for k in ("side", "top", "back"):
            cand = out_dir / f"{prefix}_{k}.png"
            if cand.exists():
                view_paths[k] = cand
            else:
                all_present = False
        if not all_present:
            mv_dict = generate_multi_views(
                front_bgr=front_bgr,
                prefix=prefix,
                category=category,
                output_dir=out_dir,
                front_url=f"/outputs/{front_path.name}",
            )
            for k in ("side", "top", "back"):
                view_paths[k] = out_dir / Path(mv_dict[k]).name

    if mv_dict is None:
        mv_dict = {
            "front": f"/outputs/{front_path.name}",
            "side": f"/outputs/{view_paths['side'].name}",
            "top": f"/outputs/{view_paths['top'].name}",
            "back": f"/outputs/{view_paths['back'].name}",
            "sheet": f"/outputs/{prefix}_multiview.png",
            "views": [
                {"id": "front", "label": "Front View", "angle": "0° Front", "image_url": f"/outputs/{front_path.name}"},
                {"id": "side", "label": "Side View", "angle": "90° Side", "image_url": f"/outputs/{view_paths['side'].name}"},
                {"id": "top", "label": "Top View", "angle": "90° Top", "image_url": f"/outputs/{view_paths['top'].name}"},
                {"id": "back", "label": "Back View", "angle": "180° Back", "image_url": f"/outputs/{view_paths['back'].name}"},
            ],
        }

    analyzed: Dict[str, Any] = {"front": _analyze_view_silhouette(front_bgr, "front")}
    for k in ("side", "top", "back"):
        bgr = cv2.imread(str(view_paths[k]))
        analyzed[k] = _analyze_view_silhouette(bgr if bgr is not None else front_bgr, k)

    return front_path, {"views": analyzed, "meta": mv_dict}


def _orient_to_threejs_studio(mesh: Any) -> Any:
    """
    Transform raw TripoSR coordinates to canonical Three.js space where:
      +Z = Front, -Z = Back, +X = Right Side, +Y = Up.
    """
    import trimesh
    from app.pipeline.tsr.utils import to_gradio_3d_orientation

    mesh = to_gradio_3d_orientation(mesh)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    return mesh


def _sculpt_mesh_to_multiview_hull(mesh: Any, views_info: Dict[str, Any]) -> Any:
    """
    Align mesh proportions with Front/Side/Top view aspect ratios and gently pull
    any out-of-silhouette vertices inward to honor the 4-view visual hull.
    """
    import trimesh

    views = views_info["views"]
    f_v = views["front"]
    s_v = views["side"]

    verts = np.asarray(mesh.vertices, dtype=np.float64).copy()
    if len(verts) == 0:
        return mesh

    vmin = verts.min(axis=0)
    vmax = verts.max(axis=0)
    extent = np.maximum(vmax - vmin, 1e-4)

    # Center X/Z around 0 and ground bottom at Y=0
    verts[:, 0] -= 0.5 * (vmin[0] + vmax[0])
    verts[:, 2] -= 0.5 * (vmin[2] + vmax[2])
    verts[:, 1] -= vmin[1]

    # Match 3D aspect ratios to Front (W/H) and Side (D/H) proportions
    target_h = float(extent[1])
    ratio_w = float(np.clip(f_v["bw"] / max(1, f_v["bh"]), 0.28, 3.2))
    ratio_d = float(np.clip(s_v["bw"] / max(1, s_v["bh"]), 0.25, 2.8))

    verts[:, 0] *= (target_h * ratio_w) / extent[0]
    verts[:, 2] *= (target_h * ratio_d) / extent[2]

    # Soft visual-hull envelope check along height u_y in [0..1]
    vmin2 = verts.min(axis=0)
    vmax2 = verts.max(axis=0)
    sx = max(vmax2[0] - vmin2[0], 1e-4)
    sy = max(vmax2[1] - vmin2[1], 1e-4)
    sz = max(vmax2[2] - vmin2[2], 1e-4)

    u_y = np.clip((verts[:, 1] - vmin2[1]) / sy, 0.0, 1.0)
    n_bins = len(f_v["span_min"])
    bin_idx = np.clip(np.round(u_y * (n_bins - 1)).astype(np.int32), 0, n_bins - 1)

    pad = 0.06
    fx_lo = vmin2[0] + np.maximum(0.0, f_v["span_min"][bin_idx] - pad) * sx
    fx_hi = vmin2[0] + np.minimum(1.0, f_v["span_max"][bin_idx] + pad) * sx
    sx_lo = vmin2[2] + np.maximum(0.0, s_v["span_min"][bin_idx] - pad) * sz
    sx_hi = vmin2[2] + np.minimum(1.0, s_v["span_max"][bin_idx] + pad) * sz

    # Pull out-of-envelope vertices gently toward the 4-view hull
    clamped_x = np.clip(verts[:, 0], fx_lo, fx_hi)
    clamped_z = np.clip(verts[:, 2], sx_lo, sx_hi)
    verts[:, 0] = 0.35 * verts[:, 0] + 0.65 * clamped_x
    verts[:, 2] = 0.35 * verts[:, 2] + 0.65 * clamped_z

    mesh.vertices = verts
    try:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.42, nu=-0.45, iterations=3)
        mesh.fix_normals()
    except Exception:
        pass

    final_verts = np.asarray(mesh.vertices, dtype=np.float64).copy()
    if len(final_verts) > 0:
        fmin = final_verts.min(axis=0)
        fmax = final_verts.max(axis=0)
        final_verts[:, 0] -= 0.5 * (fmin[0] + fmax[0])
        final_verts[:, 2] -= 0.5 * (fmin[2] + fmax[2])
        final_verts[:, 1] -= fmin[1]
        mesh.vertices = final_verts
    return mesh


def _bilinear_sample_rgb(rgb: np.ndarray, x_f: np.ndarray, y_f: np.ndarray) -> np.ndarray:
    """Vectorized bilinear interpolation of RGB image at floating pixel coordinates."""
    h, w = rgb.shape[:2]
    x = np.clip(x_f, 0.0, w - 1.0)
    y = np.clip(y_f, 0.0, h - 1.0)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    wx = (x - x0)[:, None]
    wy = (y - y0)[:, None]
    c00 = rgb[y0, x0]
    c10 = rgb[y0, x1]
    c01 = rgb[y1, x0]
    c11 = rgb[y1, x1]
    return (c00 * (1.0 - wx) * (1.0 - wy)
            + c10 * wx * (1.0 - wy)
            + c01 * (1.0 - wx) * wy
            + c11 * wx * wy)


def _project_multiview_colors(
    points: np.ndarray,
    normals: np.ndarray,
    bounds: np.ndarray,
    views_info: Dict[str, Any],
    base_rgb: Optional[np.ndarray] = None,
    blend: float = 0.82,
) -> np.ndarray:
    """
    Normal-weighted orthographic color projection across Front (+Z), Back (-Z),
    Side (+/-X), and Top (+Y) views to bake exact multi-view appearance onto the 3D mesh.
    """
    pts = np.asarray(points, dtype=np.float64)
    nrms = np.asarray(normals, dtype=np.float64)
    if len(pts) == 0:
        return np.zeros((0, 3), dtype=np.float32)

    b_min = np.asarray(bounds[0], dtype=np.float64)
    b_ext = np.maximum(np.asarray(bounds[1], dtype=np.float64) - b_min, 1e-4)

    u_x = np.clip((pts[:, 0] - b_min[0]) / b_ext[0], 0.0, 1.0).astype(np.float32)
    u_y = np.clip((pts[:, 1] - b_min[1]) / b_ext[1], 0.0, 1.0).astype(np.float32)
    u_z = np.clip((pts[:, 2] - b_min[2]) / b_ext[2], 0.0, 1.0).astype(np.float32)

    views = views_info["views"]
    samples: Dict[str, np.ndarray] = {}

    # Coordinate maps inside each view's foreground bounding box
    vf = views["front"]
    fx0, fy0, fx1, fy1 = vf["bbox"]
    samples["front"] = _bilinear_sample_rgb(
        vf["rgb"], fx0 + u_x * (fx1 - fx0), fy0 + (1.0 - u_y) * (fy1 - fy0)
    )

    vb = views["back"]
    bx0, by0, bx1, by1 = vb["bbox"]
    samples["back"] = _bilinear_sample_rgb(
        vb["rgb"], bx0 + (1.0 - u_x) * (bx1 - bx0), by0 + (1.0 - u_y) * (by1 - by0)
    )

    vs = views["side"]
    sx0, sy0, sx1, sy1 = vs["bbox"]
    samples["side"] = _bilinear_sample_rgb(
        vs["rgb"], sx0 + u_z * (sx1 - sx0), sy0 + (1.0 - u_y) * (sy1 - sy0)
    )

    vt = views["top"]
    tx0, ty0, tx1, ty1 = vt["bbox"]
    samples["top"] = _bilinear_sample_rgb(
        vt["rgb"], tx0 + u_x * (tx1 - tx0), ty0 + u_z * (ty1 - ty0)
    )

    # Normal directional weights (Three.js right-handed space: +Z Front, -Z Back, +/-X Side, +Y Top)
    n_len = np.maximum(np.linalg.norm(nrms, axis=1, keepdims=True), 1e-6)
    n_unit = nrms / n_len
    w_front = np.maximum(0.0, n_unit[:, 2]) ** 2.2
    w_back = np.maximum(0.0, -n_unit[:, 2]) ** 2.2
    w_side = np.abs(n_unit[:, 0]) ** 2.2
    w_top = np.maximum(0.0, n_unit[:, 1]) ** 2.2
    w_under = np.maximum(0.0, -n_unit[:, 1]) ** 2.2

    w_sum = (w_front + w_back + w_side + w_top + w_under + 1e-5)[:, None]
    projected = (
        w_front[:, None] * samples["front"]
        + w_back[:, None] * samples["back"]
        + w_side[:, None] * samples["side"]
        + (w_top + 0.35 * w_under)[:, None] * samples["top"]
        + (0.65 * w_under)[:, None] * samples["side"]
    ) / w_sum

    if base_rgb is not None and len(base_rgb) == len(projected):
        out = blend * projected + (1.0 - blend) * np.asarray(base_rgb, dtype=np.float32)[:, :3]
    else:
        out = projected
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def _remap_legacy_dinov2_state_dict(module: Any, state_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remap legacy transformers v4 DINOv2 / SingleImageEncoder attention & SwiGLU MLP keys
    (used in tencent/Hunyuan3D-2mini checkpoints) to transformers v5 key names.
    """
    try:
        expected = set(module.state_dict().keys())
    except Exception:
        return state_dict

    if not expected or all(k in expected for k in state_dict.keys()):
        return state_dict

    direct_map = (
        (".attention.attention.query.", ".attention.q_proj."),
        (".attention.attention.key.", ".attention.k_proj."),
        (".attention.attention.value.", ".attention.v_proj."),
        (".attention.output.dense.", ".attention.o_proj."),
        (".mlp.weights_out.", ".mlp.down_proj."),
    )

    for k in list(state_dict.keys()):
        if k in expected:
            continue
        if ".mlp.weights_in." in k:
            gate_k = k.replace(".mlp.weights_in.", ".mlp.gate_proj.")
            up_k = k.replace(".mlp.weights_in.", ".mlp.up_proj.")
            if gate_k in expected and up_k in expected:
                tensor = state_dict.pop(k)
                gate_t, up_t = tensor.chunk(2, dim=0)
                state_dict[gate_k] = gate_t.contiguous()
                state_dict[up_k] = up_t.contiguous()
                continue
        for old_sub, new_sub in direct_map:
            if old_sub in k:
                cand_k = k.replace(old_sub, new_sub)
                if cand_k in expected:
                    state_dict[cand_k] = state_dict.pop(k)
                    break
    return state_dict


def _install_dinov2_state_dict_compat_hook() -> None:
    """Install an idempotent load_state_dict wrapper on torch.nn.Module for transformers v5 compatibility."""
    import torch

    if getattr(torch.nn.Module, "_furnforge_dinov2_compat", False):
        return

    orig_load_state_dict = torch.nn.Module.load_state_dict

    def _compat_load_state_dict(self, state_dict, strict: bool = True, assign: bool = False):
        if isinstance(state_dict, dict):
            _remap_legacy_dinov2_state_dict(self, state_dict)
        try:
            return orig_load_state_dict(self, state_dict, strict=strict, assign=assign)
        except TypeError:
            return orig_load_state_dict(self, state_dict, strict=strict)

    torch.nn.Module.load_state_dict = _compat_load_state_dict  # type: ignore[method-assign]
    torch.nn.Module._furnforge_dinov2_compat = True  # type: ignore[attr-defined]


class Mesh3DEngine:
    """
    Manages Image-to-3D reconstruction with:
      Priority 1: stabilityai/TripoSR (CUDA GPU or CPU)
      Priority 2 (Fallback): tencent/Hunyuan3D-2mini (CUDA GPU)
    """

    def __init__(self) -> None:
        self._triposr = None
        self._rembg_session = None
        self._hy_shapegen = None
        self._hy_texgen = None
        self._hy_rembg = None
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()

    def _ensure_triposr(self, device: str, progress: Optional[ProgressCallback] = None):
        with self._load_lock:
            if self._triposr is not None:
                return self._triposr

            if progress:
                progress(12, 100, f"Loading {TRIPOSR_MODEL} (Priority 1) on {device.upper()}")

            import rembg
            from app.pipeline.tsr.system import TSR

            gc.collect()
            model = TSR.from_pretrained(
                TRIPOSR_MODEL,
                config_name="config.yaml",
                weight_name="model.ckpt",
            )
            chunk_size = min(TRIPOSR_CHUNK_SIZE, 4096) if device == "cpu" else TRIPOSR_CHUNK_SIZE
            model.renderer.set_chunk_size(chunk_size)
            model.to(device)
            self._triposr = model
            if self._rembg_session is None:
                self._rembg_session = rembg.new_session("u2net")
            return self._triposr

    def _run_triposr(
        self,
        image_path: Path,
        generation_id: str,
        source_image_url: str,
        mc_resolution: int,
        bake_texture: bool,
        progress: Optional[ProgressCallback] = None,
        category: str = "Chair",
        multi_views: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        import torch
        import trimesh
        from app.pipeline.tsr.utils import resize_foreground

        caps = check_3d_capabilities()
        if not caps["primary"]["available"]:
            raise Mesh3DIncompatibleError(" ".join(caps["primary"]["blocking_reasons"]))

        device = caps["primary"]["device"]
        effective_mc_res = min(int(mc_resolution), 160) if device == "cpu" else int(mc_resolution)
        t0 = time.time()
        if progress:
            progress(8, 100, f"Initializing {TRIPOSR_MODEL} ({device.upper()})")
        model = self._ensure_triposr(device, progress=progress)

        try:
            if progress:
                progress(20, 100, "Aligning Front, Side, Top & Back views for 3D fusion")
            front_path, views_info = _prepare_multiview_info_for_3d(
                image_path, category=category, multi_views=multi_views
            )

            if progress:
                progress(28, 100, "Isolating furniture subject from Front & Side references")
            front_bgr = cv2.imread(str(front_path))
            if front_bgr is None:
                raise PhotorealInputError(f"Unreadable photoreal source image: {front_path.name}")
            with Image.open(front_path) as src_img:
                fg_clean_pil = _clean_furniture_foreground(src_img.convert("RGB"), self._rembg_session)
                fg_clean_alpha = np.array(fg_clean_pil)[:, :, 3].astype(np.float32) / 255.0
                fg = resize_foreground(fg_clean_pil, TRIPOSR_FOREGROUND_RATIO)
                fg_arr = np.array(fg).astype(np.float32) / 255.0
                fg_rgb = fg_arr[:, :, :3] * fg_arr[:, :, 3:4] + (1.0 - fg_arr[:, :, 3:4]) * 0.5
                cond_image = Image.fromarray((fg_rgb * 255.0).astype(np.uint8))

            if progress:
                progress(44, 100, f"Inferring 3D triplane geometry with {TRIPOSR_MODEL} ({device.upper()})")
            with torch.inference_mode():
                scene_codes = model([cond_image], device=device)

            if progress:
                progress(65, 100, f"Extracting 3D mesh via marching cubes ({effective_mc_res}³ grid)")

            can_bake = bake_texture and TRIPOSR_BAKE_TEXTURE and caps["primary"]["uv_texture_baking"]
            meshes = model.extract_mesh(
                scene_codes,
                has_vertex_color=False,
                resolution=effective_mc_res,
            )
            raw_mesh = meshes[0]

            if progress:
                progress(75, 100, "Smoothing 3D surface topology & leveling floor alignment")
            # Query triplane neural colors before pruning/orientation (1:1 vertex indexing)
            with torch.inference_mode():
                verts_t = torch.from_numpy(
                    np.ascontiguousarray(raw_mesh.vertices, dtype=np.float32)
                ).to(device)
                triplane_rgb = (
                    model.renderer.query_triplane(model.decoder, verts_t, scene_codes[0])["color"]
                    .cpu()
                    .numpy()
                )
            # Attach raw vertex colors so any island pruning preserves 1:1 vertex-color correspondence
            raw_mesh.visual = trimesh.visual.ColorVisuals(
                mesh=raw_mesh,
                vertex_colors=np.clip(np.round(triplane_rgb * 255.0), 0, 255).astype(np.uint8),
            )

            ys_fg, xs_fg = np.where(fg_clean_alpha > 0.40)
            front_bbox = (
                (int(xs_fg.min()), int(ys_fg.min()), int(xs_fg.max()), int(ys_fg.max()))
                if ys_fg.size >= 25
                else views_info["views"]["front"]["bbox"]
            )
            mesh = _auto_level_and_orient_mesh(raw_mesh, front_bbox=front_bbox)
            kept_triplane_rgb = (
                np.asarray(mesh.visual.vertex_colors, dtype=np.float32)[:, :3] / 255.0
                if hasattr(mesh, "visual") and hasattr(mesh.visual, "vertex_colors") and len(mesh.visual.vertex_colors) == len(mesh.vertices)
                else triplane_rgb
            )

            if progress:
                progress(86, 100, "Calibrating 360-degree surface colors & rendering 3D multi-views")
            fused_rgb = _bake_true_3d_vertex_colors(
                mesh=mesh,
                base_rgb=kept_triplane_rgb,
                front_bgr=front_bgr,
                fg_alpha=fg_clean_alpha,
            )
            srgb_colors_uint8 = np.clip(np.round(fused_rgb * 255.0), 0, 255).astype(np.uint8)
            uv_mapped = False

            if can_bake:
                try:
                    from scipy.spatial import cKDTree
                    from app.pipeline.tsr.bake_texture import make_atlas, rasterize_position_atlas

                    texture_res = TRIPOSR_TEXTURE_RESOLUTION
                    pad_px = round(max(2, texture_res / 256))
                    atlas = make_atlas(mesh, texture_res, pad_px)
                    pos_tex = rasterize_position_atlas(
                        mesh,
                        atlas["vmapping"],
                        atlas["indices"],
                        atlas["uvs"],
                        texture_res,
                        pad_px,
                    )
                    flat_pos = pos_tex.reshape(-1, 4)
                    valid = flat_pos[:, 3] > 0.5
                    tex_rgba = np.zeros((len(flat_pos), 4), dtype=np.uint8)
                    if np.any(valid):
                        tree = cKDTree(mesh.vertices)
                        _, nn_idx = tree.query(flat_pos[valid, :3], k=1)
                        valid_normals = mesh.vertex_normals[nn_idx]
                        valid_rgb = _project_multiview_colors(
                            flat_pos[valid, :3],
                            valid_normals,
                            mesh.bounds,
                            views_info,
                            base_rgb=triplane_rgb[nn_idx],
                            blend=0.82,
                        )
                        tex_rgba[valid, :3] = np.clip(np.round(valid_rgb * 255.0), 0, 255).astype(np.uint8)
                        tex_rgba[valid, 3] = 255

                    tex_img = Image.fromarray(
                        tex_rgba.reshape(texture_res, texture_res, 4), mode="RGBA"
                    ).transpose(Image.FLIP_TOP_BOTTOM)
                    material = trimesh.visual.material.PBRMaterial(
                        baseColorTexture=tex_img,
                        metallicFactor=0.05,
                        roughnessFactor=0.72,
                    )
                    visual = trimesh.visual.TextureVisuals(uv=atlas["uvs"], material=material)
                    mesh = trimesh.Trimesh(
                        vertices=mesh.vertices[atlas["vmapping"]],
                        faces=mesh.faces if len(atlas["indices"]) == 0 else atlas["indices"],
                        vertex_normals=mesh.vertex_normals[atlas["vmapping"]],
                        visual=visual,
                        process=False,
                    )
                    uv_mapped = True
                except Exception as bake_exc:
                    logger.warning("UV atlas 4-view baking fell back to vertex colors: %s", bake_exc)
                    uv_mapped = False

            if not uv_mapped:
                linear_rgba = _srgb_to_linear_rgba(fused_rgb)
                mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=linear_rgba)
                _ = mesh.vertex_normals

            if progress:
                progress(94, 100, "Exporting real 3D mesh assets (GLB, GLTF, OBJ) & 3D multi-views")
            supported_formats = _export_trimesh_formats(
                mesh, generation_id, srgb_vertex_colors=srgb_colors_uint8
            )
            try:
                views_info["meta"] = render_multiviews_from_3d_mesh(
                    mesh=mesh,
                    front_bgr=front_bgr,
                    prefix=front_path.stem,
                    output_dir=front_path.parent,
                    front_url=f"/outputs/{front_path.name}",
                    srgb_colors=srgb_colors_uint8,
                )
            except Exception as mv_exc:
                logger.warning("3D mesh multi-view rendering skipped for %s: %s", generation_id, mv_exc)
            stats = _extract_mesh_stats(mesh, has_uv=uv_mapped, pbr_materials=uv_mapped)
            elapsed = round(time.time() - t0, 2)
        finally:
            if device == "cpu":
                self._triposr = None
                self._rembg_session = None
            gc.collect()

        return {
            "status": "ready",
            "engine_used": "TripoSR",
            "model_id": TRIPOSR_MODEL,
            "priority_tier": "primary",
            "device": device,
            "gpu_name": caps.get("gpu_name"),
            "vram_gb": caps.get("vram_gb"),
            "source_image_url": source_image_url,
            "glb_url": f"/outputs/models3d/{generation_id}/model.glb",
            "gltf_url": f"/api/3d/download/{generation_id}/gltf" if "gltf" in supported_formats else None,
            "obj_url": f"/api/3d/download/{generation_id}/obj" if "obj" in supported_formats else None,
            "supported_formats": supported_formats,
            "mc_resolution": effective_mc_res,
            "execution_time": elapsed,
            "multi_views_used": ["front", "side", "top", "back"],
            "multi_views": views_info["meta"],
            "proportion_note": (
                "4-view conditioned reconstruction aligns proportions and 360-degree surface textures "
                "across Front, Side, Top, and Back views."
            ),
            **stats,
        }

    def _run_hunyuan3d_fallback(
        self,
        image_path: Path,
        generation_id: str,
        source_image_url: str,
        seed: int,
        progress: Optional[ProgressCallback] = None,
        category: str = "Chair",
        multi_views: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        caps = check_3d_capabilities()
        if not caps["fallback"]["available"]:
            raise Mesh3DIncompatibleError(" ".join(caps["fallback"]["blocking_reasons"]))

        import importlib
        import torch
        import trimesh

        BackgroundRemover = importlib.import_module("hy3dgen.rembg").BackgroundRemover
        Hunyuan3DDiTFlowMatchingPipeline = importlib.import_module(
            "hy3dgen.shapegen"
        ).Hunyuan3DDiTFlowMatchingPipeline

        t0 = time.time()
        if progress:
            progress(1, 5, f"Loading fallback {HUNYUAN3D_MODEL} & aligning 4-view references")

        front_path, views_info = _prepare_multiview_info_for_3d(
            image_path, category=category, multi_views=multi_views
        )
        _install_dinov2_state_dict_compat_hook()

        if self._hy_shapegen is None:
            self._hy_shapegen = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                HUNYUAN3D_MODEL,
                subfolder=HUNYUAN3D_SUBFOLDER,
                use_safetensors=True,
                device="cuda",
            )
        if self._hy_rembg is None:
            self._hy_rembg = BackgroundRemover()

        if progress:
            progress(2, 5, "Removing background from photoreal render")
        with Image.open(front_path) as src_img:
            rgba_img = src_img.convert("RGBA")
        rgba_img = self._hy_rembg(rgba_img)

        if progress:
            progress(3, 5, f"Generating 3D shape mesh with {HUNYUAN3D_MODEL}")
        mesh = self._hy_shapegen(
            image=rgba_img,
            num_inference_steps=HUNYUAN3D_STEPS,
            octree_resolution=HUNYUAN3D_OCTREE_RES,
            num_chunks=20000,
            generator=torch.manual_seed(int(seed)),
            output_type="trimesh",
        )[0]

        mesh = _sculpt_mesh_to_multiview_hull(mesh, views_info)
        uv_mapped = False
        srgb_colors_uint8 = None
        if HUNYUAN3D_ENABLE_TEXTURE and caps["vram_gb"] >= 10.0:
            try:
                if progress:
                    progress(4, 5, "Synthesizing UV texture with Hunyuan3D Paint")
                if self._hy_texgen is None:
                    Hunyuan3DPaintPipeline = importlib.import_module(
                        "hy3dgen.texgen"
                    ).Hunyuan3DPaintPipeline

                    self._hy_texgen = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
                mesh = self._hy_texgen(mesh, image=rgba_img)
                uv_mapped = True
            except Exception as tex_exc:
                logger.warning("Hunyuan3D texture pass skipped (projecting 4-view colors): %s", tex_exc)

        if not uv_mapped:
            fused_rgb = _project_multiview_colors(
                mesh.vertices, mesh.vertex_normals, mesh.bounds, views_info, blend=1.0
            )
            srgb_colors_uint8 = np.clip(np.round(fused_rgb * 255.0), 0, 255).astype(np.uint8)
            linear_rgba = _srgb_to_linear_rgba(fused_rgb)
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=linear_rgba)

        if progress:
            progress(5, 5, "Exporting real 3D mesh assets (GLB, GLTF, OBJ)")
        supported_formats = _export_trimesh_formats(mesh, generation_id, srgb_vertex_colors=srgb_colors_uint8)
        stats = _extract_mesh_stats(mesh, has_uv=uv_mapped, pbr_materials=uv_mapped)
        elapsed = round(time.time() - t0, 2)

        return {
            "status": "ready",
            "engine_used": "Hunyuan3D-2mini",
            "model_id": HUNYUAN3D_MODEL,
            "priority_tier": "fallback",
            "device": "cuda",
            "gpu_name": caps.get("gpu_name"),
            "vram_gb": caps.get("vram_gb"),
            "source_image_url": source_image_url,
            "glb_url": f"/outputs/models3d/{generation_id}/model.glb",
            "gltf_url": f"/api/3d/download/{generation_id}/gltf" if "gltf" in supported_formats else None,
            "obj_url": f"/api/3d/download/{generation_id}/obj" if "obj" in supported_formats else None,
            "supported_formats": supported_formats,
            "execution_time": elapsed,
            "multi_views_used": ["front", "side", "top", "back"],
            "multi_views": views_info["meta"],
            "proportion_note": (
                "4-view conditioned reconstruction aligns proportions and 360-degree surface textures "
                "across Front, Side, Top, and Back views."
            ),
            **stats,
        }

    @staticmethod
    def _save_metadata(generation_id: str, payload: Dict[str, Any]) -> None:
        """Persist reconstructed 3D metadata beside model.glb so spec_* items survive reloads."""
        try:
            meta_path = MODEL_3D_DIR / generation_id / "meta.json"
            meta_path.parent.mkdir(parents=True, exist_ok=True)
            meta_path.write_text(json.dumps(payload), encoding="utf-8")
        except Exception as exc:
            logger.warning("Could not write 3D metadata for %s: %s", generation_id, exc)

    def reconstruct_from_image(
        self,
        image_path: Path,
        generation_id: str,
        source_image_url: str,
        model_preference: str = "auto",
        mc_resolution: int = TRIPOSR_MC_RESOLUTION,
        bake_texture: bool = TRIPOSR_BAKE_TEXTURE,
        seed: int = 42,
        progress: Optional[ProgressCallback] = None,
        category: str = "Chair",
        multi_views: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Reconstruct a 3D mesh conditioned on all 4 orthogonal views (Front, Side, Top, Back).

        Order for `auto`:
          1. TripoSR (`stabilityai/TripoSR`)
          2. Fallback to Hunyuan3D-2mini (`tencent/Hunyuan3D-2mini`) if TripoSR fails
        """
        with self._lock:
            if model_preference == "hunyuan3d":
                result = self._run_hunyuan3d_fallback(
                    image_path=image_path,
                    generation_id=generation_id,
                    source_image_url=source_image_url,
                    seed=seed,
                    progress=progress,
                    category=category,
                    multi_views=multi_views,
                )
                self._save_metadata(generation_id, result)
                return result

            primary_error = None
            try:
                result = self._run_triposr(
                    image_path=image_path,
                    generation_id=generation_id,
                    source_image_url=source_image_url,
                    mc_resolution=mc_resolution,
                    bake_texture=bake_texture,
                    progress=progress,
                    category=category,
                    multi_views=multi_views,
                )
                self._save_metadata(generation_id, result)
                return result
            except Exception as exc:
                primary_error = f"TripoSR ({TRIPOSR_MODEL}) failed: {exc}"
                logger.warning("%s", primary_error)
                if model_preference == "triposr":
                    raise Mesh3DGenerationError(primary_error) from exc

            if progress:
                progress(1, 5, f"TripoSR unavailable; falling back to {HUNYUAN3D_MODEL}")

            try:
                result = self._run_hunyuan3d_fallback(
                    image_path=image_path,
                    generation_id=generation_id,
                    source_image_url=source_image_url,
                    seed=seed,
                    progress=progress,
                    category=category,
                    multi_views=multi_views,
                )
                result["fallback_reason"] = primary_error
                self._save_metadata(generation_id, result)
                return result
            except Exception as fb_exc:
                raise Mesh3DGenerationError(
                    f"{primary_error} | Fallback {HUNYUAN3D_MODEL} failed: {fb_exc}"
                ) from fb_exc

