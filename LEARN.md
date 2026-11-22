# FurnForge AI — Deep Learning, Computer Vision & Generative AI Learning Manual 📚🧠

> **Target Audience:** Engineering Students, AI Researchers, Computer Vision Practitioners  
> **Course Topics Covered:** Classical Computer Vision, Convolutional Neural Networks, Latent Diffusion Models, Spatial Conditioning (ControlNet), Neural 3D Reconstruction, and WebXR Spatial Computing.

---

## Table of Contents
1. [Module 1: The Physics & Mathematics of Computer Vision Preprocessing](#module-1-the-physics--mathematics-of-computer-vision-preprocessing)
2. [Module 2: Convolutional Topology Analysis & Grad-CAM Explainability](#module-2-convolutional-topology-analysis--grad-cam-explainability)
3. [Module 3: Latent Diffusion Models & Consistency Acceleration](#module-3-latent-diffusion-models--consistency-acceleration)
4. [Module 4: Spatial ControlNet & Zero-Convolution Mechanics](#module-4-spatial-controlnet--zero-convolution-mechanics)
5. [Module 5: Single-View 3D Neural Reconstruction (TripoSR & Hunyuan3D)](#module-5-single-view-3d-neural-reconstruction-triposr--hunyuan3d)
6. [Module 6: High-Performance Canvas Engineering & Coordinate Geometry](#module-6-high-performance-canvas-engineering--coordinate-geometry)
7. [Module 7: Model Sourcing & Hugging Face Hub Integration](#module-7-model-sourcing--hugging-face-hub-integration)

---

## Module 1: The Physics & Mathematics of Computer Vision Preprocessing

### 1.1 Why Raw Sketches Break Generative Models
When a user takes a smartphone photo of a pencil sketch on a pad, the image does not simply contain black lines on white pixels. It contains:
1. **Paper grain & fiber texture:** Micro-variations in shading that naive neural networks interpret as textured fabric, noise, or speckled marble.
2. **Uneven lighting & shadows:** Ambient shadows cast by hands, phones, or desk lamps introduce low-frequency luminosity ramps.
3. **Rough pencil graphite reflections:** Pencil strokes are semi-reflective and vary in pressure, creating broken, fragmented edge maps.

### 1.2 Flat-Field Illumination Normalization
To eliminate lighting gradients across the sketch without altering pencil graphite lines, FurnForge AI executes flat-field background division:
$$\text{Background}(x, y) = \text{GaussianBlur}(I(x, y), k)$$
$$\text{Clean}(x, y) = \min\left(255, \frac{I(x, y)}{\text{Background}(x, y)} \times 255\right)$$
Where $k$ is an adaptive kernel size ($k = \max(31, \frac{\min(H, W)}{10} \mid 1)$). Dividing the image by its low-pass smoothed representation flattens uneven shadows into a uniform $255$ white field.

### 1.3 Bilateral Filtering vs. Gaussian Blur
Standard Gaussian smoothing blurs both noise and edges indiscriminately. The **Bilateral Filter** weights neighboring pixels by both geometric spatial closeness and photometric radiometric similarity:
$$I^{\text{filtered}}(p) = \frac{1}{W_p} \sum_{q \in \Omega} I(q) g_s(\|p - q\|) f_r(\|I(p) - I(q)\|)$$
- Spatial Kernel: $g_s(\|p - q\|) = \exp\left(-\frac{\|p - q\|^2}{2\sigma_s^2}\right)$
- Range Kernel: $f_r(\|I(p) - I(q)\|) = \exp\left(-\frac{\|I(p) - I(q)\|^2}{2\sigma_r^2}\right)$

When crossing from white paper to a dark pencil stroke, $\|I(p) - I(q)\|$ is large, causing $f_r \approx 0$. The filter refuses to smooth across the edge boundary, preserving pencil joinery while eliminating paper grain.

### 1.4 Canny Edge Detection & Hysteresis
1. **Gradient Computation:** Sobel filters compute horizontal $G_x$ and vertical $G_y$ derivatives:
   $$G = \sqrt{G_x^2 + G_y^2}, \quad \theta = \arctan\left(\frac{G_y}{G_x}\right)$$
2. **Non-Maximum Suppression:** Thins thick gradients into 1-pixel wide ridges by comparing each pixel against its neighbors along gradient direction $\theta$.
3. **Dual Hysteresis Thresholding:**
   - Pixels with $G \ge T_{\text{high}}$ are marked as strong edges.
   - Pixels with $T_{\text{low}} \le G < T_{\text{high}}$ are preserved only if connected to a strong edge.
   - Pixels with $G < T_{\text{low}}$ are suppressed as noise.

---

## Module 2: Convolutional Topology Analysis & Grad-CAM Explainability

### 2.1 ResNet-50 Deep Residual Architecture
Standard deep neural networks suffer from the **vanishing gradient problem** when layers multiply small gradients during backpropagation:
$$\frac{\partial \mathcal{L}}{\partial x_l} = \frac{\partial \mathcal{L}}{\partial x_L} \prod_{i=l}^{L-1} W_i$$
If $\|W_i\| < 1$, the gradient exponentially shrinks to zero. ResNet solves this by introducing **Identity Shortcut Connections**:
$$\mathbf{y} = \mathcal{F}(\mathbf{x}, \{W_i\}) + \mathbf{x}$$
The gradient becomes:
$$\frac{\partial \mathcal{L}}{\partial x_l} = \frac{\partial \mathcal{L}}{\partial x_L} \left(1 + \frac{\partial}{\partial x_l} \sum_{i=l}^{L-1} \mathcal{F}_i\right)$$
Even if the residual derivative approaches zero, the constant $1$ ensures gradients flow unimpeded directly back to the earliest layers.

### 2.2 Mathematical Hu Invariant Moments
To capture the geometric shape of the furniture sketch independent of its position, scale, or orientation, FurnForge AI extracts Hu's seven moment invariants:
$$\mu_{pq} = \sum_{x} \sum_{y} (x - \bar{x})^p (y - \bar{y})^q f(x, y)$$
Normalized central moments $\eta_{pq} = \frac{\mu_{pq}}{\mu_{00}^{\gamma}}$ where $\gamma = \frac{p + q}{2} + 1$.  
The first two Hu moments demonstrate key physical attributes:
$$h_1 = \eta_{20} + \eta_{02} \quad \text{(Overall spatial spread / moment of inertia)}$$
$$h_2 = (\eta_{20} - \eta_{02})^2 + 4\eta_{11}^2 \quad \text{(Eccentricity / elongation)}$$

### 2.3 Grad-CAM (Gradient-Weighted Class Activation Mapping)
To visually inspect which parts of the sketch influenced the CNN's classification, Grad-CAM calculates the gradient of class score $y^c$ with respect to feature activation maps $A^k$:
$$\alpha_k^c = \frac{1}{Z} \sum_{i=1}^{U} \sum_{j=1}^{V} \frac{\partial y^c}{\partial A_{i,j}^k}$$
A weighted combination of forward activation maps followed by a $\text{ReLU}$ non-linearity isolates the regions that positively contribute to category detection:
$$L_{\text{Grad-CAM}}^c = \text{ReLU}\left(\sum_k \alpha_k^c A^k\right)$$
This produces the 262,144-pixel thermal heatmap displayed in the studio's AI Inspector modal.

---

## Module 3: Latent Diffusion Models & Consistency Acceleration

### 3.1 Pixel Space vs. Latent Space Diffusion
High-resolution pixel space diffusion ($512\times 512\times 3 = 786,432$ variables) is computationally prohibitive on consumer hardware.  
Stable Diffusion utilizes a **Variational Autoencoder (VAE)**:
- **Encoder $\mathcal{E}$:** Compresses image $x \in \mathbb{R}^{H \times W \times 3}$ into latent vector $\mathbf{z} = \mathcal{E}(x) \in \mathbb{R}^{\frac{H}{8} \times \frac{W}{8} \times 4}$ (an $8\times$ spatial downsampling, or $64\times$ reduction in dimensional complexity).
- **Decoder $\mathcal{D}$:** Reconstructs latent representations back to pixel space: $\tilde{x} = \mathcal{D}(\mathbf{z})$.

### 3.2 The Forward & Reverse Diffusion Process
1. **Forward Process (Markov Chain):** Gradually adds Gaussian noise $\epsilon \sim \mathcal{N}(0, \mathbf{I})$ across timesteps $t \in [1, T]$:
   $$q(\mathbf{z}_t \mid \mathbf{z}_0) = \mathcal{N}\left(\mathbf{z}_t; \sqrt{\bar{\alpha}_t}\mathbf{z}_0, (1 - \bar{\alpha}_t)\mathbf{I}\right)$$
2. **Reverse Denoising:** A Time-Conditioned U-Net neural network $\epsilon_\theta(\mathbf{z}_t, t, c)$ is trained to predict the added noise vector:
   $$\mathcal{L}_{\text{diffusion}} = \mathbb{E}_{\mathbf{z}_0, \epsilon, t} \left[ \|\epsilon - \epsilon_\theta(\mathbf{z}_t, t, \tau_\theta(y))\|^2 \right]$$

### 3.3 Classifier-Free Guidance (CFG)
To enforce strict prompt following, Classifier-Free Guidance interpolates between conditional and unconditional score predictions:
$$\tilde{\epsilon}_\theta(\mathbf{z}_t, c) = \epsilon_\theta(\mathbf{z}_t, \emptyset) + s \cdot (\epsilon_\theta(\mathbf{z}_t, c) - \epsilon_\theta(\mathbf{z}_t, \emptyset))$$
Where $s$ is the guidance scale (FurnForge AI defaults to $s = 1.6 - 2.5$ for optimal material balance without oversaturation).

### 3.4 Consistency Distillation & LCM-LoRA
Standard diffusion requires 30 to 50 sequential denoising steps.  
**Latent Consistency Models (LCM)** parameterize the function to predict the solution of the probability flow ODE directly at $t = 0$:
$$f_\theta(\mathbf{z}_t, t) = \mathbf{z}_0$$
By loading **LCM-LoRA** (`latent-consistency/lcm-lora-sdv1-5`), low-rank adapter matrices are injected into the cross-attention blocks, allowing FurnForge AI to produce photorealistic results in just **4 to 8 steps**.

---

## Module 4: Spatial ControlNet & Zero-Convolution Mechanics

### 4.1 The Fundamental Flaw of Text-Only Prompts
A text prompt like *"a modern dining chair made of oak wood"* only provides semantic guidance; it contains no spatial coordinates. The model arbitrarily arranges legs, backrest height, and armrest angle.

### 4.2 ControlNet Zero-Convolution Architecture
ControlNet locks the original Stable Diffusion U-Net weights to preserve its generative power and creates a trainable cloned copy of the encoding layers.

```
       Input Latent x
             │
      ┌──────┴─────────────────────────────────┐
      │                                        │
      ▼ (Locked U-Net)                         ▼ (Trainable Cloned Block)
   [ U-Net Encoder ]                  Condition c ──► [ 1x1 Zero-Conv Z1 ]
      │                                                     │
      │                                                     ▼
      │                                            [ Cloned Encoder Block ]
      │                                                     │
      │                                                     ▼
      │                                            [ 1x1 Zero-Conv Z2 ]
      │                                                     │
      ▼                                                     ▼
      (+) ◄─────────────────────────────────────────────────┘
      │
      ▼
   [ Output ]
```

**Zero-Convolutions** are $1\times 1$ convolutional layers where both weights and biases are initialized to zero ($W = 0, b = 0$).  
Before training:
$$\mathcal{Z}(x; \{W, b\}) = 0 \cdot x + 0 = 0$$
Because the output is initially zero, no harmful gradients or noise disrupt the pre-trained diffusion model during the first training steps. The network progressively and smoothly learns how to condition geometry on the sketch.

---

## Module 5: Single-View 3D Neural Reconstruction (TripoSR & Hunyuan3D)

### 5.1 The Mathematical Challenge of Monocular 3D Synthesis
Creating a 3D mesh from a single 2D image is an ill-posed inverse problem: infinitely many 3D shapes can project to the exact same 2D camera view due to depth ambiguity and self-occlusion.

### 5.2 TripoSR Feed-Forward Architecture
**TripoSR** (`stabilityai/TripoSR`) solves this challenge using a vision transformer that outputs an explicit **Triplane Neural Representation**:
- Three orthogonal $2\text{D}$ planes ($XY, XZ, YZ$) encode spatial feature representations of the 3D volume.
- A coordinate $(x, y, z)$ is projected onto each plane, and bilinear interpolation samples the feature vectors.
- A lightweight MLP decodes features into continuous density $\sigma$ and color $c$:
  $$(\sigma, c) = \text{MLP}\left(\pi_{XY}(x,y) \oplus \pi_{XZ}(x,z) \oplus \pi_{YZ}(y,z)\right)$$

### 5.3 Marching Cubes Algorithmic Extraction
To extract a discrete polygon mesh from the continuous density field:
1. Space is discretized into an isotropic $160\times 160\times 160$ voxel grid.
2. For each voxel cell of 8 corner vertices, density values are evaluated against an isosurface threshold $\sigma_{\text{iso}}$.
3. Using an indexed lookup table of 256 topological configurations, triangles are generated intersecting the voxel edges, producing a watertight 3D manifold mesh.

### 5.4 UV Texture Projection & Atlas Baking
1. The 3D surface vertices are unwrapped into 2D UV coordinate space ($U, V \in [0, 1]$).
2. Camera view projection maps the high-resolution 2D synthetic render onto the surface facets.
3. An automated inpainting pass colors occluded back-faces with complementary wood/metal textures, producing a complete $1024\times 1024$ PNG texture atlas.

---

## Module 6: High-Performance Canvas Engineering & Coordinate Geometry

### 6.1 Subpixel Coordinate Mapping
In web browsers, CSS displays a canvas inside a layout box that may not equal the internal pixel buffer dimensions.  
To guarantee that the drawing pen is **exactly on the mouse pointer** without offset or lag:

```javascript
// Step 1: Scale internal buffer to device pixel ratio (DPR)
const rect = canvas.getBoundingClientRect();
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(rect.width * dpr);
canvas.height = Math.round(rect.height * dpr);

// Step 2: Scale 2D drawing context
ctx.scale(dpr, dpr);

// Step 3: Exact 1:1 mouse tracking
const x = event.clientX - rect.left;
const y = event.clientY - rect.top;
```
Because `ctx.scale(dpr, dpr)` is applied once during initialization, all drawing operations operate in pure screen CSS pixels. `(x, y)` corresponds to the exact physical mouse coordinate, achieving zero-drift drawing.

### 6.2 Stroke Bounding-Box Detection for 512×512 AI Export
When a user draws in full-screen mode on a widescreen monitor (e.g. $1920\times 1080$), directly downsampling the full screen would crush the furniture's aspect ratio.  
FurnForge AI executes an automated bounding box scan:
1. Reads canvas pixels via `ctx.getImageData(0, 0, W, H)`.
2. Finds minimum and maximum coordinates containing non-white stroke pixels: $[x_{\min}, y_{\min}, x_{\max}, y_{\max}]$.
3. Adds a $14\%$ proportional padding margin around the bounding box.
4. Centers and scales the resulting square crop into a $512\times 512$ export canvas.

### 6.3 Dedicated Eraser Physics & Dynamic Footprint Ring
1. **Dual Tool State Model:** Rather than coupling eraser thickness to pen stroke size, FurnForge AI maintains independent states (`penSize` $\in [2, 16]\text{px}$, `eraserSize` $\in [4, 80]\text{px}$). This prevents users from losing their preferred drawing line width when switching to a broad cleanup eraser.
2. **Subpixel Eraser Rendering:** The eraser paints with pure background white (`#FFFFFF`) using round caps and round joins, effectively resetting pixels to blank canvas without leaving boundary artifacts or jagged staircasing.
3. **Real-Time Visual Ring Indicator:** The floating marker cursor renders a dashed circular footprint with a translucent rose tint centered at $(x, y)$. The diameter dynamically scales with `eraserSize`, giving artists immediate visual clarity over the exact spatial area being cleared before clicking.
4. **Hotkeys Scaling Formula:** Stepped keyboard shortcuts (`[` and `]`) adjust radii via clamping functions:
   $$R_{\text{new}} = \text{clamp}(R_{\text{current}} \pm \Delta, R_{\min}, R_{\max})$$

---

## Module 7: Model Sourcing & Hugging Face Hub Integration

All neural network checkpoints utilized in FurnForge AI are sourced from verified open-source repositories on the Hugging Face Hub:

```
Hugging Face Hub Repository References:
├── stable-diffusion-v1-5/stable-diffusion-v1-5   (Base Generative Diffusion)
├── lllyasviel/control_v11p_sd15_canny            (Canny Edge Spatial Conditioning)
├── lllyasviel/control_v11p_sd15_scribble         (Freehand Sketch Spatial Conditioning)
├── latent-consistency/lcm-lora-sdv1-5            (Consistency Distillation LoRA)
├── stabilityai/TripoSR                           (Feed-Forward Fast 3D Mesh Engine)
└── tencent/Hunyuan3D-2mini                       (High-Precision 3D Diffusion Transformer)
```

### Automatic Cache Architecture
To prevent root partition exhaustion and keep the host system clean:
- All Hugging Face weight downloads are directed to `d:\FurnForge AI\backend\.hf_cache`.
- All PyTorch checkpoint downloads are directed to `d:\FurnForge AI\backend\.torch_cache`.
- Cached weights persist locally across sessions, enabling instant offline startup without re-downloading multi-gigabyte models.

