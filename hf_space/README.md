---
title: FurnForge AI Backend
emoji: 🛋️
colorFrom: yellow
colorTo: brown
sdk: docker
app_port: 8005
pinned: false
---

# FurnForge AI — Generative Vision & 3D Backend

FastAPI backend server for sketch-to-photoreal furniture rendering and watertight 3D digital asset generation.

- **Pipeline:** OpenCV Edge Clean -> ResNet-50 Topology -> Stable Diffusion 1.5 + ControlNet -> TripoSR 3D
- **REST Endpoints:** `/api/health`, `/api/samples`, `/api/preprocess`, `/api/generate`, `/api/3d/generate`
