import React from 'react';
import { Armchair, Sparkles, Image as ImageIcon, BookOpen, Home } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, backendStatus, onOpenTechModal }) {
  const navigateTo = (tab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const engineLabel = backendStatus?.pipeline_mode
    ? backendStatus.pipeline_mode.includes('PyTorch')
      ? 'SD1.5 ControlNet'
      : 'Hybrid AI'
    : 'CV/CNN Active';

  return (
    <header className="sticky top-0 z-50 bg-[#F8F6F0]/95 backdrop-blur-md border-b border-[#E8E2D5] transition-all">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between gap-2">
        {/* Brand Logo */}
        <div
          onClick={() => navigateTo('home')}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group min-w-0"
        >
          <div className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#8B5A2B] to-[#5C3818] flex items-center justify-center text-white shadow-md shadow-[#8B5A2B]/20 group-hover:scale-105 transition-transform">
            <Armchair className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className="text-lg sm:text-xl font-bold tracking-tight text-[#1A1A1E] truncate">FurnForge</span>
              <span className="text-lg sm:text-xl font-light text-[#8B5A2B]">AI</span>
              <span className="hidden sm:inline-block text-[10px] uppercase font-semibold tracking-wider bg-[#8B5A2B]/10 text-[#8B5A2B] px-1.5 py-0.5 rounded ml-1">
                Studio
              </span>
            </div>
            <p className="hidden sm:block text-[11px] text-[#78716C] tracking-wide truncate">
              Sketch-to-Photoreal Furniture Renderer
            </p>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-[#F1ECE1] p-1.5 rounded-xl border border-[#E4DEC3]/60">
          <button
            onClick={() => navigateTo('home')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'home'
                ? 'bg-white text-[#1A1A1E] shadow-sm'
                : 'text-[#666] hover:text-[#1A1A1E] hover:bg-white/50'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => navigateTo('studio')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
              activeTab === 'studio'
                ? 'bg-[#8B5A2B] text-white shadow-sm shadow-[#8B5A2B]/30'
                : 'text-[#666] hover:text-[#1A1A1E] hover:bg-white/50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            AI Studio
          </button>
          <button
            onClick={() => navigateTo('gallery')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
              activeTab === 'gallery'
                ? 'bg-white text-[#1A1A1E] shadow-sm'
                : 'text-[#666] hover:text-[#1A1A1E] hover:bg-white/50'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Gallery
          </button>
        </nav>

        {/* Right Actions: Gallery Shortcut (mobile), Architecture Docs, Engine Status & Launch CTA */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Quick Gallery Shortcut on Mobile */}
          <button
            onClick={() => navigateTo('gallery')}
            className={`md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === 'gallery'
                ? 'bg-[#8B5A2B] text-white border-[#8B5A2B] shadow-xs'
                : 'bg-white text-[#1A1A1E] border-[#E0D7C6] hover:bg-[#F2ECE1]'
            }`}
            title="Open Furniture Gallery"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Gallery</span>
          </button>

          <button
            onClick={onOpenTechModal}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold text-[#5C3818] bg-[#EAE2D2] hover:bg-[#E0D5C1] border border-[#D5C7B0] transition-colors"
            title="Inspect 5 Core AI Techniques"
            aria-label="Inspect AI Architecture"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Architecture</span>
          </button>

          <div
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-white border border-[#E8E2D5] text-[11px] sm:text-xs font-medium text-[#444] shadow-xs"
            title={`Engine: ${engineLabel}`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="hidden lg:inline text-[#78716C]">Engine:</span>
            <span className="text-[#1A1A1E] font-semibold whitespace-nowrap hidden sm:inline">
              {engineLabel}
            </span>
            <span className="text-[#1A1A1E] font-semibold sm:hidden">AI</span>
          </div>

          <button
            onClick={() => navigateTo('studio')}
            className="hidden sm:flex items-center gap-2 bg-[#1A1A1E] hover:bg-[#2C2C32] text-white px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-sm hover:shadow"
          >
            Launch Studio
          </button>
        </div>
      </div>

      {/* Mobile Navigation Bar (Overview / AI Studio / Gallery) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden border-t border-[#E8E2D5]/80 bg-[#F8F6F0]/95 px-3 py-2"
      >
        <div className="grid grid-cols-3 gap-1 bg-[#F1ECE1] p-1 rounded-xl border border-[#E4DEC3]/60">
          <button
            onClick={() => navigateTo('home')}
            className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'home'
                ? 'bg-white text-[#1A1A1E] shadow-xs'
                : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>
          <button
            onClick={() => navigateTo('studio')}
            className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'studio'
                ? 'bg-[#8B5A2B] text-white shadow-xs shadow-[#8B5A2B]/30'
                : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Studio</span>
          </button>
          <button
            onClick={() => navigateTo('gallery')}
            className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'gallery'
                ? 'bg-white text-[#1A1A1E] shadow-xs'
                : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Gallery</span>
          </button>
        </div>
      </nav>
    </header>
  );
}

