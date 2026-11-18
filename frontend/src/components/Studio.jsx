import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import SketchUploader from './SketchUploader';
import CustomizerPanel from './CustomizerPanel';
import ResultsViewer from './ResultsViewer';
import AIInspectorModal from './AIInspectorModal';
import { generateFurniture, renderSpec, resolveAssetUrl, normalizeUrls } from '../services/api';
import { SAMPLE_SKETCHES } from '../utils/presets';

export default function Studio({ selectedPresetId }) {
  // Image & OpenCV states
  const initialPreset = selectedPresetId || 'chair';
  const [selectedImage, setSelectedImage] = useState(() => resolveAssetUrl(`/sample_sketches/${initialPreset}_sketch.png`));
  const [selectedSampleId, setSelectedSampleId] = useState(initialPreset);
  const [preprocessedData, setPreprocessedData] = useState(null);
  const [lowThresh, setLowThresh] = useState(100);
  const [highThresh, setHighThresh] = useState(200);

  // Customization parameters
  const [category, setCategory] = useState('Chair');
  const [material, setMaterial] = useState('Wood');
  const [color, setColor] = useState('Warm Walnut');
  const [style, setStyle] = useState('Modern');
  const [finish, setFinish] = useState('Matte');
  const [customPrompt, setCustomPrompt] = useState('');

  // Advanced Hyperparameters (calibrated for Scribble + LCM-LoRA studio quality)
  const [numVariations, setNumVariations] = useState(1);
  const [guidanceScale, setGuidanceScale] = useState(1.6);
  const [controlnetScale, setControlnetScale] = useState(0.70);
  const [steps, setSteps] = useState(6);
  const [seed, setSeed] = useState(null);

  // Results & Execution states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationJob, setGenerationJob] = useState(null);
  const [resultData, setResultData] = useState(() => normalizeUrls({
    id: 'spec_chair_wood_warm_walnut_modern_matte',
    category: 'Chair',
    material: 'Wood',
    color: 'Warm Walnut',
    style: 'Modern',
    finish: 'Matte',
    result_image_url: '/outputs/spec_chair_wood_warm_walnut_modern_matte.png',
    primary_image_url: '/outputs/spec_chair_wood_warm_walnut_modern_matte.png',
    original_image_url: '/sample_sketches/chair_sketch.png',
    preprocessed_edge_url: '/outputs/edge_chair.png',
    execution_time: 0.02,
    pipeline_mode: 'FurnForge Photoreal Studio Engine (BRDF Material Synthesis)',
    variations: [
      {
        variation_index: 0,
        image_url: '/outputs/spec_chair_wood_warm_walnut_modern_matte.png',
        style_variant: 'Photoreal Modern Wood (Matte)',
        seed: 42
      }
    ]
  }));
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Track if user explicitly uploaded an image from disk vs sample preset
  const isCustomUploadRef = useRef(false);

  // 1. Auto-initialize default sample sketch on mount so studio is never empty/dead
  useEffect(() => {
    if (!selectedPresetId) return;
    setSelectedSampleId(selectedPresetId);
    isCustomUploadRef.current = false;
    const preset = SAMPLE_SKETCHES.find((s) => s.id === selectedPresetId);
    if (preset && preset.category) {
      setCategory(preset.category);
    }
    setSelectedImage(`/sample_sketches/${selectedPresetId}_sketch.png`);
  }, [selectedPresetId]);

  // 2. Synchronize Category change with Sample Sketch if using presets
  const handleCategoryChange = (newCategory) => {
    setCategory(newCategory);
    if (!isCustomUploadRef.current) {
      const newSampleId = newCategory.toLowerCase();
      setSelectedSampleId(newSampleId);
      setSelectedImage(`/sample_sketches/${newSampleId}_sketch.png`);
    }
  };

  // 3. Reactive Specification Engine:
  // Whenever student selects ANY option (Category, Material, Color, Style, Finish):
  // Immediately render/synthesize the response image matching that exact selected option!
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const spec = await renderSpec({
          category,
          material,
          color,
          style,
          finish,
          custom_prompt: customPrompt
        });
        if (active) {
          setResultData((prev) => ({
            ...spec,
            original_image_url: selectedImage || resolveAssetUrl(`/sample_sketches/${category.toLowerCase()}_sketch.png`),
            preprocessed_edge_url: spec.preprocessed_edge_url || resolveAssetUrl(`/outputs/edge_${category.toLowerCase()}.png`),
            // Preserve CNN analysis if available
            cnn_features: spec.cnn_features || preprocessedData?.cnn_features || prev?.cnn_features || null
          }));
        }
      } catch (err) {
        console.warn('Reactive spec render error:', err);
      }
    }, 30);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [category, material, color, style, finish]);

  // Handle Full Deep Generative Diffusion (User clicks 'Forge Photoreal Furniture')
  const handleGenerate = async (overrides = null) => {
    const ov = overrides && !overrides.nativeEvent ? overrides : {};
    if (!selectedImage && !selectedSampleId) {
      setErrorMessage('Please upload a sketch or pick a sample preset.');
      return;
    }

    try {
      setIsGenerating(true);
      setErrorMessage('');
      setGenerationJob({ message: 'Submitting sketch to diffusion pipeline...', progress: 0.05 });

      const activeCategory = ov.category ?? category;
      const activeMaterial = ov.material ?? material;
      const activeColor = ov.color ?? color;
      const activeStyle = ov.style ?? style;
      const activeFinish = ov.finish ?? finish;
      const activeSeed = ov.seed !== undefined ? ov.seed : seed;

      const payload = {
        image_base64: selectedImage || null,
        sample_id: selectedSampleId || null,
        category: activeCategory,
        material: activeMaterial,
        color: activeColor,
        style: activeStyle,
        finish: activeFinish,
        custom_prompt: customPrompt,
        num_variations: numVariations,
        guidance_scale: guidanceScale,
        controlnet_conditioning_scale: controlnetScale,
        num_inference_steps: steps,
        fast: true,
        seed: activeSeed || undefined,
        low_threshold: lowThresh,
        high_threshold: highThresh
      };

      const response = await generateFurniture(payload, (job) => {
        setGenerationJob(job);
      });
      setResultData(response);

      // Trigger celebration
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#8B5A2B', '#D4A373', '#1A1A1E']
        });
      } catch (e) {
        // ignore
      }
    } catch (err) {
      console.error('Generation error:', err);
      setErrorMessage(err.message || 'Furniture generation failed. Check server logs.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    const newSeed = Math.floor(Math.random() * 900000) + 1000;
    setSeed(newSeed);
    handleGenerate({ seed: newSeed });
  };

  const handleQuickTweak = (newMat, newCol) => {
    const ov = {};
    if (newMat) {
      setMaterial(newMat);
      ov.material = newMat;
    }
    if (newCol) {
      setColor(newCol);
      ov.color = newCol;
    }
    handleGenerate(ov);
  };

  const handleCustomImageUpload = (imgData) => {
    isCustomUploadRef.current = true;
    setSelectedImage(imgData);
    setSelectedSampleId(null);
  };

  const handleSelectSamplePreset = (sample) => {
    isCustomUploadRef.current = false;
    setSelectedSampleId(sample.id);
    if (sample.category) {
      setCategory(sample.category);
    }
    setSelectedImage(sample.url || `/sample_sketches/${sample.id}_sketch.png`);
  };

  const handleModelUpdated = (genId, generatedModel) => {
    setResultData((prev) => (prev && prev.id === genId ? { ...prev, model_3d: generatedModel } : prev));
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Workspace Header */}
      <div className="border-b border-[#E8E2D5] pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B5A2B]">Interactive Workspace</span>
          <h2 className="text-3xl font-bold text-[#1A1A1E]">AI Furniture Studio</h2>
          <p className="text-xs text-[#78716C] mt-1">
            Real-time material & palette specification conditioned on OpenCV Canny and ControlNet geometric boundaries.
          </p>
        </div>

        {resultData && (
          <button
            onClick={() => setIsInspectorOpen(true)}
            className="self-start sm:self-auto px-4 py-2 rounded-xl bg-white hover:bg-[#F2ECE1] border border-[#D5C7B0] text-xs font-semibold text-[#5C3818] shadow-xs transition-colors"
          >
            Inspect AI Mechanics & Metrics
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}

      {/* Main Studio Grid: Side-by-Side Dual Column */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Sketch Input (Step 1) & Customizer Controls (Step 2) */}
        <div className="lg:col-span-6 space-y-6">
          <SketchUploader
            selectedImage={selectedImage}
            setSelectedImage={handleCustomImageUpload}
            selectedSampleId={selectedSampleId}
            setSelectedSampleId={setSelectedSampleId}
            onCustomImageUpload={handleCustomImageUpload}
            onSelectSamplePreset={handleSelectSamplePreset}
            preprocessedData={preprocessedData}
            setPreprocessedData={setPreprocessedData}
            lowThresh={lowThresh}
            setLowThresh={setLowThresh}
            highThresh={highThresh}
            setHighThresh={setHighThresh}
            category={category}
            setCategory={handleCategoryChange}
          />

          <CustomizerPanel
            category={category}
            setCategory={handleCategoryChange}
            material={material}
            setMaterial={setMaterial}
            color={color}
            setColor={setColor}
            style={style}
            setStyle={setStyle}
            finish={finish}
            setFinish={setFinish}
            customPrompt={customPrompt}
            setCustomPrompt={setCustomPrompt}
            numVariations={numVariations}
            setNumVariations={setNumVariations}
            guidanceScale={guidanceScale}
            setGuidanceScale={setGuidanceScale}
            controlnetScale={controlnetScale}
            setControlnetScale={setControlnetScale}
            steps={steps}
            setSteps={setSteps}
            seed={seed}
            setSeed={setSeed}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            hasImage={Boolean(selectedImage || selectedSampleId)}
          />
        </div>

        {/* Right Column: Live Photoreal Response (Step 3) - STICKY so it's always beside the options! */}
        <div className="lg:col-span-6 sticky top-20 self-start space-y-6">
          <ResultsViewer
            resultData={resultData}
            isGenerating={isGenerating}
            generationJob={generationJob}
            onRegenerate={handleRegenerate}
            onQuickTweak={handleQuickTweak}
            onOpenInspector={() => setIsInspectorOpen(true)}
            onModelUpdated={handleModelUpdated}
            rawSketchUrl={selectedImage}
          />
        </div>
      </div>

      {/* AI Inspector Modal */}
      <AIInspectorModal
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        data={resultData}
      />
    </section>
  );
}
