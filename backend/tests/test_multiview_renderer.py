"""Tests for consistent texture-locked Multi-View generation (Front, Side, Top, Back)."""
import sys
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.pipeline.multiview_renderer import generate_multi_views

client = TestClient(app)


def _make_synthetic_table_with_plant(size: int = 512) -> np.ndarray:
    """Create a realistic 512x512 studio image of a walnut table with a potted green plant."""
    canvas = np.full((size, size, 3), (218, 224, 232), dtype=np.uint8)
    # Studio floor horizon band
    canvas[370:, :] = (205, 211, 218)

    # Walnut brown tabletop (BGR: 45, 72, 110)
    cv2.rectangle(canvas, (105, 290), (407, 326), (45, 72, 110), -1)
    # Splayed wooden legs
    cv2.line(canvas, (145, 326), (115, 438), (42, 68, 104), 16)
    cv2.line(canvas, (367, 326), (397, 438), (42, 68, 104), 16)
    # Horizontal stretcher bar between legs
    cv2.rectangle(canvas, (130, 382), (382, 396), (48, 76, 115), -1)

    # White ceramic pot resting at center on top of table
    cv2.rectangle(canvas, (236, 250), (276, 290), (235, 240, 245), -1)
    # Green plant leaves above the pot
    cv2.ellipse(canvas, (244, 226), (22, 9), -42, 0, 360, (42, 118, 52), -1)
    cv2.ellipse(canvas, (268, 224), (22, 9), 40, 0, 360, (36, 104, 46), -1)
    cv2.ellipse(canvas, (256, 214), (10, 24), 0, 0, 360, (48, 130, 58), -1)
    return canvas


def test_multiview_generation_preserves_design_color_and_top_accessory(tmp_path):
    front = _make_synthetic_table_with_plant(512)
    front_path = tmp_path / "table_front.png"
    cv2.imwrite(str(front_path), front)

    mv = generate_multi_views(
        front_bgr=front,
        prefix="test_table",
        category="Table",
        output_dir=tmp_path,
        front_url="/outputs/table_front.png",
    )

    assert len(mv["views"]) == 4
    assert [v["id"] for v in mv["views"]] == ["front", "side", "top", "back"]

    for angle in ("side", "top", "back"):
        fname = Path(mv[angle]).name
        out_img = cv2.imread(str(tmp_path / fname))
        assert out_img is not None, f"Failed to read {angle} output"
        assert out_img.shape == (512, 512, 3)

    sheet_img = cv2.imread(str(tmp_path / Path(mv["sheet"]).name))
    assert sheet_img is not None
    assert sheet_img.shape == (1024, 1024, 3)

    # Side view must preserve the green plant leaves at upper center and brown wood below
    side_img = cv2.imread(str(tmp_path / Path(mv["side"]).name))
    upper_roi = side_img[195:248, 215:297]
    # Check green channel dominance over red in plant foliage region
    green_dominant = (upper_roi[:, :, 1].astype(int) - upper_roi[:, :, 2].astype(int)) > 20
    assert np.sum(green_dominant) > 80, "Side view should preserve resting plant foliage"

    # Top view must render both wooden tabletop pixels and radial green plant at center
    top_img = cv2.imread(str(tmp_path / Path(mv["top"]).name))
    center_roi = top_img[210:302, 210:302]
    green_top = (center_roi[:, :, 1].astype(int) - center_roi[:, :, 2].astype(int)) > 20
    assert np.sum(green_top) > 120, "Top view should preserve overhead green plant on tabletop"

    # Brown wood color present on tabletop left/right flanks in top view
    flank_roi = top_img[220:290, 140:200]
    brown_wood = (flank_roi[:, :, 2].astype(int) - flank_roi[:, :, 0].astype(int)) > 35
    assert np.sum(brown_wood) > 500, "Top view should match front view wood palette color"


def test_multiview_works_across_all_categories(tmp_path):
    for cat in ("Chair", "Sofa", "Table", "Bed", "Cabinet"):
        res = client.post(
            "/api/spec-render",
            json={
                "category": cat,
                "material": "Wood",
                "color": "Warm Walnut",
                "style": "Modern",
                "finish": "Matte",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert "multi_views" in data
        mv = data["multi_views"]
        assert mv["front"].startswith("/outputs/")
        assert mv["side"].endswith("_side.png")
        assert mv["top"].endswith("_top.png")
        assert mv["back"].endswith("_back.png")
        assert mv["sheet"].endswith("_multiview.png")
        assert len(mv["views"]) == 4


def test_gallery_returns_consistent_multiviews():
    res = client.get("/api/gallery?limit=5")
    assert res.status_code == 200
    data = res.json()
    for item in data.get("items", []):
        if item.get("result_image_url", "").startswith("/outputs/"):
            assert "multi_views" in item
            mv = item["multi_views"]
            assert mv and len(mv.get("views", [])) == 4


def test_3d_multiview_geometry_and_color_projection(tmp_path):
    """Verify 3D mesh alignment, hull scaling, and 4-view orthographic color fusion."""
    import trimesh
    from app.pipeline.mesh3d_engine import (
        _prepare_multiview_info_for_3d,
        _project_multiview_colors,
        _sculpt_mesh_to_multiview_hull,
    )

    front = _make_synthetic_table_with_plant(512)
    front_path = tmp_path / "table_sample.png"
    cv2.imwrite(str(front_path), front)

    # Also test triggering from side path resolves back to canonical front image
    mv = generate_multi_views(front, "table_sample", "Table", tmp_path, "/outputs/table_sample.png")
    side_path = tmp_path / Path(mv["side"]).name
    resolved_front, views_info = _prepare_multiview_info_for_3d(side_path, category="Table", multi_views=mv)

    assert resolved_front == front_path
    assert set(views_info["views"].keys()) == {"front", "side", "top", "back"}

    # Build a synthetic box mesh in Three.js studio coordinates (+Z Front, -Z Back, +/-X Side, +Y Top)
    box = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    sculpted = _sculpt_mesh_to_multiview_hull(box, views_info)

    # Front width/height ratio matches tabletop horizontal width vs height (depth_ratio 0.64)
    ext = sculpted.bounds[1] - sculpted.bounds[0]
    assert abs(sculpted.bounds[0][1]) < 1e-3, "Mesh must be grounded at Y=0"
    assert ext[0] > ext[2], "Table front width (X) should exceed side depth (Z)"

    colors = _project_multiview_colors(
        sculpted.vertices, sculpted.vertex_normals, sculpted.bounds, views_info, blend=1.0
    )
    assert colors.shape == (len(sculpted.vertices), 3)
    assert float(colors.min()) >= 0.0 and float(colors.max()) <= 1.0

    # Top face center vertex (+Y normal) should capture the green plant resting on center
    top_center_pts = np.array([[0.0, float(sculpted.bounds[1][1]), 0.0]])
    top_center_nrm = np.array([[0.0, 1.0, 0.0]])
    top_rgb = _project_multiview_colors(top_center_pts, top_center_nrm, sculpted.bounds, views_info, blend=1.0)
    assert top_rgb[0, 1] > top_rgb[0, 2], "Top-center of table should project plant/foliage colors from Top view"


def test_table_slab_with_upper_blocks_and_dark_legs_has_no_barcode_or_broken_legs(tmp_path):
    """
    Regression test for user screenshot: table with dark walnut splayed legs,
    crossbar stretchers, and tall two-tone blocks behind a potted plant on top
    even when category is initially 'Chair'.
    """
    from app.pipeline.cnn_extractor import CNNFeatureExtractor

    canvas = np.full((512, 512, 3), (155, 162, 170), dtype=np.uint8)
    canvas[360:, :] = (138, 145, 152)

    # Upper two-tone block + plant sitting on tabletop (width ~195px < 0.74 * 320px tabletop)
    cv2.rectangle(canvas, (165, 130), (225, 312), (225, 228, 232), -1)
    cv2.rectangle(canvas, (225, 130), (345, 312), (72, 102, 148), -1)
    cv2.rectangle(canvas, (236, 265), (278, 312), (48, 52, 58), -1)
    cv2.ellipse(canvas, (255, 240), (16, 26), -15, 0, 360, (42, 124, 52), -1)

    # Wide dark walnut tabletop slab (width = 330px, y = 312..334)
    cv2.rectangle(canvas, (90, 312), (420, 334), (35, 52, 82), -1)
    # Dark walnut splayed legs down to y=495 (low chroma vs dark floor)
    cv2.line(canvas, (135, 334), (82, 495), (30, 44, 68), 22)
    cv2.line(canvas, (375, 334), (428, 495), (30, 44, 68), 22)
    # Two horizontal stretcher bars between the legs
    cv2.rectangle(canvas, (118, 392), (392, 404), (38, 50, 74), -1)
    cv2.rectangle(canvas, (104, 432), (406, 444), (32, 42, 62), -1)

    mv = generate_multi_views(
        front_bgr=canvas,
        prefix="regression_table_plant",
        category="Chair",
        output_dir=tmp_path,
        front_url="/outputs/regression_table_plant.png",
    )

    top_img = cv2.imread(str(tmp_path / Path(mv["top"]).name))
    back_img = cv2.imread(str(tmp_path / Path(mv["back"]).name))
    side_img = cv2.imread(str(tmp_path / Path(mv["side"]).name))
    assert top_img is not None and back_img is not None and side_img is not None

    # 1. Top view tabletop flank must reflect the dark walnut tabletop (not the white block at x=165..225)
    left_table_roi = top_img[180:330, 130:195]
    assert float(left_table_roi.mean()) < 165.0, "Top view must sample the walnut tabletop, not white upper wall blocks"

    # 2. Back view lower legs & stretcher bar (y=395) must remain intact (dark wood, not erased into background)
    back_leg_pixel = back_img[420, 512 - 1 - 110]
    assert float(back_leg_pixel.mean()) < 110.0, "Dark walnut legs must not be erased as floor shadow in Back View"

    # 3. Geometry refinement on sketch edge map of table + plant must classify as Table
    sketch_edges = np.zeros((512, 512), dtype=np.uint8)
    cv2.rectangle(sketch_edges, (230, 220), (282, 288), 255, 2)  # plant pot
    cv2.ellipse(sketch_edges, (256, 190), (28, 30), 0, 0, 360, 255, 2)  # plant leaves
    cv2.rectangle(sketch_edges, (95, 290), (415, 322), 255, 3)  # wide tabletop
    cv2.line(sketch_edges, (140, 322), (98, 430), 255, 3)  # left leg
    cv2.line(sketch_edges, (370, 322), (412, 430), 255, 3)  # right leg
    cv2.line(sketch_edges, (118, 385), (392, 385), 255, 3)  # stretcher

    raw_probs = {"Chair": 0.42, "Table": 0.05, "Sofa": 0.02, "Bed": 0.01, "Cabinet": 0.01}
    geo = CNNFeatureExtractor._geometry(sketch_edges)
    refined_probs, acc = CNNFeatureExtractor._refine_probs_with_geometry(sketch_edges, raw_probs, geo)
    assert max(refined_probs, key=refined_probs.get) == "Table"
    assert "with a small potted plant on top" in acc

    # 4. Also test enclosed back panel categories (Chair, Sofa, Bed, Cabinet) directly through generate_multi_views
    chair_canvas = np.full((512, 512, 3), (220, 225, 230), dtype=np.uint8)
    cv2.rectangle(chair_canvas, (80, 90), (432, 410), (50, 80, 125), -1)
    cv2.line(chair_canvas, (110, 410), (95, 485), (40, 65, 100), 18)
    cv2.line(chair_canvas, (402, 410), (417, 485), (40, 65, 100), 18)
    for cat_name in ("Chair", "Sofa", "Bed", "Cabinet"):
        mv_cat = generate_multi_views(
            front_bgr=chair_canvas,
            prefix=f"direct_{cat_name.lower()}",
            category=cat_name,
            output_dir=tmp_path,
            front_url=f"/outputs/direct_{cat_name.lower()}.png",
        )
        assert len(mv_cat["views"]) == 4




