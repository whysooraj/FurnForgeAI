import React from 'react';
import { Sparkles, ArrowRight, Eye, Layers, ShieldCheck, Zap, Box, Compass } from 'lucide-react';
import BeforeAfterCompare from './BeforeAfterCompare';

export default function Hero({ onLaunchStudio, onExploreGallery, onSelectPreset }) {
  return (
    <section className="relative overflow-hidden pt-8 pb-16">
      {/* Background ambient lighting accents */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-[#E8DEC8]/40 to-transparent blur-3xl pointer-events-none -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        {/* Main Hero Header */}
        <div className="text-center max-w-3xl mx-auto space-y-6 pt-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EAE2D2] border border-[#D5C7B0] text-xs font-semibold text-[#5C3818] shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#8B5A2B]" />
            <span>Academic Generative AI Project • Stable Diffusion & ControlNet</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[#1A1A1E] tracking-tight leading-[1.15]">
            Turn Your Sketches Into <br />
            <span className="bg-gradient-to-r from-[#8B5A2B] via-[#B87D4B] to-[#5C3818] bg-clip-text text-transparent">
              Photorealistic Furniture
            </span>
          </h1>

          <p className="text-base sm:text-lg text-[#666] leading-relaxed max-w-2xl mx-auto">
            FurnForge AI transforms raw hand-drawn pencil drawings into showroom-ready furniture renders. 
            Select designer hardwoods, metals, leathers, and architectural styles with structure-preserving AI.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={onLaunchStudio}
              className="px-7 py-3.5 rounded-xl bg-[#8B5A2B] hover:bg-[#744820] text-white font-semibold text-sm tracking-wide flex items-center gap-2 shadow-lg shadow-[#8B5A2B]/25 hover:shadow-xl transition-all"
            >
              <span>Launch AI Studio</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onExploreGallery}
              className="px-6 py-3.5 rounded-xl bg-white hover:bg-[#F2ECE1] text-[#1A1A1E] font-semibold text-sm border border-[#E0D7C6] transition-all shadow-xs"
            >
              Explore Gallery
            </button>
          </div>

          {/* Quick Specs Badges */}
          <div className="flex flex-wrap items-center justify-center gap-6 pt-6 text-xs text-[#78716C]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>OpenCV Bilateral Edge Filter</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Pretrained CNN Topology</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#8B5A2B]" />
              <span>ControlNet Canny Structural Guidance</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span>Latent Diffusion Schedulers</span>
            </div>
          </div>
        </div>

        {/* Interactive Before & After Showcase */}
        <div>
          <BeforeAfterCompare onSelectPresetForStudio={onSelectPreset} />
        </div>

        {/* 5 Core AI Techniques Section */}
        <div className="space-y-8 pt-8">
          <div className="text-center space-y-2">
            <span className="text-xs uppercase font-bold tracking-widest text-[#8B5A2B]">
              Core AI Techniques
            </span>
            <h2 className="text-3xl font-bold text-[#1A1A1E]">
              Engineered with 5 Foundational Generative AI Pillars
            </h2>
            <p className="text-sm text-[#78716C] max-w-xl mx-auto">
              How FurnForge AI achieves high structural fidelity from pencil sketches without hallucinations.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* 1. Computer Vision (OpenCV) */}
            <div className="bg-white p-5 rounded-2xl border border-[#E8E2D5] shadow-xs space-y-3 hover:border-[#8B5A2B]/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] flex items-center justify-center text-[#8B5A2B]">
                <Eye className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-[#8B5A2B] uppercase tracking-wider block">
                01 • Vision Preprocessing
              </span>
              <h4 className="text-base font-bold text-[#1A1A1E]">Computer Vision (OpenCV)</h4>
              <p className="text-xs text-[#78716C] leading-relaxed">
                Decodes user sketches, runs bilateral filtering to eliminate paper textures, and extracts clean Canny edge maps with aspect-ratio preserved padding.
              </p>
            </div>

            {/* 2. CNN Feature Extraction */}
            <div className="bg-white p-5 rounded-2xl border border-[#E8E2D5] shadow-xs space-y-3 hover:border-[#8B5A2B]/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] flex items-center justify-center text-[#8B5A2B]">
                <Box className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-[#8B5A2B] uppercase tracking-wider block">
                02 • Deep Representation
              </span>
              <h4 className="text-base font-bold text-[#1A1A1E]">CNN Topology Extractor</h4>
              <p className="text-xs text-[#78716C] leading-relaxed">
                Evaluates furniture geometry, calculates lateral symmetry indices, contour density, and predicts category prior distributions (Chair, Sofa, Bed, Table, Cabinet).
              </p>
            </div>

            {/* 3. Diffusion Models */}
            <div className="bg-white p-5 rounded-2xl border border-[#E8E2D5] shadow-xs space-y-3 hover:border-[#8B5A2B]/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] flex items-center justify-center text-[#8B5A2B]">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-[#8B5A2B] uppercase tracking-wider block">
                03 • Latent Denoising
              </span>
              <h4 className="text-base font-bold text-[#1A1A1E]">Stable Diffusion</h4>
              <p className="text-xs text-[#78716C] leading-relaxed">
                Applies iterative latent reverse-diffusion steps to synthesize raytraced studio illumination, organic wood fibers, specular highlights, and contact shadows.
              </p>
            </div>

            {/* 4. ControlNet */}
            <div className="bg-white p-5 rounded-2xl border border-[#E8E2D5] shadow-xs space-y-3 hover:border-[#8B5A2B]/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] flex items-center justify-center text-[#8B5A2B]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-[#8B5A2B] uppercase tracking-wider block">
                04 • Outline Locking
              </span>
              <h4 className="text-base font-bold text-[#1A1A1E]">ControlNet (Canny)</h4>
              <p className="text-xs text-[#78716C] leading-relaxed">
                Injects the preprocessed sketch edge maps directly into the U-Net skip-connections via zero-convolutions, preserving user proportions precisely.
              </p>
            </div>

            {/* 5. Image-to-Image Translation */}
            <div className="bg-white p-5 rounded-2xl border border-[#E8E2D5] shadow-xs space-y-3 hover:border-[#8B5A2B]/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#F0ECE1] flex items-center justify-center text-[#8B5A2B]">
                <Layers className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-[#8B5A2B] uppercase tracking-wider block">
                05 • Neural Translation
              </span>
              <h4 className="text-base font-bold text-[#1A1A1E]">Img2Img Translation</h4>
              <p className="text-xs text-[#78716C] leading-relaxed">
                Conditions cross-attention layers with material prompts (velvet, walnut, brass) to seamlessly translate lines into tangible physical materials.
              </p>
            </div>
          </div>
        </div>

        {/* Step-by-Step Workflow Walkthrough */}
        <div className="bg-[#F1ECE1] p-8 sm:p-10 rounded-3xl border border-[#E4DEC3] space-y-6">
          <div className="max-w-xl space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8B5A2B]">Simple 4-Step Process</span>
            <h3 className="text-2xl font-bold text-[#1A1A1E]">From Hand Drawing to Design Catalog</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2">
              <span className="text-2xl font-black text-[#8B5A2B]/30">01</span>
              <h5 className="font-bold text-sm text-[#1A1A1E]">Upload or Select Sketch</h5>
              <p className="text-xs text-[#666] leading-relaxed">
                Drop any hand-drawn pencil, pen, or digital tablet sketch in PNG or JPG format.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-2xl font-black text-[#8B5A2B]/30">02</span>
              <h5 className="font-bold text-sm text-[#1A1A1E]">Real-Time OpenCV Edges</h5>
              <p className="text-xs text-[#666] leading-relaxed">
                Preview the cleaned edge contour matrix with bilateral noise reduction and adjust Canny sliders.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-2xl font-black text-[#8B5A2B]/30">03</span>
              <h5 className="font-bold text-sm text-[#1A1A1E]">Curate Materials & Colors</h5>
              <p className="text-xs text-[#666] leading-relaxed">
                Select from hardwood timber, brushed brass, aniline leather, and modern minimalist styles.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-2xl font-black text-[#8B5A2B]/30">04</span>
              <h5 className="font-bold text-sm text-[#1A1A1E]">Generate & Download</h5>
              <p className="text-xs text-[#666] leading-relaxed">
                Synthesize photoreal furniture renders in seconds, compare variations, and export 8K designs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

