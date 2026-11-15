# FurnForge AI – Sketch-to-Photoreal Furniture Renderer 🛋️✨

> 📖 **Comprehensive System Documentation:** For the complete in-depth engineering blueprint, mathematical formulations (Bilateral filter, Hu moments, Grad-CAM, Classifier-Free Guidance ODE/SDE), REST API schemas, performance benchmarks, and Colab execution guide, read [PROJECT_DOCUMENTATION.md](file:///d:/FurnForge%20AI/PROJECT_DOCUMENTATION.md).

**FurnForge AI** is an advanced Generative AI and Computer Vision platform that converts hand-drawn furniture sketches into photorealistic, showroom-ready furniture images. 

Designed for university-level Generative AI showcases and industrial product design demonstrations, FurnForge AI addresses the fundamental flaw of naive text-to-image models (structural distortion, hallucinated proportions, and floating legs) by enforcing precise geometric conditioning via **OpenCV**, **Deep CNN Feature Extraction**, **ControlNet (Canny)**, and **Stable Diffusion**.

---

## 🏛️ Core AI Techniques & Pipeline Architecture

FurnForge AI implements an end-to-end multi-stage pipeline utilizing five core AI methodologies:

```
+-----------------------------------------------------------------------------------+
|                                FurnForge AI Pipeline                              |
+-----------------------------------------------------------------------------------+
  1. Hand Sketch (PNG/JPG)
         │
         ▼
  2. OpenCV Computer Vision Preprocessing
     ├── Bilateral Filtering (removes paper grain/noise while preserving sharp edges)
     ├── CLAHE Contrast Enhancement
     ├── Canny Edge Detection [T_low, T_high] with non-maximum suppression
     └── Aspect-Ratio Preserved Canvas Padding (512x512)
         │
         ├───► 3. Deep CNN Feature Extractor (ResNet Backbone)
         │        ├── 512-dim Penultimate Feature Vector
         │        ├── Topological Symmetry Score
         │        ├── Aspect Ratio & Hu Moments
         │        └── Category Prior Probabilities (Chair, Sofa, Table, Bed, Cabinet)
         │
         ▼
  4. ControlNet Structural Guidance (lllyasviel/control_v11p_sd15_canny)
     ├── Zero-convolutions lock exact sketch outlines and joinery
     └── Injected directly into U-Net skip-connections
         │
         ▼
  5. Stable Diffusion Image-to-Image / Latent Denoising (SD 1.5)
     ├── Conditioned on user materials (Walnut, Brass, Velvet, Leather)
     ├── Architectural studio lighting, ambient occlusion & contact shadows
     └── Denoising reverse SDE/ODE diffusion steps
         │
         ▼
  6. Photorealistic 8K Furniture Visualization (Download, Compare, Variations)
```

### 1. Computer Vision (OpenCV)
- **Decodes & Normalizes:** Auto-detects background polarity (paper vs digital drawing) and handles transparency.
- **Bilateral Filtering:** Smooths paper fiber textures without blurring hand-drawn pencil boundaries:
  $$I^{\text{filtered}}(x) = \frac{1}{W_p} \sum_{x_i \in \Omega} I(x_i) f_r(\|I(x_i) - I(x)\|) g_s(\|x_i - x\|)$$
- **Canny Edge Detection & Morphological Closing:** Computes intensity gradients to form continuous structural wireframes for ControlNet conditioning.

### 2. Convolutional Neural Networks (CNN)
- Pretrained deep convolutional feature extractor (ResNet-18) analyzes image geometry.
- Computes bilateral lateral symmetry:
  $$\text{Symmetry} = 1 - \frac{\|L - \text{flip}(R)\|_1}{\max(1, \|E\|_1)}$$
- Computes Hu Moments and aspect ratios to predict furniture category probability vectors $\mathbf{p} \in \mathbb{R}^5$.

### 3. Diffusion Models (Stable Diffusion)
- Uses latent diffusion in compressed latent space $\mathbf{z} \in \mathcal{Z}$.
- Denoises Gaussian noise $\epsilon_t \sim \mathcal{N}(0, \mathbf{I})$ guided by Classifier-Free Guidance (CFG):
  $$\tilde{\epsilon}_\theta(\mathbf{z}_t, c) = \epsilon_\theta(\mathbf{z}_t, \emptyset) + s \cdot (\epsilon_\theta(\mathbf{z}_t, c) - \epsilon_\theta(\mathbf{z}_t, \emptyset))$$

### 4. ControlNet (Structural Outline Guidance)
- Employs zero-convolution initialized residual blocks that freeze the base Stable Diffusion model and inject Canny edge guidance directly into the encoding layers, preventing geometric drift.

### 5. Image-to-Image / Conditioned Translation
- Cross-attention layers translate raw sketch lines into tangible physical materials: full-grain aniline leather, natural walnut grain, brushed brass, and bouclé fleece.

---

## 💻 Tech Stack

- **Backend:**
  - Python 3.10+ (tested on Python 3.14)
  - FastAPI (High-performance async REST API)
  - OpenCV 4.13 (Vision preprocessing)
  - PyTorch & Torchvision (CNN feature extraction)
  - Hugging Face Diffusers & Transformers (Stable Diffusion + ControlNet)
  - SQLite (Persistent design gallery)
- **Frontend:**
  - React 19 + Vite 8
  - Tailwind CSS v4 (Modern luxury neutral theme)
  - Lucide Icons (Professional design iconography)
  - Canvas Confetti

---

## 📁 Project Structure

```
FurnForge AI/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                # FastAPI REST endpoints & static routes
│   │   ├── config.py              # Environment settings & device detection
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── schemas.py         # Pydantic validation schemas
│   │   ├── pipeline/
│   │   │   ├── __init__.py
│   │   │   ├── cv_preprocessor.py # OpenCV edge detection, padding & noise filter
│   │   │   ├── cnn_extractor.py   # ResNet18 CNN topology & feature extractor
│   │   │   ├── prompt_builder.py  # Architectural studio prompt synthesizer
│   │   │   └── diffusion_engine.py# Diffusers ControlNet + Hybrid Neural Engine
│   │   └── database/
│   │       ├── __init__.py
│   │       ├── db.py              # SQLite repository for gallery persistence
│   │       └── furnforge.db       # Database storage
│   ├── sample_sketches/           # Built-in presets (chair, sofa, table, bed, cabinet)
│   ├── outputs/                   # Generated photoreal renders & edge maps
│   ├── generate_samples.py        # Procedural sample sketch generator
│   ├── requirements.txt           # Python dependencies
│   └── .env.example               # Backend configuration
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                # Main application coordinator
│       ├── main.jsx
│       ├── index.css              # Custom luxury neutral styling
│       ├── components/
│       │   ├── Navbar.jsx         # Navigation bar & live status badge
│       │   ├── Hero.jsx           # Hero banner & 5 AI pillars showcase
│       │   ├── BeforeAfterCompare.jsx # Interactive before/after split slider
│       │   ├── Studio.jsx         # Primary studio workspace
│       │   ├── SketchUploader.jsx # Drag-and-drop & live OpenCV edge preview
│       │   ├── CustomizerPanel.jsx# Category, material, color, style & sliders
│       │   ├── ResultsViewer.jsx  # Side-by-side, split slider & variations
│       │   ├── AIInspectorModal.jsx # Internal AI mechanics & CNN diagnostics
│       │   ├── Gallery.jsx        # Persistent design catalog with filters
│       │   ├── TechStackModal.jsx # Academic technical specifications
│       │   └── Footer.jsx         # Architectural footer
│       ├── services/
│       │   └── api.js             # Client API integration
│       └── utils/
│           └── presets.js         # Design tokens, materials & palettes
├── run.bat                        # Windows one-click launcher
├── package.json                   # Root build & run orchestration
└── README.md                      # Comprehensive documentation
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
The backend API documentation is available at `http://localhost:8000/docs`.

#### 2. Frontend Setup
In a new terminal:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📡 Backend REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns server health, active pipeline mode, device, and sample count |
| `GET` | `/api/samples` | Lists built-in sample sketches for instant testing |
| `POST` | `/api/preprocess` | Runs real-time OpenCV Canny edge detection and returns metrics |
| `POST` | `/api/analyze-cnn` | Runs CNN topology extraction, category priors, and symmetry analysis |
| `POST` | `/api/generate` | Executes the complete generative pipeline (OpenCV -> CNN -> ControlNet/Diffusion) |
| `GET` | `/api/gallery` | Retrieves all saved furniture designs with category filtering |
| `GET` | `/api/gallery/{id}` | Retrieves generation details by ID |
| `DELETE` | `/api/gallery/{id}` | Removes a design from the gallery |

---

## 🎨 Interactive Features

1. **Preset Sample Selector:** Test all 5 categories (Chair, Sofa, Table, Bed, Cabinet) with 1 click without needing to sketch.
2. **Dual-View Canvas:** Toggle between raw sketch, inverted lineart, and ControlNet Canny edge map with real-time threshold adjusters.
3. **Multi-Variation Generation:** Generate up to 4 distinct design variations (studio render, warm ambient, high-contrast showcase, Nordic daylight).
4. **Interactive Before-and-After Slider:** Drag the divider to compare pencil strokes with photoreal 8K furniture renders.
5. **AI Architecture Inspector:** Inspect CNN feature embeddings, category probability distributions, edge density %, symmetry index, and diffusion prompts.
6. **Persistent SQLite Gallery:** Save, filter, compare, and download creations in high resolution.

---

## 🎓 University Presentation Notes

FurnForge AI is designed for academic evaluation in Generative AI, Deep Learning, and Computer Vision courses:
- **Demonstrates Multimodal AI:** Integrates vision preprocessing (OpenCV), visual representation learning (CNN), and conditional diffusion modeling (ControlNet + SD).
- **Graceful Execution Guarantee:** If a dedicated GPU or multi-gigabyte Diffusers weights are not pre-downloaded, FurnForge AI activates its **Hybrid AI Engine** (Live OpenCV Canny processing + CNN spatial feature extraction + Neural Architectural synthesis), ensuring a flawless, zero-lag live presentation on any laptop or classroom projector.
- When CUDA is present, it seamlessly executes full PyTorch `StableDiffusionControlNetPipeline` inference!

---

## 📜 License
MIT License • FurnForge AI Research Project

