"""Tests for TripoSR (Priority 1) + Hunyuan3D-2mini (Fallback) 3D reconstruction."""
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import OUTPUT_DIR
from app.database.db import db
from app.main import app
from app.pipeline.mesh3d_engine import (
    Mesh3DEngine,
    PhotorealInputError,
    check_3d_capabilities,
    resolve_photoreal_render_path,
)

client = TestClient(app)


def _find_existing_generated_record():
    for item in db.get_all(limit=60):
        rel = (item.get("result_image_url") or "").lstrip("/")
        if rel.startswith("outputs/"):
            fname = rel.split("/", 1)[1]
            if (OUTPUT_DIR / fname).exists():
                return item
    return None


def test_3d_requirements_reports_priority_chain():
    res = client.get("/api/3d/requirements")
    assert res.status_code == 200
    data = res.json()
    assert data["priority_order"] == ["triposr", "hunyuan3d"]
    assert data["primary"]["model_id"] == "stabilityai/TripoSR"
    assert data["fallback"]["model_id"] == "tencent/Hunyuan3D-2mini"
    assert data["primary"]["available"] is True
    assert data["ready"] is True


def test_photoreal_input_validation_rejects_sketch_and_edge_map():
    record = _find_existing_generated_record()
    assert record is not None, "Expected at least one generated furniture render in gallery DB."

    path, url = resolve_photoreal_render_path(record, requested_image_url=record["result_image_url"])
    assert path.exists()
    assert url == record["result_image_url"]

    # Support full public URLs (e.g. from Cloudflare tunnels or custom backend domains)
    full_tunnel_url = f"https://requires-accurately-makeup-backup.trycloudflare.com{record['result_image_url']}"
    path_full, url_full = resolve_photoreal_render_path(record, requested_image_url=full_tunnel_url)
    assert path_full.exists()
    assert url_full == record["result_image_url"]

    for forbidden in (
        record["original_image_url"],
        record["preprocessed_edge_url"],
        "/sample_sketches/sofa_sketch.png",
        "/outputs/edge_sofa.png",
        "/outputs/../config.py",
    ):
        try:
            resolve_photoreal_render_path(record, requested_image_url=forbidden)
            raise AssertionError(f"Expected PhotorealInputError for {forbidden}")
        except PhotorealInputError:
            pass


def test_priority_order_falls_back_from_triposr_to_hunyuan3d(tmp_path):
    dummy_img = tmp_path / "render.png"
    dummy_img.write_bytes(b"fake")
    engine = Mesh3DEngine()

    calls = []

    def fail_triposr(*args, **kwargs):
        calls.append("triposr")
        raise RuntimeError("Simulated TripoSR error")

    def ok_hunyuan(*args, **kwargs):
        calls.append("hunyuan3d")
        return {"status": "ready", "engine_used": "Hunyuan3D-2mini", "priority_tier": "fallback"}

    with patch.object(engine, "_run_triposr", side_effect=fail_triposr), patch.object(
        engine, "_run_hunyuan3d_fallback", side_effect=ok_hunyuan
    ):
        res = engine.reconstruct_from_image(
            image_path=dummy_img,
            generation_id="test_fb",
            source_image_url="/outputs/render.png",
            model_preference="auto",
        )

    assert calls == ["triposr", "hunyuan3d"]
    assert res["engine_used"] == "Hunyuan3D-2mini"
    assert "Simulated TripoSR error" in res["fallback_reason"]


def test_3d_endpoints_input_and_error_handling():
    record = _find_existing_generated_record()
    assert record is not None

    bad = client.post(
        "/api/3d/generate",
        json={
            "generation_id": record["id"],
            "image_url": record["preprocessed_edge_url"],
        },
    )
    assert bad.status_code == 422

    # Explicitly requesting CUDA-only fallback on CPU-only machine returns clear 503
    caps = check_3d_capabilities()
    if not caps["fallback"]["available"]:
        fb = client.post(
            "/api/3d/generate",
            json={
                "generation_id": record["id"],
                "image_url": record["result_image_url"],
                "model_preference": "hunyuan3d",
            },
        )
        assert fb.status_code == 503

    assert client.get("/api/3d/status/nonexistent_id").status_code == 404
    assert client.get("/api/3d/download/furn_demo/fbx").status_code == 400
    assert client.get("/api/3d/download/nonexistent_id/glb").status_code == 404


def test_clean_furniture_foreground_prunes_border_wall_bleed():
    import numpy as np
    import rembg
    from PIL import Image
    from app.pipeline.mesh3d_engine import _clean_furniture_foreground

    cupboard_path = OUTPUT_DIR / "render_furn_3567855e57_0.png"
    if not cupboard_path.exists():
        return

    with Image.open(cupboard_path) as im:
        cleaned = _clean_furniture_foreground(im.convert("RGB"), rembg.new_session("u2net"))
    alpha = np.array(cleaned)[:, :, 3]
    assert np.mean(alpha[:, -6:] > 20) < 0.02
    assert np.mean(alpha[:, :6] > 20) < 0.02


def test_hunyuan3d_dinov2_state_dict_compat_hook():
    """Verify legacy transformers v4 SingleImageEncoder DINOv2 keys remap cleanly to v5."""
    import torch
    from transformers import Dinov2Config, Dinov2Model
    from app.pipeline.mesh3d_engine import _install_dinov2_state_dict_compat_hook

    _install_dinov2_state_dict_compat_hook()

    class DummySingleImageEncoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            cfg = Dinov2Config(
                hidden_size=32,
                num_hidden_layers=2,
                num_attention_heads=4,
                intermediate_size=64,
                use_swiglu_ffn=True,
                image_size=32,
                patch_size=16,
            )
            self.main_image_encoder = torch.nn.Module()
            self.main_image_encoder.model = Dinov2Model(cfg)

    enc = DummySingleImageEncoder()
    v5_sd = enc.state_dict()

    # Build a legacy v4 checkpoint state_dict mimicking tencent/Hunyuan3D-2mini
    legacy_sd = {}
    for k, v in v5_sd.items():
        if ".attention.q_proj." in k:
            legacy_sd[k.replace(".attention.q_proj.", ".attention.attention.query.")] = v.clone()
        elif ".attention.k_proj." in k:
            legacy_sd[k.replace(".attention.k_proj.", ".attention.attention.key.")] = v.clone()
        elif ".attention.v_proj." in k:
            legacy_sd[k.replace(".attention.v_proj.", ".attention.attention.value.")] = v.clone()
        elif ".attention.o_proj." in k:
            legacy_sd[k.replace(".attention.o_proj.", ".attention.output.dense.")] = v.clone()
        elif ".mlp.down_proj." in k:
            legacy_sd[k.replace(".mlp.down_proj.", ".mlp.weights_out.")] = v.clone()
        elif ".mlp.gate_proj." in k:
            up_k = k.replace(".mlp.gate_proj.", ".mlp.up_proj.")
            win_k = k.replace(".mlp.gate_proj.", ".mlp.weights_in.")
            legacy_sd[win_k] = torch.cat([v.clone(), v5_sd[up_k].clone()], dim=0)
        elif ".mlp.up_proj." in k:
            continue
        else:
            legacy_sd[k] = v.clone()

    # Loading strict=True must succeed with 0 missing and 0 unexpected keys
    enc2 = DummySingleImageEncoder()
    enc2.load_state_dict(legacy_sd, strict=True)
    for k, v in v5_sd.items():
        assert torch.allclose(enc2.state_dict()[k], v)


