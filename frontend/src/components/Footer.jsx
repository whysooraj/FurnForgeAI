import React from 'react';
import { Armchair, Sparkles, Heart } from 'lucide-react';

export default function Footer({ onOpenTechModal, setActiveTab }) {
  const navigateTo = (tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#FAF8F5] border-t border-[#E8E2D5] mt-12 sm:mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-6 sm:space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 sm:gap-6 pb-6 sm:pb-8 border-b border-[#EAE4D7]">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#8B5A2B] text-white flex items-center justify-center shrink-0">
              <Armchair className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-base text-[#1A1A1E]">FurnForge AI</span>
              <p className="text-xs text-[#78716C]">Sketch-to-Photoreal Furniture Renderer</p>
            </div>
          </div>

          {/* Quick Links */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 sm:gap-6 text-xs text-[#666]">
            <button onClick={() => navigateTo('home')} className="hover:text-[#1A1A1E] transition-colors">
              Home
            </button>
            <button onClick={() => navigateTo('studio')} className="hover:text-[#1A1A1E] transition-colors">
              AI Furniture Studio
            </button>
            <button onClick={() => navigateTo('gallery')} className="hover:text-[#1A1A1E] transition-colors">
              Catalog Gallery
            </button>
            <button onClick={onOpenTechModal} className="hover:text-[#8B5A2B] font-semibold transition-colors">
              5 AI Pillars & Architecture
            </button>
          </div>
        </div>

        {/* Bottom Credits & Academic Disclaimer */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 text-xs text-[#888]">
          <p>
            University Generative AI Project • Built with OpenCV 4, Pretrained CNN, PyTorch, ControlNet & Stable Diffusion.
          </p>
          <div className="flex items-center gap-1.5">
            <span>Crafted for high architectural fidelity</span>
            <span>•</span>
            <span className="text-[#8B5A2B] font-medium">FurnForge AI v1.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

