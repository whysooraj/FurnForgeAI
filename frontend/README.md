# FurnForge AI — Frontend Architecture & Component Documentation 🎨💻

> **Framework:** React 19 (`^19.3.1`)  
> **Build Tool:** Vite 8 (`^8.3.6`)  
> **Styling Engine:** Tailwind CSS v4 (`@tailwindcss/vite`)  
> **3D & Spatial Engine:** Three.js (`^0.187.0`), React Three Fiber (`^9.8.2`), Drei (`^10.7.9`), WebXR Device API  
> **Design Language:** Modern Luxury Architectural Neutral Palette (`#FAF7F2`, `#8B5A2B`, `#5C3818`, `#1A1A1E`)

---

## 1. Overview & Architecture

The FurnForge AI client is a high-performance, single-page web application engineered to coordinate three complex domain tasks:
1. **Multi-Modal Sketch Ingestion:** Providing users with curated library presets, file upload/drag-and-drop, and an interactive digital whiteboard drawing studio.
2. **Real-Time Generative Customization:** Interactively synthesizing PBR material responses, OpenCV Canny edge previews, and ResNet-50 CNN topological metrics.
3. **Immersive 3D & Spatial Visualization:** Rendering reconstructed watertight 3D meshes in a photorealistic Three.js studio environment and projecting models into physical spaces via WebXR Augmented Reality.

---

## 2. Component Hierarchy & Dataflow

```
App.jsx (Root Coordinator & State Store)
├── Navbar.jsx (Status Indicator, Mode Navigation, Gallery Counter)
├── Hero.jsx (Hero Showcase & Interactive Before-and-After Slider)
│   └── BeforeAfterCompare.jsx (Interactive Split Drag Slider)
├── Studio.jsx (Core Dual-Column Interactive Workspace)
│   ├── Left Column: Step 1 (Sketch Input) & Step 2 (Material Customizer)
│   │   ├── SketchUploader.jsx (3-Way Tab Switcher & OpenCV Canny Inspector)
│   │   │   └── SketchCanvas.jsx (High-DPI Drawing Whiteboard & Eraser Engine)
│   │   └── CustomizerPanel.jsx (PBR Materials, Palettes, Styles, Inference Sliders)
│   ├── Right Column: Step 3 (Live Photoreal Render & 3D Synthesis)
│   │   └── ResultsViewer.jsx (Reactive Render, Denoising Progress, Variations Carousel)
│   │       ├── Model3DViewer.jsx (Three.js WebGL Orbit Viewer)
│   │       └── ViewInRoomModal.jsx (Room Photo Projection & Mockups)
│   └── AIInspectorModal.jsx (ResNet-50 CNN Topology, Symmetry, Grad-CAM Heatmap)
├── Gallery.jsx (SQLite Persistent Design Catalog with Category Filtering)
├── ar/WebXRARScene.jsx (WebXR Device API Real-World Floor Plane Tracking)
├── TechStackModal.jsx (Academic Technical Specifications Blueprint)
└── Footer.jsx (Architectural Design Attribution)
```

---

## 3. Detailed Component Specifications

### 3.1 `SketchCanvas.jsx` (Interactive Digital Whiteboard)
A zero-dependency, high-performance HTML5 Canvas drawing engine tailored for furniture sketching:
- **Subpixel Coordinate Tracking:** Dynamically computes `devicePixelRatio` ($dpr$) and applies `ctx.scale(dpr, dpr)`, ensuring that 1 CSS pixel on screen equals 1 canvas pixel for zero coordinate drift or lag.
- **Drawing Marker Cursor:** Replaces the default crosshair with an SVG marker pen whose nib tip is anchored at `(0, 0)`, placing the sharp drawing tip directly beneath the mouse cursor.
- **Dedicated Eraser Sizing Panel:**
  - Independent `penSize` (2px, 4px, 8px, 16px) and `eraserSize` (4px to 80px) states.
  - Dedicated eraser quick presets: **Fine (8px)** for precision line cleanup, **Medium (20px)**, **Large (38px)**, and **Wide (68px)** for section wiping.
  - Smooth range slider with real-time numeric readout.
  - Dashed cursor preview ring with translucent rose fill showing the exact eraser boundary before clicking.
- **History Stack:** Supports up to 30 steps of Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) using high-speed PNG data snapshots.
- **Keyboard Shortcuts:** `P` (Pen), `E` (Eraser), `[` (Decrease size), `]` (Increase size), `Ctrl+Z` (Undo), `Ctrl+Y` (Redo), `Esc` (Exit fullscreen).
- **True Entire-Screen Fullscreen:** `fixed inset-0 w-full h-full` expansion without window scrollbars, with single-line unified toolbar.
- **Auto-Bounding 512×512 HD Export:** Scans pixel intensities, calculates the bounding box of the drawn furniture, adds a 14% breathing margin, and fits the asset centered into a 512×512 square canvas for ControlNet.

### 3.2 `SketchUploader.jsx` (Input Mode Coordinator)
Coordinates the 3 input options via a segmented tab bar:
1. `Sample Presets`: Curated sample library (Chair, Sofa, Table, Desk, Lamp).
2. `Upload File`: Drag-and-drop or file explorer upload (PNG, JPG, WebP up to 10MB).
3. `Sketch Furniture`: Mounts `SketchCanvas.jsx`.
- **OpenCV & CNN Preprocessor Inspector:** Provides real-time preview toggles:
  - `Raw Sketch`: The unmodified source image.
  - `ControlNet Map`: Live OpenCV Canny edge extraction with adjustable Low/High threshold sliders.
  - `CNN Pixel Scan`: ResNet-50 Grad-CAM attention heatmap.
  - `Lineart`: Cleaned structural wireframe.
- **Automatic Category Synchronization:** Listens to CNN classification scores; if a user draws a table while the studio is set to chair, an alignment banner prompts immediate synchronization.

### 3.3 `CustomizerPanel.jsx` (PBR Specification Engine)
- **Furniture Categories:** Chair, Sofa, Table, Desk, Lamp, Bed, Cabinet.
- **PBR Materials:** Hardwood Timber (Walnut, Oak, Teak, Ash), Metals (Brushed Brass, Matte Black Steel, Chrome), Leathers (Top-grain Aniline, Cognac, Saddle), Fabrics (Bouclé, Velvet, Linen), and Stone (Carrara Marble, Granite).
- **Color Palettes:** Curated architectural tones with hex code associations.
- **Architectural Styles:** Scandinavian Modern, Mid-Century Modern, Industrial Loft, Minimalist Japanese, Bauhaus.
- **Diffusion Hyperparameters:** Number of variations (1–4), Guidance Scale (1.0–4.0), ControlNet conditioning scale (0.1–1.0), LCM-LoRA inference steps (4–12), and Seed control.

### 3.4 `ResultsViewer.jsx` (Photoreal Showcase & 3D Trigger)
- **Reactive Specification Preview:** Triggers instant sub-second material synthesis upon selecting any dropdown option.
- **Denoising Progress Tracker:** Connects to FastAPI background jobs, polling progress and step counts.
- **Variation Carousel:** Multi-view variation selector with seed details and execution metrics.
- **Interactive Split Slider:** Seamlessly wipe between the original hand sketch and the photoreal render.
- **3D Generation Action:** Dispatches single-image 3D reconstruction requests to `/api/reconstruct-3d`.

### 3.5 `Model3DViewer.jsx` (Three.js WebGL Engine)
- Built using Three.js and `@react-three/fiber` with `@react-three/drei`.
- Loads and parses binary glTF (`.glb`) and Wavefront (`.obj` + `.mtl`) files.
- Renders three-point soft studio lighting, soft ambient occlusion contact shadows, and 360° orbital controls.
- Provides wireframe toggles, mesh polygon count metrics, and direct `.glb` export downloads.

### 3.6 `WebXRARScene.jsx` (Augmented Reality)
- Leverages the WebXR Device API for mobile and headset devices.
- Uses hit-test raycasting against physical floor planes to anchor the generated furniture model at true 1:1 metric scale in real rooms.

---

## 4. Frontend Directory Structure

```
frontend/
├── index.html               # HTML5 entrypoint with Google Fonts
├── package.json             # React 19, Vite, Three.js, Tailwind v4 dependencies
├── vite.config.js           # Vite plugin configuration
├── vercel.json              # Static deployment routing configuration
└── src/
    ├── main.jsx             # React DOM root mounting
    ├── App.jsx              # Main application orchestrator
    ├── App.css              # Global layout animations & transitions
    ├── index.css            # Tailwind CSS v4 directives & custom scrollbars
    ├── assets/              # Static vector illustrations & icons
    ├── components/          # Reusable UI & 3D components
    │   ├── Navbar.jsx
    │   ├── Hero.jsx
    │   ├── BeforeAfterCompare.jsx
    │   ├── Studio.jsx
    │   ├── SketchUploader.jsx
    │   ├── SketchCanvas.jsx
    │   ├── CustomizerPanel.jsx
    │   ├── ResultsViewer.jsx
    │   ├── Model3DViewer.jsx
    │   ├── AIInspectorModal.jsx
    │   ├── Gallery.jsx
    │   ├── TechStackModal.jsx
    │   ├── ViewInRoomModal.jsx
    │   ├── Footer.jsx
    │   └── ar/
    │       ├── PreviewARScene.jsx
    │       └── WebXRARScene.jsx
    ├── services/
    │   └── api.js           # Fetch API client connecting to FastAPI backend
    └── utils/
        ├── presets.js       # Design tokens, material properties, sample sketches
        ├── glbUtils.js      # Three.js geometry normalizers & mesh helpers
        └── webxrSupport.js  # Browser WebXR compatibility probe
```

---

## 5. Development & Build Scripts

```bash
# Install frontend dependencies
npm install

# Start Vite local development server (port 5173)
npm run dev

# Compile production bundle
npm run build

# Run Oxlint static analysis
npm run lint

# Preview production build locally
npm run preview
```
