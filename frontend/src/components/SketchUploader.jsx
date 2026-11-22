import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Image as ImageIcon,
  Trash2,
  Eye,
  Sliders,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Sparkles,
  PenTool,
  Layers,
  ArrowRight
} from 'lucide-react';
import { SAMPLE_SKETCHES } from '../utils/presets';
import { preprocessSketch } from '../services/api';
import SketchCanvas from './SketchCanvas';

export default function SketchUploader({
  selectedImage,
  setSelectedImage,
  selectedSampleId,
  setSelectedSampleId,
  preprocessedData,
  setPreprocessedData,
  lowThresh,
  setLowThresh,
  highThresh,
  setHighThresh,
  category,
  setCategory,
  onCustomImageUpload,
  onSelectSamplePreset
}) {
  // 3 Input Modes: 'presets' | 'upload' | 'draw'
  const [inputMode, setInputMode] = useState(() => (selectedSampleId ? 'presets' : 'upload'));
  const [sourceType, setSourceType] = useState(() => (selectedSampleId ? 'preset' : selectedImage ? 'upload' : 'preset'));
  const [dragOver, setDragOver] = useState(false);
  const [activeView, setActiveView] = useState('raw'); // 'raw', 'edge', 'cnn_heatmap', 'cleaned'
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);
  const shouldAutoSyncCategoryRef = useRef(false);

  // Keep sourceType in sync with preset selection
  useEffect(() => {
    if (selectedSampleId) {
      setSourceType('preset');
    }
  }, [selectedSampleId]);

  // Automatically trigger OpenCV preprocessing when image or thresholds change
  useEffect(() => {
    if (!selectedImage) {
      setPreprocessedData(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsProcessing(true);
        setErrorMsg('');
        const res = await preprocessSketch({
          image_base64: selectedImage,
          low_threshold: lowThresh,
          high_threshold: highThresh,
          blur_kernel: 3,
          method: 'canny'
        });
        setPreprocessedData(res);

        // Auto-align category to detected furniture category from CNN sketch analysis
        if (shouldAutoSyncCategoryRef.current && res?.cnn_features?.detected_category && setCategory) {
          setCategory(res.cnn_features.detected_category);
          shouldAutoSyncCategoryRef.current = false;
        }
      } catch (err) {
        console.error('OpenCV error:', err);
      } finally {
        setIsProcessing(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [selectedImage, lowThresh, highThresh]);

  const handleFileProcess = (file) => {
    setErrorMsg('');
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setErrorMsg('Unsupported format. Please upload PNG, JPG, or JPEG.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('File size exceeds 10MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      shouldAutoSyncCategoryRef.current = true;
      setSourceType('upload');
      if (onCustomImageUpload) {
        onCustomImageUpload(e.target.result);
      } else {
        setSelectedImage(e.target.result);
        setSelectedSampleId?.(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleSelectSample = (sample) => {
    setSourceType('preset');
    if (onSelectSamplePreset) {
      onSelectSamplePreset(sample);
    } else {
      setSelectedSampleId?.(sample.id);
      if (sample.category && setCategory) {
        setCategory(sample.category);
      }
      setSelectedImage(sample.url);
    }
  };

  // Called when user hits "Use as Furniture Sketch" on the interactive whiteboard
  const handleDrawingApplied = (base64DataUrl) => {
    shouldAutoSyncCategoryRef.current = true;
    setSourceType('draw');
    if (onCustomImageUpload) {
      onCustomImageUpload(base64DataUrl);
    } else {
      setSelectedImage(base64DataUrl);
      setSelectedSampleId?.(null);
    }
  };

  const handleClear = () => {
    setSelectedImage(null);
    setSelectedSampleId(null);
    setPreprocessedData(null);
    setSourceType(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Determine current display source based on active view toggle
  const cnnFeatures = preprocessedData?.cnn_features;
  const cnnHeatmap = preprocessedData?.cnn_heatmap_base64 || cnnFeatures?.b64_heatmap;
  const pixelMetrics = preprocessedData?.pixel_metrics || cnnFeatures?.pixel_metrics;

  let currentDisplay = selectedImage;
  if (activeView === 'edge' && preprocessedData?.edge_map_base64) {
    currentDisplay = preprocessedData.edge_map_base64;
  } else if (activeView === 'cnn_heatmap' && cnnHeatmap) {
    currentDisplay = cnnHeatmap;
  } else if (activeView === 'cleaned' && preprocessedData?.display_sketch_base64) {
    currentDisplay = preprocessedData.display_sketch_base64;
  }

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-[#E8E2D5] shadow-xs space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B5A2B]">
            Step 1 • Sketch Input
          </span>
          <h3 className="text-lg sm:text-xl font-bold text-[#1A1A1E]">Furniture Sketch Input</h3>
        </div>

        {selectedImage && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Input</span>
          </button>
        )}
      </div>

      {/* 3-Way Mode Tabs: Presets | Upload | Sketch */}
      <div className="grid grid-cols-3 bg-[#F4EFE6] p-1.5 rounded-2xl border border-[#E3D9C4] gap-1.5">
        {/* Option 1: Preset Sketches */}
        <button
          type="button"
          onClick={() => setInputMode('presets')}
          className={`py-2 px-2 sm:px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            inputMode === 'presets'
              ? 'bg-white text-[#5C3818] shadow-xs border border-[#DFD3BE]'
              : 'text-[#78716C] hover:text-[#1A1A1E] hover:bg-white/50'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#8B5A2B] shrink-0" />
          <span className="truncate">Sample Presets</span>
        </button>

        {/* Option 2: Upload File */}
        <button
          type="button"
          onClick={() => setInputMode('upload')}
          className={`py-2 px-2 sm:px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            inputMode === 'upload'
              ? 'bg-white text-[#5C3818] shadow-xs border border-[#DFD3BE]'
              : 'text-[#78716C] hover:text-[#1A1A1E] hover:bg-white/50'
          }`}
        >
          <UploadCloud className="w-3.5 h-3.5 text-[#8B5A2B] shrink-0" />
          <span className="truncate">Upload File</span>
        </button>

        {/* Option 3: Sketch Furniture Whiteboard */}
        <button
          type="button"
          onClick={() => setInputMode('draw')}
          className={`py-2 px-2 sm:px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all relative ${
            inputMode === 'draw'
              ? 'bg-[#8B5A2B] text-white shadow-xs'
              : 'text-[#78716C] hover:text-[#1A1A1E] hover:bg-white/50'
          }`}
        >
          <PenTool className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Sketch Furniture</span>
          <span className="hidden sm:inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse ml-0.5" />
        </button>
      </div>

      {/* Hidden File Input for Upload Option */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png, image/jpeg, image/jpg, image/webp"
        className="hidden"
        onChange={(e) => e.target.files && handleFileProcess(e.target.files[0])}
      />

      {/* Mode View 1: Preset Sketches */}
      {inputMode === 'presets' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs text-[#78716C]">
            <span className="font-semibold text-[#1A1A1E]">Select Curated Furniture Preset:</span>
            <span className="text-[11px]">Click any sample to load</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {SAMPLE_SKETCHES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSample(s)}
                className={`p-2 rounded-xl text-center border transition-all flex flex-col items-center gap-1.5 ${
                  selectedSampleId === s.id
                    ? 'border-[#8B5A2B] bg-[#8B5A2B]/10 text-[#5C3818] font-bold shadow-xs ring-1 ring-[#8B5A2B]/30'
                    : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#555] hover:border-[#8B5A2B]/50 hover:bg-white'
                }`}
              >
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-[#E8E2D5] p-1 flex items-center justify-center">
                  <img src={s.url} alt={s.name} className="w-full h-full object-contain" />
                </div>
                <span className="text-[11px] font-medium leading-tight truncate w-full">{s.category}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode View 2: Upload File */}
      {inputMode === 'upload' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
              dragOver
                ? 'border-[#8B5A2B] bg-[#8B5A2B]/5 scale-[0.99]'
                : 'border-[#D9D1C1] bg-[#FAF8F5] hover:border-[#8B5A2B] hover:bg-white'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-[#EAE2D2] flex items-center justify-center text-[#8B5A2B] shadow-inner">
              <UploadCloud className="w-6 h-6 stroke-[1.8]" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#1A1A1E]">
                Drop furniture sketch here, or <span className="text-[#8B5A2B] underline">browse files</span>
              </p>
              <p className="text-xs text-[#78716C]">
                Supports PNG, JPG, JPEG • Max 10MB • Clear pencil or pen lines recommended
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mode View 3: Sketch Furniture Whiteboard */}
      {inputMode === 'draw' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs text-[#78716C]">
            <span className="font-semibold text-[#1A1A1E] flex items-center gap-1.5">
              <PenTool className="w-3.5 h-3.5 text-[#8B5A2B]" />
              Interactive Whiteboard Studio:
            </span>
            <span className="text-[11px] text-[#8B5A2B] font-medium">Draw with pen & eraser</span>
          </div>

          <SketchCanvas
            onApplySketch={handleDrawingApplied}
            initialImage={sourceType === 'draw' ? selectedImage : null}
          />
        </div>
      )}

      {/* Active Source Pill Callout */}
      {selectedImage && (
        <div className="flex items-center justify-between bg-[#F7F4EE] border border-[#E6DFC9] px-3 py-2 rounded-xl text-xs text-[#5C3818]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-medium">
              Current Sketch Input:{' '}
              <strong className="text-[#1A1A1E]">
                {sourceType === 'draw'
                  ? 'Hand-Drawn Whiteboard Sketch'
                  : sourceType === 'upload'
                  ? 'Uploaded File'
                  : `Preset (${category || 'Sample'})`}
              </strong>
            </span>
          </div>

          {sourceType === 'draw' && inputMode !== 'draw' && (
            <button
              type="button"
              onClick={() => setInputMode('draw')}
              className="text-[#8B5A2B] hover:text-[#5C3818] font-bold flex items-center gap-1 underline underline-offset-2 transition-colors"
            >
              <span>Edit Drawing</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* OpenCV & CNN Edge Inspector & Live Preview (Visible when image is loaded) */}
      {selectedImage && (
        <div className="space-y-4 pt-1">
          {/* View Mode Toggle */}
          <div className="grid grid-cols-2 sm:grid-cols-4 bg-[#F5F2EB] p-1 rounded-xl text-xs gap-1">
            <button
              type="button"
              onClick={() => setActiveView('raw')}
              className={`py-2 sm:py-1.5 px-2 rounded-lg font-medium transition-all ${
                activeView === 'raw'
                  ? 'bg-white text-[#1A1A1E] shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              Raw Sketch
            </button>
            <button
              type="button"
              onClick={() => setActiveView('edge')}
              className={`py-2 sm:py-1.5 px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                activeView === 'edge'
                  ? 'bg-[#1A1A1E] text-white shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              <span className="truncate">ControlNet Map</span>
              {isProcessing && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('cnn_heatmap')}
              className={`py-2 sm:py-1.5 px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                activeView === 'cnn_heatmap'
                  ? 'bg-[#8B5A2B] text-white shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              <span className="truncate">CNN Pixel Scan</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('cleaned')}
              className={`py-2 sm:py-1.5 px-2 rounded-lg font-medium transition-all ${
                activeView === 'cleaned'
                  ? 'bg-white text-[#1A1A1E] shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              Lineart
            </button>
          </div>

          {/* Canvas View Container (Only show preview image if not currently drawing, to prevent redundancy) */}
          {inputMode !== 'draw' && (
            <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-[#E8E2D5] bg-[#FAF8F5] flex items-center justify-center p-2 shadow-inner">
              <img
                src={currentDisplay}
                alt="Furniture Sketch Input"
                className="max-h-full max-w-full object-contain transition-opacity duration-200"
              />

              {/* Stats Pill */}
              {activeView === 'cnn_heatmap' && pixelMetrics ? (
                <div className="absolute bottom-3 left-3 right-3 bg-[#1A1A1E]/85 backdrop-blur-md text-white text-[10px] px-3 py-1.5 rounded-lg flex flex-wrap items-center justify-center sm:justify-between gap-x-2 gap-y-0.5 shadow-lg">
                  <span>Dense Scan: <strong>{pixelMetrics.total_pixels_scanned?.toLocaleString()} px</strong></span>
                  <span>•</span>
                  <span>Coverage: <strong>{pixelMetrics.spatial_coverage_percent}%</strong></span>
                  <span>•</span>
                  <span>Peak: <strong>({pixelMetrics.peak_activation_coordinate?.x}, {pixelMetrics.peak_activation_coordinate?.y})</strong></span>
                </div>
              ) : preprocessedData ? (
                <div className="absolute bottom-3 left-3 bg-[#1A1A1E]/80 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-lg flex items-center gap-2">
                  <span>Density: <strong>{preprocessedData.edge_density_percent}%</strong></span>
                  <span>•</span>
                  <span>Contours: <strong>{preprocessedData.contour_count}</strong></span>
                </div>
              ) : null}
            </div>
          )}

          {/* Live ResNet-50 CNN Sketch Analysis Card */}
          {cnnFeatures && (
            <div className="bg-[#FAF8F5] p-3.5 rounded-xl border border-[#ECE6D8] space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-[#1A1A1E]">
                  <Sparkles className="w-3.5 h-3.5 text-[#8B5A2B]" />
                  <span>CNN Sketch Analysis:</span>
                  <span className="text-[#8B5A2B]">
                    {cnnFeatures.detected_category} ({Math.round((cnnFeatures.category_confidence || 0) * 100)}%)
                  </span>
                </div>
                {cnnFeatures.detected_category &&
                  cnnFeatures.detected_category !== category &&
                  setCategory && (
                    <button
                      type="button"
                      onClick={() => setCategory(cnnFeatures.detected_category)}
                      className="px-2 py-0.5 rounded-md bg-[#8B5A2B] hover:bg-[#724822] text-white text-[10px] font-semibold transition-colors"
                      title="Match category to CNN sketch analysis"
                    >
                      Use {cnnFeatures.detected_category}
                    </button>
                  )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#78716C]">
                <span>Symmetry: <strong className="text-[#1A1A1E]">{Math.round((cnnFeatures.symmetry_score || 0) * 100)}%</strong></span>
                <span>•</span>
                <span>Aspect: <strong className="text-[#1A1A1E]">{cnnFeatures.aspect_ratio}</strong></span>
                {cnnFeatures.structural_cue && (
                  <>
                    <span>•</span>
                    <span className="capitalize">{cnnFeatures.structural_cue}</span>
                  </>
                )}
              </div>
              {cnnFeatures.detected_accessories?.length > 0 && (
                <div className="text-[11px] text-[#5C3818] bg-[#8B5A2B]/10 px-2.5 py-1 rounded-lg">
                  Detected detail: <strong>{cnnFeatures.detected_accessories.join(', ')}</strong>
                </div>
              )}
            </div>
          )}

          {/* Category Alignment Warning Callout */}
          {cnnFeatures?.detected_category && cnnFeatures.detected_category !== category && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 text-xs animate-in fade-in">
              <div className="flex items-start sm:items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                <span>
                  Sketch matches <strong>{cnnFeatures.detected_category}</strong>, but studio is set to <strong>{category}</strong>. Align to prevent distorted hybrid renders.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCategory(cnnFeatures.detected_category)}
                className="self-start sm:self-auto px-2.5 py-1.5 sm:py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs whitespace-nowrap transition-colors shadow-xs"
              >
                Switch to {cnnFeatures.detected_category}
              </button>
            </div>
          )}

          {/* Real-time OpenCV Edge Sliders */}
          <div className="bg-[#FAF8F5] p-3.5 rounded-xl border border-[#ECE6D8] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-[#1A1A1E]">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#8B5A2B]" />
                OpenCV Canny Edge Thresholds
              </span>
              <span className="text-[11px] text-[#78716C] font-mono">[{lowThresh}, {highThresh}]</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-[#78716C] mb-1">
                  <span>Low Threshold</span>
                  <span className="font-mono">{lowThresh}</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="180"
                  value={lowThresh}
                  onChange={(e) => setLowThresh(parseInt(e.target.value))}
                  className="w-full accent-[#8B5A2B] h-1.5 bg-[#E0D7C6] rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-[#78716C] mb-1">
                  <span>High Threshold</span>
                  <span className="font-mono">{highThresh}</span>
                </div>
                <input
                  type="range"
                  min="120"
                  max="255"
                  value={highThresh}
                  onChange={(e) => setHighThresh(parseInt(e.target.value))}
                  className="w-full accent-[#8B5A2B] h-1.5 bg-[#E0D7C6] rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
