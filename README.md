# FurnForge AI – Sketch-to-Photoreal Furniture & 3D Studio 🛋️✨

> 📖 **Comprehensive Guides & Deep Technical Documentation:**
> - [PROJECT_DOCUMENTATION.md](file:///d:/FurnForge%20AI/PROJECT_DOCUMENTATION.md) — Complete in-depth technical blueprint, mathematical formulations, and benchmarks.
> - [WORKFLOW_ARCHITECTURE.md](file:///d:/FurnForge%20AI/WORKFLOW_ARCHITECTURE.md) — Detailed step-by-step workflow pipeline, dataflows, and component architecture.
> - [LEARN.md](file:///d:/FurnForge%20AI/LEARN.md) — Generative AI, Computer Vision, Diffusion Mechanics, and 3D Neural Reconstruction learning manual.

**FurnForge AI** is an advanced Generative AI, Computer Vision, and 3D Neural Reconstruction platform that transforms hand-drawn furniture sketches into photorealistic, showroom-ready furniture renders and watertight interactive 3D assets.

Designed for university capstone showcases and industrial product design demonstrations, FurnForge AI overcomes the spatial hallucination and geometric distortion of naive text-to-image foundation models by enforcing structural constraint guidance via **Classical Computer Vision (OpenCV)**, **Deep Feature Extraction (ResNet-50 + Grad-CAM)**, **Spatial ControlNet (Canny/Scribble)**, **Latent Diffusion (SD 1.5 + LCM-LoRA)**, and **Neural 3D Mesh Generation (TripoSR / Hunyuan3D)**.

---

## 🏛️ End-to-End Pipeline & Workflow

```
+───────────────────────────────────────────────────────────────────────────────────────────+
│                                  FURNFORGE AI ARCHITECTURE                                │
+───────────────────────────────────────────────────────────────────────────────────────────+
  1. Sketch Ingestion (3 Modalities)
     ├── Option 1: Curated Presets (Chair, Sofa, Table, Desk, Lamp)
     ├── Option 2: File Upload (PNG, JPG, WebP up to 10MB)
     └── Option 3: Interactive Whiteboard Studio (SketchCanvas.jsx)
          ├── Real-time Marker Pen & Eraser (Round joint stroke smoothing)
          ├── 1:1 Screen Coordinate Mapping (Mouse pointer = drawing marker nib)
          ├── True Entire-Screen Fullscreen Canvas (Zero scrollbars)
          └── Auto-Bounding Box Segmentation & 512x512 Centered HD Export
          │
          ▼
  2. OpenCV Vision Preprocessing (cv_preprocessor.py)
     ├── Flat-Field Background Division (Eliminates Paper Shadows)
     ├── Bilateral Filtering (Smoothes Paper Grain, Preserves Pencil Edges)
     ├── CLAHE Local Dynamic Histogram Equalization
     ├── Canny Edge Detection & Scribble Inversion
     └── Aspect-Ratio Preserved Letterbox Padding (512x512)
          │
          ├───► 3. Deep Topology CNN (ResNet-50 Backbone)
          │        ├── 2048-dim Latent Feature Vector (layer4)
          │        ├── Topological Symmetry Score (L1 Horizontal Flip)
          │        ├── Aspect Ratio & Hu Invariant Moments (h1 - h7)
          │        ├── Furniture Category Prior Probabilities & Auto-Alignment
          │        └── Grad-CAM 262,144-pixel Thermal Attention Heatmap
          │
          ▼
  4. ControlNet Spatial Guidance (lllyasviel/control_v11p_sd15_canny)
     ├── Zero-convolutions lock exact sketch outlines and joinery
     └── Injected directly into U-Net skip-connections
          │
          ▼
  5. Latent Consistency Diffusion (SD 1.5 + LCM-LoRA)
     ├── PBR Material Synthesis (Walnut, Brushed Brass, Aniline Leather, Bouclé)
     ├── 4 to 8 Denoising Steps via Consistency Distillation Trajectory
     └── Architectural Studio Lighting, Ambient Occlusion & Contact Shadows
          │
          ├───► 6. Photorealistic 2D Render (Gallery, Comparison Slider, Variations)
          │
          ▼
  7. 3D Neural Reconstruction (mesh3d_engine.py & stabilityai/TripoSR)
     ├── Vision Transformer Triplane Density Evaluation
     ├── Marching Cubes Isosurface Mesh Extraction (160x160x160 Grid)
     ├── Automated UV Unwrapping & 1024x1024 PBR Texture Atlas Baking
     ├── Secondary Fallback Engine: Hunyuan3D-2mini DiT
     └── Interactive Three.js Orbit Viewer + WebXR Augmented Reality
```

---

## 🎨 Three Sketch Input Modalities (Step 1)

1. **Curated Presets Library:** Instant one-click loading of standardized sample sketches across 5 major furniture categories: Chair, Sofa, Table, Desk, and Lamp.
2. **File Upload & Drag-and-Drop:** Seamless ingestion of digital tablet exports, scans, or camera photos of pencil sketches in PNG, JPG, or WebP format up to 10MB.
3. **Interactive Whiteboard Studio (`SketchCanvas.jsx`):**
   - **Real-Time Drawing Pen:** Subpixel drawing with anti-aliasing and smooth path joining.
   - **Dedicated Eraser Sizing Controls:**
     - Independent tool states: switching between Pen and Eraser remembers your preferred thicknesses.
     - 4 quick presets: Fine (8px) for detail line cleanup, Medium (20px), Large (38px), and Wide (68px).
     - Smooth slider: fine-tunes eraser diameter from 4px to 80px with real-time numeric readout.
     - Dynamic dashed footprint ring: displays the exact erase boundary before clicking.
     - Hotkeys: `[` to decrease size, `]` to increase size.
   - **Mouse Pointer = Drawing Marker:** Custom visual marker cursor overlay positioned precisely at `(0, 0)`, placing the sharp drawing nib directly beneath the mouse pointer.
   - **Stroke Thickness & Palette:** 4 preset stroke widths (Fine 2px, Pen 4px, Marker 8px, Broad 16px) with 4 designer colors + custom color picker.
   - **Undo & Redo:** Canvas snapshot history stack (up to 30 steps) with keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`).
   - **True Entire-Screen Fullscreen:** Expands to 100% of the display edge-to-edge (`fixed inset-0 w-full h-full`) without window scrollbars.
   - **Auto-Framed Export:** Automatically segments the bounding box of your drawn furniture and centers it with 14% breathing margins into a 512×512 HD sketch for the AI pipeline.

---

## 🤖 Machine Learning Models & Hugging Face Hub Registry

All deep learning weights are fetched directly from the open-source Hugging Face Hub:

| Component | Model Name / Hugging Face Repository | Architecture / Parameters | Purpose |
| :--- | :--- | :--- | :--- |
| **Base Diffusion** | [`stable-diffusion-v1-5/stable-diffusion-v1-5`](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5) | Latent Diffusion U-Net (860M) | Foundational 2D photoreal image synthesis |
| **ControlNet (Scribble)** | [`lllyasviel/control_v11p_sd15_scribble`](https://huggingface.co/lllyasviel/control_v11p_sd15_scribble) | ControlNet with Zero-Convolutions | Spatial guidance for freehand sketches & joins |
| **ControlNet (Canny)** | [`lllyasviel/control_v11p_sd15_canny`](https://huggingface.co/lllyasviel/control_v11p_sd15_canny) | ControlNet with Zero-Convolutions | Precision hard-edge outline conditioning |
| **LCM-LoRA** | [`latent-consistency/lcm-lora-sdv1-5`](https://huggingface.co/latent-consistency/lcm-lora-sdv1-5) | Low-Rank Adaptation (LoRA) | Consistency distillation for 4-8 step inference |
| **Deep Feature Extractor** | `torchvision.models.resnet50(weights=DEFAULT)` | ResNet-50 CNN (25.6M) | 2048-dim embedding, Hu moments & Grad-CAM |
| **Fast 3D Mesh Engine** | [`stabilityai/TripoSR`](https://huggingface.co/stabilityai/TripoSR) | Transformer Triplane + Marching Cubes | Fast single-view 3D reconstruction & texture baking |
| **High-Precision 3D DiT** | [`tencent/Hunyuan3D-2mini`](https://huggingface.co/tencent/Hunyuan3D-2mini) | 3D Diffusion Transformer (Octree 380) | High-VRAM fallback for carved woodwork |

---

## 💻 Complete Technology Stack

### Backend
- **Framework:** FastAPI, Uvicorn, Starlette, Pydantic V2
- **Deep Learning:** PyTorch, Torchvision, Hugging Face Diffusers, Transformers, Accelerate
- **Computer Vision:** OpenCV (`opencv-python` 4.13), Pillow, NumPy, SciPy
- **3D Geometry & Meshing:** PyVista, Trimesh, PyMCubes (`mcubes`), NeRF Marching Cubes
- **Data Persistence:** SQLite3 (`furnforge.db`), disk cache in `backend/.hf_cache` and `backend/.torch_cache`

### Frontend
- **Framework:** React 19 (`^19.3.1`)
- **Build Tool:** Vite 8 (`^8.3.6`)
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`)
- **3D & XR Rendering:** Three.js, React Three Fiber (`@react-three/fiber`), Drei (`@react-three/drei`), WebXR Device API
- **Icons & Effects:** Lucide React, Canvas Confetti

---

## 📁 Repository Structure

```
FurnForge AI/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI REST endpoints & static mounting
│   │   ├── config.py                # Device detection, paths & model configs
│   │   ├── jobs.py                  # Background job manager & progress queue
│   │   ├── models/schemas.py        # Pydantic request/response schemas
│   │   ├── pipeline/
│   │   │   ├── cv_preprocessor.py   # OpenCV bilateral filter & Canny edge detector
│   │   │   ├── cnn_extractor.py     # ResNet-50 CNN topology & Grad-CAM
│   │   │   ├── prompt_builder.py    # Architectural PBR prompt compiler
│   │   │   ├── diffusion_engine.py  # Stable Diffusion 1.5 + ControlNet + LCM-LoRA
│   │   │   ├── mesh3d_engine.py     # TripoSR & Hunyuan3D 3D reconstruction coordinator
│   │   │   └── tsr/                 # TripoSR neural architecture & texture baking
│   │   └── database/db.py           # SQLite repository for design gallery persistence
│   ├── sample_sketches/             # Built-in presets (chair, sofa, table, desk, lamp)
│   ├── outputs/                     # Generated photoreal renders, edge maps & 3D GLB models
│   ├── tests/                       # Pytest test suite
│   ├── requirements.txt             # Python backend dependencies
│   └── .env.example                 # Environment configuration template
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Main coordinator component
│   │   ├── components/
│   │   │   ├── SketchCanvas.jsx     # Interactive whiteboard canvas (Pen, Eraser, Fullscreen)
│   │   │   ├── SketchUploader.jsx   # 3-way input mode tab switcher & OpenCV inspector
│   │   │   ├── CustomizerPanel.jsx  # PBR materials, palettes, styles & hyperparameter sliders
│   │   │   ├── ResultsViewer.jsx    # Live render showcase, variations & 3D button
│   │   │   ├── Model3DViewer.jsx    # Interactive Three.js orbit viewer
│   │   │   ├── AIInspectorModal.jsx # Internal CNN metrics & Grad-CAM visualizer
│   │   │   ├── Gallery.jsx          # Persistent SQLite design catalog
│   │   │   └── ar/WebXRARScene.jsx  # WebXR augmented reality real-room projection
│   │   ├── services/api.js          # REST API client
│   │   └── utils/presets.js         # Design tokens, materials & sample sketch metadata
│   ├── package.json                 # Frontend dependencies (React 19, Vite, Three.js)
│   └── vite.config.js               # Vite configuration
├── docs/                            # Implementation plans & technical notes
├── PROJECT_DOCUMENTATION.md         # Comprehensive engineering blueprint & math formulations
├── WORKFLOW_ARCHITECTURE.md         # End-to-end workflow pipeline & component architecture
├── LEARN.md                         # Deep learning & computer vision educational manual
├── run.bat                          # Windows one-click launcher
└── README.md                        # Master repository documentation
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18+)
- **Python** (v3.10+)

### Option A: One-Click Launch (Windows)
Double-click `run.bat` or run:
```bash
npm run dev
```
This automatically boots both the FastAPI backend on `http://localhost:8000` and the Vite frontend on `http://localhost:5173`.

---

### Option B: Manual Setup

#### 1. Backend Setup
```bash
cd backend
pip install -r requirements.txt

# Start backend server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Swagger API documentation is available at `http://localhost:8000/docs`.

#### 2. Frontend Setup
In a new terminal:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns server health, compute device (`cuda`/`cpu`), and pipeline status |
| `GET` | `/api/samples` | Lists built-in sample sketches for instant testing |
| `POST` | `/api/preprocess` | Runs real-time OpenCV Canny edge extraction & CNN analysis |
| `POST` | `/api/spec-render` | Instantly synthesizes photoreal material response for selected specs |
| `POST` | `/api/generate` | Queues full generative diffusion job (returns `job_id`) |
| `GET` | `/api/jobs/{job_id}` | Polls progress and retrieves completed render variations |
| `POST` | `/api/reconstruct-3d` | Generates 3D mesh (GLB/OBJ) from 2D render via TripoSR |
| `GET` | `/api/gallery` | Retrieves saved furniture designs from SQLite with category filters |
| `DELETE` | `/api/gallery/{id}` | Deletes design and associated 2D/3D assets |

---

## 📜 Documentation Links

- **[PROJECT_DOCUMENTATION.md](file:///d:/FurnForge%20AI/PROJECT_DOCUMENTATION.md):** Deep technical whitepaper, OpenCV formulations, Grad-CAM derivation, and performance benchmarks.
- **[WORKFLOW_ARCHITECTURE.md](file:///d:/FurnForge%20AI/WORKFLOW_ARCHITECTURE.md):** Detailed step-by-step workflow pipeline, dataflows, and component architecture.
- **[LEARN.md](file:///d:/FurnForge%20AI/LEARN.md):** Comprehensive learning manual covering computer vision, diffusion models, ControlNet zero-convolutions, and 3D neural reconstruction.

---

## 📜 License
MIT License • FurnForge AI Research Project
