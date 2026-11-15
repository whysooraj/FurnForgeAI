import React from 'react';
import { Armchair, Sparkles, Layers, Image as ImageIcon, Cpu, BookOpen } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, backendStatus, onOpenTechModal }) {
  return (
    <header className="sticky top-0 z-50 bg-[#F8F6F0]/90 backdrop-blur-md border-b border-[#E8E2D5] transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        {/* Brand Logo */}
        <div 
          onClick={() => setActiveTab('home')}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#8B5A2B] to-[#5C3818] flex items-center justify-center text-white shadow-md shadow-[#8B5A2B]/20 group-hover:scale-105 transition-transform">
            <Armchair className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold tracking-tight text-[#1A1A1E]">FurnForge</span>
              <span className="text-xl font-light text-[#8B5A2B]">AI</span>
              <span className="text-[10px] uppercase font-semibold tracking-wider bg-[#8B5A2B]/10 text-[#8B5A2B] px-1.5 py-0.5 rounded ml-1">
                Studio
              </span>
            </div>
            <p className="text-[11px] text-[#78716C] tracking-wide">Sketch-to-Photoreal Furniture Renderer</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-[#F1ECE1] p-1.5 rounded-xl border border-[#E4DEC3]/60">
          <button
            onClick={() => setActiveTab('home')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'home'
                ? 'bg-white text-[#1A1A1E] shadow-sm'
                : 'text-[#666] hover:text-[#1A1A1E] hover:bg-white/50'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('studio')}
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
            onClick={() => setActiveTab('gallery')}
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

        {/* Status Indicator & Architecture Docs Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenTechModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#5C3818] bg-[#EAE2D2] hover:bg-[#E0D5C1] border border-[#D5C7B0] transition-colors"
            title="Inspect 5 Core AI Techniques"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Architecture</span>
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#E8E2D5] text-xs font-medium text-[#444] shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="hidden lg:inline text-[#78716C]">Engine:</span>
            <span className="text-[#1A1A1E] font-semibold">
              {backendStatus?.pipeline_mode ? (
                backendStatus.pipeline_mode.includes('PyTorch') ? 'SD1.5 ControlNet' : 'Hybrid AI'
              ) : 'CV/CNN Active'}
            </span>
          </div>

          <button
            onClick={() => setActiveTab('studio')}
            className="hidden sm:flex items-center gap-2 bg-[#1A1A1E] hover:bg-[#2C2C32] text-white px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-sm hover:shadow"
          >
            Launch Studio
          </button>
        </div>
      </div>
    </header>
  );
}

