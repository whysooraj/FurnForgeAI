# Sketch Furniture (Interactive Whiteboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third interactive "Sketch the Furniture" image input option to FurnForge AI, allowing users to draw furniture directly onto a real-time digital whiteboard (with pen, eraser, brush sizes, colors, undo/redo, and full-screen expansion) and submit the drawing as the active sketch input for OpenCV preprocessing and photorealistic generative diffusion.

**Architecture:** A lightweight, zero-dependency HTML5 Canvas drawing engine (`SketchCanvas.jsx`) handles 60fps pointer events, high-DPI scaling, and stroke history. `SketchUploader.jsx` is updated with a 3-tab navigation header (`Presets`, `Upload Sketch`, `Sketch Furniture`) that passes the exported 512×512 PNG dataURL to the existing OpenCV Canny edge and ResNet-50 CNN analysis pipeline.

**Tech Stack:** React 19, HTML5 Canvas 2D API, Lucide React icons, Tailwind CSS 4, Vite.

## Global Constraints
- **CRITICAL:** Do NOT push or commit to GitHub (`donot push into github`).
- React 19 compatibility: Do not install external legacy sketch libraries from npm; rely on native HTML5 Canvas.
- Preserved Dimensions: Virtual canvas resolution must be 512×512 square to match ControlNet / Stable Diffusion pipeline natively.
- Seamless Integration: Drawn sketches must seamlessly trigger existing OpenCV preprocessor (`/api/preprocess`), edge map calculation, and studio diffusion generation.

---

### Task 1: Create `SketchCanvas.jsx` Component

**Files:**
- Create: `frontend/src/components/SketchCanvas.jsx`

**Interfaces:**
- Props:
  - `onApplySketch: (base64DataUrl: string) => void` (called when user clicks "Use This Sketch")
  - `initialImage?: string | null` (optional background or initial sketch to load onto canvas)
  - `onCloseFullscreen?: () => void`

**Features:**
- Tools:
  - Freehand Pen / Pencil with anti-aliasing and smooth path joining
  - Dedicated Eraser tool
- Configurations:
  - Stroke sizes: Fine (2px), Regular (4px), Bold (8px), Thick (16px)
  - Palette colors: Obsidian Black (`#1A1A1E`), Charcoal (`#4B5563`), Warm Walnut (`#5C3818`), Soft Graphite (`#9CA3AF`), custom color input
- Actions:
  - Undo & Redo with canvas snapshot history stack (up to 25 states)
  - Clear whiteboard (resets to pure white `#ffffff`)
  - Perspective / Grid guide toggle (subtle background grid that is NOT exported to the final image)
  - Expand to Fullscreen drawing studio modal
  - "Apply Sketch / Use as Input" primary button: extracts `canvas.toDataURL('image/png')` and invokes `onApplySketch(dataUrl)`

- [x] **Step 1: Implement `SketchCanvas.jsx`**
  Build the component with canvas ref, pointer down/move/up/leave events, touch handling, high-DPI scaling, history stack for undo/redo, and toolbar controls.
- [x] **Step 2: Add keyboard shortcuts**
  Support `Ctrl+Z` (Undo), `Ctrl+Y` or `Ctrl+Shift+Z` (Redo), and `E` (Eraser) / `P` (Pen).
- [x] **Step 3: Verification**
  Ensure clean React 19 compilation with no undefined hooks or missing dependencies.

---

### Task 2: Integrate 3 Input Modes into `SketchUploader.jsx`

**Files:**
- Modify: `frontend/src/components/SketchUploader.jsx`

**Interfaces:**
- Consumes:
  - `SketchCanvas` from `./SketchCanvas`
  - `onCustomImageUpload(base64)` callback from `Studio.jsx`
- Produces:
  - 3 input tabs in UI:
    1. `Quick Presets` (Sample sketches: Chair, Sofa, Table, Desk, Lamp)
    2. `Upload File` (Drag & drop or file explorer)
    3. `Sketch Furniture` (Interactive whiteboard)
  - Live feedback banner showing active input source ("Custom Drawing Active") with an "Edit in Whiteboard" shortcut button.

- [x] **Step 1: Add input mode state to `SketchUploader.jsx`**
  Add `inputMode` state (`'presets' | 'upload' | 'draw'`). Default to `'presets'` when a sample is selected, or `'draw'` if user clicks sketch.
- [x] **Step 2: Render mode selector tab bar**
  Design an accessible, responsive 3-tab pill switcher at the top of Step 1.
- [x] **Step 3: Wire `SketchCanvas` to `onCustomImageUpload`**
  When user finishes drawing and clicks "Apply Sketch", update `selectedImage` via `onCustomImageUpload(dataUrl)` and switch active view to display the sketch and its live OpenCV Canny / CNN analysis.
- [x] **Step 4: Provide "Redraw / Edit Sketch" button**
  When in preview mode with a drawn sketch, provide an "Edit / Redraw" button that returns to the whiteboard.

---

### Task 3: Build & End-to-End Verification

**Files:**
- Verify: `frontend/src/components/SketchCanvas.jsx`
- Verify: `frontend/src/components/SketchUploader.jsx`
- Verify: `frontend/src/components/Studio.jsx`

- [x] **Step 1: Run frontend build check**
  Run `npm run build` inside `frontend/` to confirm zero syntax, JSX, or bundling errors.
- [x] **Step 2: Verify drawing workflow and state handling**
  Verify canvas drawing, eraser, undo/redo, color change, grid toggle, and export.
- [x] **Step 3: Confirm no GitHub push was made**
  Verify git status remains local only.
