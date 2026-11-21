import React from 'react';
import { X, BookOpen, Eye, Box, Sparkles, ShieldCheck, Layers, CheckCircle2 } from 'lucide-react';

export default function TechStackModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto border border-[#E8E2D5] shadow-2xl p-4 sm:p-8 space-y-6 sm:space-y-7">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#F0ECE1]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#8B5A2B]/10 text-[#8B5A2B] flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-[#1A1A1E]">AI Architecture & Technical Specifications</h3>
              <p className="text-xs text-[#78716C]">Generative AI Project Methodology & 5 Core Pillars</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F5F2EB] hover:bg-[#EAE4D7] flex items-center justify-center text-[#555] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Introduction */}
        <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#ECE6D8] text-xs text-[#555] leading-relaxed space-y-2">
          <p>
            <strong className="text-[#1A1A1E]">FurnForge AI</strong> is an end-to-end sketch-to-photoreal furniture synthesis engine. 
            Traditional text-to-image models fail on industrial product design because prompt conditioning alone cannot preserve geometric constraints (e.g. leg count, bevels, curvature). 
            FurnForge AI addresses this using a 5-pillar generative vision pipeline.
          </p>
        </div>

        {/* 5 Pillars Deep Dive */}
        <div className="space-y-6">
          {/* Pillar 1 */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] text-[#8B5A2B] flex items-center justify-center shrink-0">
              <Eye className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-[#1A1A1E]">1. Computer Vision (OpenCV) Preprocessing</h4>
              <p className="text-[#666] leading-relaxed">
                Uploaded sketches undergo <strong>bilateral filtering</strong> to smooth paper grain while retaining sharp edges. 
                Next, <strong>Canny edge detection</strong> computes gradient magnitudes G = √(G_x² + G_y²) and angles θ = arctan(G_y/G_x), followed by non-maximum suppression and hysteresis thresholding (T_low, T_high). 
                Images are padded to 512 × 512 with aspect-ratio preservation to prevent structural distortion.
              </p>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] text-[#8B5A2B] flex items-center justify-center shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-[#1A1A1E]">2. Convolutional Neural Networks (CNN) Topological Analysis</h4>
              <p className="text-[#666] leading-relaxed">
                A pretrained deep convolutional backbone (ResNet-18 / MobileNet) extracts dense spatial feature representations f ∈ ℝ⁵¹². 
                The pipeline computes lateral symmetry indices, aspect ratios, and Hu Moments to evaluate category probability distributions (Chair, Table, Sofa, Bed, Cabinet) and calibrate prompt weighting.
              </p>
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] text-[#8B5A2B] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-[#1A1A1E]">3. Latent Diffusion Models (Stable Diffusion)</h4>
              <p className="text-[#666] leading-relaxed">
                Operates in a compressed latent space via a Variational Autoencoder (VAE) encoder and decoder. 
                The reverse diffusion process progressively removes Gaussian noise ε_t ~ N(0, I) using a U-Net denoiser conditioned on text cross-attention embeddings, synthesizing physically based lighting and textures.
              </p>
            </div>
          </div>

          {/* Pillar 4 */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] text-[#8B5A2B] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-[#1A1A1E]">4. ControlNet Structural Outline Guidance</h4>
              <p className="text-[#666] leading-relaxed">
                ControlNet creates a trainable copy of the 12 encoding blocks and 1 middle block of Stable Diffusion. 
                Using <strong>zero-convolutions</strong> (initialized with weights and biases set to zero), it feeds the OpenCV Canny edge map directly into the intermediate layers, locking the exact hand-drawn silhouette without catastrophic forgetting.
              </p>
            </div>
          </div>

          {/* Pillar 5 */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] text-[#8B5A2B] flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-[#1A1A1E]">5. Image-to-Image Latent Translation</h4>
              <p className="text-[#666] leading-relaxed">
                Transforms pencil strokes into tactile materials (walnut grain, brushed brass, aniline leather) by injecting material tokens through cross-attention while maintaining structural boundary consistency.
              </p>
            </div>
          </div>
        </div>

        {/* Tech Stack Pills */}
        <div className="pt-2 border-t border-[#F0ECE1]">
          <span className="text-[11px] font-bold text-[#78716C] uppercase tracking-wider block mb-3">
            Implemented Tech Stack
          </span>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">Python 3.14</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">FastAPI</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">OpenCV 4.13</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">PyTorch & Torchvision</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">Hugging Face Diffusers</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">ControlNet Canny</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">SQLite Persistence</span>
            <span className="px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#ECE6D8] font-medium text-[#1A1A1E]">React 19 & Tailwind CSS</span>
          </div>
        </div>

        {/* Close */}
        <div>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-[#1A1A1E] hover:bg-[#2C2C32] text-white text-xs font-semibold tracking-wide transition-colors"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

