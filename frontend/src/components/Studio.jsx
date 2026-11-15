import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import SketchUploader from './SketchUploader';
import CustomizerPanel from './CustomizerPanel';
import ResultsViewer from './ResultsViewer';
import AIInspectorModal from './AIInspectorModal';
import { generateFurniture } from '../services/api';

export default function Studio({ selectedPresetId }) {
  // Image & OpenCV states
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedSampleId, setSelectedSampleId] = useState(selectedPresetId || null);
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
  const [resultData, setResultData] = useState(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Handle Generate Request (accepts explicit overrides so quick tweaks never read stale React state)
  const handleGenerate = async (overrides = null) => {
    const ov = overrides && !overrides.nativeEvent ? overrides : {};
    if (!selectedImage && !selectedSampleId) {
      setErrorMessage('Please upload a sketch or pick a sample preset.');
      return;
    }

    try {
      setIsGenerating(true);
      setErrorMessage('');
      setResultData(null);
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

      // Trigger subtle celebration
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#8B5A2B', '#D4A373', '#1A1A1E']
        });
      } catch (e) {
        // ignore if confetti fails
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

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Workspace Header */}
      <div className="border-b border-[#E8E2D5] pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B5A2B]">Interactive Workspace</span>
          <h2 className="text-3xl font-bold text-[#1A1A1E]">AI Furniture Studio</h2>
          <p className="text-xs text-[#78716C] mt-1">
            Conditioned generation pipeline preserving your hand-drawn outlines through OpenCV and ControlNet.
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

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Sketch Uploader & OpenCV Inspector (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <SketchUploader
            selectedImage={selectedImage}
            setSelectedImage={setSelectedImage}
            selectedSampleId={selectedSampleId}
            setSelectedSampleId={setSelectedSampleId}
            preprocessedData={preprocessedData}
            setPreprocessedData={setPreprocessedData}
            lowThresh={lowThresh}
            setLowThresh={setLowThresh}
            highThresh={highThresh}
            setHighThresh={setHighThresh}
            category={category}
            setCategory={setCategory}
          />
        </div>

        {/* Center/Right Column: Customizer & Results (7 cols) */}
        <div className="lg:col-span-7 space-y-8">
          {/* Customizer Controls */}
          <CustomizerPanel
            category={category}
            setCategory={setCategory}
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

          {/* Render Output / Results Viewer */}
          <ResultsViewer
            resultData={resultData}
            isGenerating={isGenerating}
            generationJob={generationJob}
            onRegenerate={handleRegenerate}
            onQuickTweak={handleQuickTweak}
            onOpenInspector={() => setIsInspectorOpen(true)}
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

