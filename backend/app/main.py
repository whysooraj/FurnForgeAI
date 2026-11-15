"""
FurnForge AI - FastAPI backend.

Pipeline for every generation request:
  1. Receive sketch (upload or example sketch)          -> uploads/
  2. OpenCV preprocessing + Canny edge map              -> outputs/edge_*.png
  3. Pretrained CNN (ResNet) analysis + Grad-CAM
  4. Stable Diffusion 1.5 + ControlNet image-to-image   -> outputs/render_*.png
  5. Result stored in the SQLite gallery
"""
import base64
import binascii
import logging
import random
import time
import uuid
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from app.config import (
    APP_NAME,
    APP_VERSION,
    DEVICE,
    ENABLE_LCM,
    MAX_UPLOAD_MB,
    OUTPUT_DIR,
    PRELOAD_MODELS,
    SAMPLE_DIR,
    SD_MODEL,
    CONTROLNET_MODELS,
    DEFAULT_CONTROLNET,
    UPLOAD_DIR,
)
from app.database.db import db
from app.jobs import Job, JobManager
from app.models.schemas import GenerateRequest, PreprocessRequest
from app.pipeline.cnn_extractor import CNNFeatureExtractor
from app.pipeline.cv_preprocessor import OpenCVPreprocessor
from app.pipeline.diffusion_engine import DiffusionEngine
from app.pipeline.prompt_builder import build_prompt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s: %(message)s")
logger = logging.getLogger("FurnForgeAI")

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Sketch-to-photoreal furniture rendering with OpenCV, a pretrained CNN, "
                "Stable Diffusion 1.5 and ControlNet.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/sample_sketches", StaticFiles(directory=str(SAMPLE_DIR)), name="sample_sketches")

cnn = CNNFeatureExtractor()
engine = DiffusionEngine()
jobs = JobManager()

SAMPLES = [
    {"id": "chair", "name": "Lounge chair", "category": "Chair"},
    {"id": "sofa", "name": "Three-seater sofa", "category": "Sofa"},
    {"id": "table", "name": "Pedestal table", "category": "Table"},
    {"id": "bed", "name": "Platform bed", "category": "Bed"},
    {"id": "cabinet", "name": "Credenza", "category": "Cabinet"},
]
ALLOWED_FORMATS = {".png", ".jpg", ".jpeg", ".webp"}


@app.on_event("startup")
def _startup() -> None:
    if PRELOAD_MODELS:
        engine.load_async()


# --------------------------------------------------------------------------- helpers
def _decode_upload(data_url: str) -> np.ndarray:
    """Validate size/format of a base64 upload and decode it to BGR."""
    payload = data_url.split(",", 1)[1] if "," in data_url else data_url
    if len(payload) * 3 / 4 > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Image exceeds the {MAX_UPLOAD_MB} MB limit.")
    if data_url.startswith("data:") and not any(
        t in data_url[:40] for t in ("image/png", "image/jpeg", "image/jpg", "image/webp")
    ):
        raise HTTPException(415, "Unsupported format. Upload PNG, JPG or JPEG.")
    try:
        return OpenCVPreprocessor.decode_image_base64(data_url)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(400, f"Could not decode image: {exc}")


def _load_input(req_image: Optional[str], sample_id: Optional[str]):
    if sample_id:
        path = SAMPLE_DIR / f"{sample_id}_sketch.png"
        if not path.exists():
            raise HTTPException(404, f"Example sketch '{sample_id}' not found.")
        return cv2.imread(str(path)), f"/sample_sketches/{path.name}"
    if req_image:
        bgr = _decode_upload(req_image)
        name = f"upload_{uuid.uuid4().hex[:12]}.png"
        cv2.imwrite(str(UPLOAD_DIR / name), bgr)
        return bgr, f"/uploads/{name}"
    raise HTTPException(400, "Provide either 'image_base64' or 'sample_id'.")


def _model_status() -> dict:
    return {
        "status": engine.status,
        "detail": engine.status_detail,
        "error": engine.error,
        "engine": engine.engine_label,
        "sd_model": SD_MODEL,
        "controlnet_model": CONTROLNET_MODELS[DEFAULT_CONTROLNET],
        "lcm_enabled": ENABLE_LCM,
        "lcm_available": engine.lcm_available,
        "load_seconds": engine.load_seconds,
    }


# --------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": APP_VERSION,
        "device": DEVICE,
        "model": _model_status(),
        "cnn": {"ready": cnn.ready, "backbone": getattr(cnn, "backbone_name", None), "error": cnn.error},
        "queue_length": jobs.pending,
    }


@app.post("/api/model/load")
def load_model():
    """Start loading the diffusion models (useful when PRELOAD_MODELS=false)."""
    engine.load_async()
    return _model_status()


@app.get("/api/samples")
def samples():
    return {"samples": [
        {**s, "url": f"/sample_sketches/{s['id']}_sketch.png"}
        for s in SAMPLES if (SAMPLE_DIR / f"{s['id']}_sketch.png").exists()
    ]}


@app.post("/api/preprocess")
def preprocess(req: PreprocessRequest):
    """OpenCV preprocessing + CNN analysis, used for the live preview in the studio."""
    bgr = _decode_upload(req.image_base64)
    prep = OpenCVPreprocessor.process_sketch(
        bgr, low_threshold=req.low_threshold, high_threshold=req.high_threshold,
        blur_kernel=req.blur_kernel if req.blur_kernel % 2 else req.blur_kernel + 1,
        method=req.method,
    )
    features = cnn.analyze(prep["padded_bgr"], prep["edge_map"]) if cnn.ready else None
    cond_b64 = prep["base64_scribble_map"] if DEFAULT_CONTROLNET == "scribble" else prep["base64_edge_map"]
    return {
        "edge_map_base64": cond_b64,
        "scribble_map_base64": prep["base64_scribble_map"],
        "display_sketch_base64": prep["base64_display_sketch"],
        "edge_density_percent": prep["edge_density_percent"],
        "contour_count": prep["contour_count"],
        "cnn_features": features,
        "cnn_heatmap_base64": features.get("b64_heatmap") if features else None,
        "pixel_metrics": features.get("pixel_metrics") if features else None,
        "cnn_error": None if cnn.ready else cnn.error,
    }


@app.post("/api/generate", status_code=202)
def generate(req: GenerateRequest):
    """
    Validate input, run OpenCV + CNN synchronously, then queue the diffusion job.
    Returns a job id; poll GET /api/jobs/{job_id} for progress and the result.
    """
    if engine.status != "ready":
        raise HTTPException(503, f"Generative model not ready ({engine.status}): {engine.status_detail}"
                                 + (f" Error: {engine.error}" if engine.error else ""))

    raw_bgr, original_url = _load_input(req.image_base64, req.sample_id)
    if req.low_threshold >= req.high_threshold:
        raise HTTPException(422, "low_threshold must be smaller than high_threshold.")

    gen_id = f"furn_{uuid.uuid4().hex[:10]}"
    prep = OpenCVPreprocessor.process_sketch(
        raw_bgr, low_threshold=req.low_threshold, high_threshold=req.high_threshold
    )
    cond_map = prep["scribble_map"] if DEFAULT_CONTROLNET == "scribble" else prep["edge_map"]
    edge_name = f"edge_{gen_id}.png"
    cv2.imwrite(str(OUTPUT_DIR / edge_name), cond_map)

    cnn_features = cnn.analyze(prep["padded_bgr"], prep["edge_map"]) if cnn.ready else {}

    prompt = build_prompt(
        req.category, req.material, req.color, req.style, req.finish,
        req.custom_prompt or "", cnn_features=cnn_features
    )
    negative = (req.negative_prompt or "").strip() or prompt["negative_prompt"]
    base_seed = req.seed if req.seed is not None else random.randint(0, 2**31 - 1)

    # Diffusers inputs: ControlNet receives the clean scribble/edge map; img2img starts from cleaned sketch.
    control_image = Image.fromarray(cv2.cvtColor(cond_map, cv2.COLOR_GRAY2RGB))
    init_image = Image.fromarray(cv2.cvtColor(prep["padded_bgr"], cv2.COLOR_BGR2RGB))

    def run(job: Job) -> dict:
        t0 = time.time()
        variations = []
        for i in range(req.num_variations):
            seed = base_seed + i
            job.report(i, 0, 0, f"Denoising variation {i + 1}/{req.num_variations}")

            def on_step(step: int, total: int, _i=i):
                job.report(_i, step, total,
                           f"Variation {_i + 1}/{req.num_variations}: denoising step {step}/{total}")

            image = engine.generate(
                control_image=control_image, init_image=init_image,
                prompt=prompt["positive_prompt"], negative_prompt=negative,
                mode=req.mode, strength=req.strength, fast=req.fast,
                steps=req.num_inference_steps, guidance_scale=req.guidance_scale,
                controlnet_scale=req.controlnet_conditioning_scale, seed=seed, progress=on_step,
            )
            name = f"render_{gen_id}_{i}.png"
            image.save(OUTPUT_DIR / name)
            variations.append({"variation_index": i, "image_url": f"/outputs/{name}", "seed": seed})

        elapsed = round(time.time() - t0, 2)
        mode_label = engine.engine_label + (" + LCM-LoRA" if req.fast and engine.lcm_available else "")
        mode_label += " | img2img" if req.mode == "img2img" else " | ControlNet txt2img"
        record = {
            "id": gen_id,
            "category": req.category, "material": req.material, "color": req.color,
            "style": req.style, "finish": req.finish,
            "prompt": prompt["positive_prompt"],
            "original_image_url": original_url,
            "preprocessed_edge_url": f"/outputs/{edge_name}",
            "result_image_url": variations[0]["image_url"],
            "variations": variations,
            "cnn_features": {k: v for k, v in cnn_features.items() if k != "b64_heatmap"},
            "pipeline_mode": mode_label,
            "execution_time": elapsed,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        db.save_generation(record)
        return {**record, "cnn_features": cnn_features, "negative_prompt": negative, "device": DEVICE,
                "settings": req.model_dump(exclude={"image_base64"})}

    job = jobs.submit(run, total_units=req.num_variations)
    return {
        "job_id": job.id,
        "generation_id": gen_id,
        "original_image_url": original_url,
        "preprocessed_edge_url": f"/outputs/{edge_name}",
        "cnn_features": cnn_features,
        "queue_position": jobs.pending,
    }


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return job.to_dict()


@app.get("/api/gallery")
def gallery(category: Optional[str] = None, limit: int = 60):
    items = db.get_all(category=category, limit=limit)
    return {"count": len(items), "items": items}


@app.get("/api/gallery/{item_id}")
def gallery_item(item_id: str):
    item = db.get_by_id(item_id)
    if not item:
        raise HTTPException(404, "Item not found.")
    return item


@app.delete("/api/gallery/{item_id}")
def delete_gallery_item(item_id: str):
    item = db.get_by_id(item_id)
    if not item or not db.delete_by_id(item_id):
        raise HTTPException(404, "Item not found.")
    # Remove the generated files belonging to this item.
    urls = [v["image_url"] for v in item.get("variations", [])] + [item["preprocessed_edge_url"]]
    if item["original_image_url"].startswith("/uploads/"):
        urls.append(item["original_image_url"])
    for url in urls:
        folder = OUTPUT_DIR if url.startswith("/outputs/") else UPLOAD_DIR
        (folder / url.rsplit("/", 1)[-1]).unlink(missing_ok=True)
    return {"status": "deleted", "id": item_id}
