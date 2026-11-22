import React, { useState } from 'react';
import { 
  Sparkles, SlidersHorizontal, ChevronDown, ChevronUp, Palette, 
  Layers, Paintbrush, Armchair, HelpCircle, Check
} from 'lucide-react';
import { CATEGORIES, MATERIALS, COLORS, STYLES, FINISHES } from '../utils/presets';

export default function CustomizerPanel({
  category,
  setCategory,
  material,
  setMaterial,
  color,
  setColor,
  style,
  setStyle,
  finish,
  setFinish,
  customPrompt,
  setCustomPrompt,
  numVariations,
  setNumVariations,
  guidanceScale,
  setGuidanceScale,
  controlnetScale,
  setControlnetScale,
  steps,
  setSteps,
  seed,
  setSeed,
  onGenerate,
  isGenerating,
  hasImage
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const currentColorHex = COLORS.find((c) => c.name === color)?.hex || '#8B5A2B';

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-7 border border-[#E8E2D5] shadow-xs space-y-6 sm:space-y-7">
      {/* Header with Live Active Specification Status */}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B5A2B]">
          Step 2 • Material & Style Customization
        </span>
        <h3 className="text-lg sm:text-xl font-bold text-[#1A1A1E]">Design Specification</h3>

        {/* Live Specification Pill */}
        <div className="mt-2.5 p-3 rounded-2xl bg-[#FAF8F5] border border-[#EAE4D7] flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#78716C] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Response Active:
          </span>
          <div className="flex flex-wrap items-center gap-1.5 font-bold text-[#1A1A1E]">
            <span className="px-2 py-0.5 rounded-lg bg-white border border-[#E0D7C6] text-[11px] shadow-2xs">
              {category}
            </span>
            <span className="text-[#8B5A2B]">•</span>
            <span className="px-2 py-0.5 rounded-lg bg-white border border-[#E0D7C6] text-[11px] shadow-2xs">
              {material}
            </span>
            <span className="text-[#8B5A2B]">•</span>
            <span className="px-2 py-0.5 rounded-lg bg-white border border-[#E0D7C6] text-[11px] shadow-2xs flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ backgroundColor: currentColorHex }} />
              {color}
            </span>
            <span className="text-[#8B5A2B]">•</span>
            <span className="px-2 py-0.5 rounded-lg bg-white border border-[#E0D7C6] text-[11px] shadow-2xs">
              {finish} ({style})
            </span>
          </div>
        </div>
      </div>

      {/* 1. Category Selection */}
      <div className="space-y-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Furniture Category</span>
          <span className="text-[11px] font-normal text-[#8B5A2B]">{category}</span>
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                category === cat.id
                  ? 'border-[#8B5A2B] bg-[#8B5A2B]/10 text-[#5C3818] font-bold shadow-xs'
                  : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#555] hover:border-[#8B5A2B]/40 hover:bg-white'
              }`}
            >
              <Armchair className={`w-4 h-4 ${category === cat.id ? 'text-[#8B5A2B]' : 'text-[#78716C]'}`} />
              <span className="text-xs">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Material Selection */}
      <div className="space-y-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Primary Material</span>
          <span className="text-[11px] font-normal text-[#8B5A2B]">{material}</span>
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {MATERIALS.map((mat) => {
            const isSel = material === mat.id;
            return (
              <button
                key={mat.id}
                onClick={() => setMaterial(mat.id)}
                title={mat.desc}
                className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1 ${
                  isSel
                    ? 'border-[#8B5A2B] bg-[#8B5A2B] text-white font-bold shadow-sm shadow-[#8B5A2B]/20'
                    : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#444] hover:border-[#8B5A2B]/40 hover:bg-white'
                }`}
              >
                <span className="text-xs font-semibold">{mat.name.split(' ')[0]}</span>
                <span className={`text-[10px] truncate w-full ${isSel ? 'text-white/80' : 'text-[#888]'}`}>
                  {mat.subtypes[0].split(' ')[1] || mat.subtypes[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Color Selection */}
      <div className="space-y-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Designer Palette</span>
          <span className="text-[11px] font-normal text-[#8B5A2B] flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ backgroundColor: currentColorHex }} />
            {color}
          </span>
        </label>
        <div className="grid grid-cols-6 sm:grid-cols-6 gap-2">
          {COLORS.map((c) => {
            const isSelected = color === c.name;
            return (
              <button
                key={c.name}
                onClick={() => setColor(c.name)}
                title={`${c.name} (${c.tag})`}
                className={`relative aspect-square rounded-xl transition-all p-1 flex items-center justify-center border ${
                  isSelected
                    ? 'border-[#1A1A1E] scale-105 shadow-md ring-2 ring-[#8B5A2B]'
                    : 'border-[#E2DBCF] hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
              >
                {isSelected && (
                  <Check className={`w-3.5 h-3.5 ${
                    ['White', 'Cream Boucle', 'Scandinavian Birch', 'Champagne Gold'].includes(c.name)
                      ? 'text-[#1A1A1E]'
                      : 'text-white'
                  }`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Design Style */}
      <div className="space-y-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Design Style</span>
          <span className="text-[11px] font-normal text-[#8B5A2B]">{style}</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STYLES.map((st) => (
            <button
              key={st.id}
              onClick={() => setStyle(st.id)}
              className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all text-center ${
                style === st.id
                  ? 'border-[#8B5A2B] bg-[#8B5A2B]/10 text-[#5C3818] font-bold shadow-xs'
                  : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#555] hover:border-[#8B5A2B]/40 hover:bg-white'
              }`}
            >
              {st.name}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Surface Finish */}
      <div className="space-y-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Surface Finish</span>
          <span className="text-[11px] font-normal text-[#8B5A2B]">{finish}</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FINISHES.map((f) => (
            <button
              key={f.id}
              onClick={() => setFinish(f.id)}
              className={`py-2 px-2.5 rounded-xl border text-xs font-medium transition-all text-center ${
                finish === f.id
                  ? 'border-[#8B5A2B] bg-[#1A1A1E] text-white font-bold shadow-xs'
                  : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#555] hover:border-[#8B5A2B]/40 hover:bg-white'
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* 6. Custom Prompt / Room Setting */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-[#555] flex items-center justify-between">
          <span>Additional Scene Details</span>
          <span className="text-[10px] text-[#888] font-normal">Optional</span>
        </label>
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="e.g. minimalist Copenhagen loft, soft morning sunlight, micro-cement flooring"
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#D9D1C1] bg-[#FAF8F5] text-xs text-[#1A1A1E] placeholder-[#999] focus:outline-none focus:border-[#8B5A2B] focus:bg-white transition-all"
        />
      </div>

      {/* 7. Advanced AI Hyperparameters Accordion */}
      <div className="border-t border-[#F0ECE1] pt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between text-xs font-semibold text-[#78716C] hover:text-[#1A1A1E] transition-colors py-1"
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#8B5A2B]" />
            Advanced Diffusion Parameters (ControlNet & Guidance)
          </span>
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showAdvanced && (
          <div className="mt-4 p-4 bg-[#FAF8F5] rounded-2xl border border-[#ECE6D8] space-y-4 text-xs">
            {/* Variations */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[#555]">
                <span>Variations to Forge</span>
                <span className="font-bold text-[#8B5A2B]">{numVariations}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setNumVariations(n)}
                    className={`py-1.5 rounded-lg border text-center font-medium ${
                      numVariations === n
                        ? 'border-[#8B5A2B] bg-white text-[#8B5A2B] font-bold shadow-xs'
                        : 'border-[#E0D7C6] bg-transparent text-[#666]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Guidance Scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-[#555]">
                <span>CFG Guidance Scale</span>
                <span className="font-mono">{guidanceScale}</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="15.0"
                step="0.2"
                value={guidanceScale}
                onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                className="w-full accent-[#8B5A2B] h-1.5 bg-[#E0D7C6] rounded-lg cursor-pointer"
              />
            </div>

            {/* ControlNet Conditioning Scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-[#555]">
                <span>ControlNet Weight (Structure Lock)</span>
                <span className="font-mono">{controlnetScale}</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="1.5"
                step="0.05"
                value={controlnetScale}
                onChange={(e) => setControlnetScale(parseFloat(e.target.value))}
                className="w-full accent-[#8B5A2B] h-1.5 bg-[#E0D7C6] rounded-lg cursor-pointer"
              />
            </div>

            {/* Steps & Seed */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[#666] block mb-1">Denoising Steps</span>
                <input
                  type="number"
                  min="4"
                  max="50"
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value) || 6)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#D9D1C1] bg-white font-mono text-xs"
                />
              </div>
              <div>
                <span className="text-[#666] block mb-1">Seed (0 = Random)</span>
                <input
                  type="number"
                  value={seed || ''}
                  placeholder="Random"
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#D9D1C1] bg-white font-mono text-xs"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Generate Button */}
      <div className="pt-2">
        <button
          onClick={onGenerate}
          disabled={!hasImage || isGenerating}
          className={`w-full py-4 rounded-2xl font-bold text-sm tracking-wide flex items-center justify-center gap-2.5 transition-all shadow-lg ${
            !hasImage
              ? 'bg-[#E5DFD3] text-[#9E978B] cursor-not-allowed shadow-none'
              : isGenerating
              ? 'bg-[#8B5A2B]/80 text-white cursor-wait animate-pulse'
              : 'bg-[#8B5A2B] hover:bg-[#724822] text-white shadow-[#8B5A2B]/30 hover:shadow-xl hover:scale-[1.01]'
          }`}
        >
          <Sparkles className="w-5 h-5 text-amber-200" />
          <span>
            {isGenerating ? 'Synthesizing Full Diffusion Iterations...' : 'Forge Deep Diffusion Render (Save to Gallery)'}
          </span>
        </button>

        {!hasImage && (
          <p className="text-center text-[11px] text-[#888] mt-2">
            Please draw a sketch, upload an image, or choose a preset on the left to begin generation.
          </p>
        )}
      </div>
    </div>
  );
}
