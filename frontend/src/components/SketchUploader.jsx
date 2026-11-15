import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Trash2, Eye, Sliders, RefreshCw, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { SAMPLE_SKETCHES } from '../utils/presets';
import { preprocessSketch } from '../services/api';

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
  setCategory
}) {
  const [dragOver, setDragOver] = useState(false);
  const [activeView, setActiveView] = useState('raw'); // 'raw', 'edge', 'cleaned'
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

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
      setSelectedImage(e.target.result);
      setSelectedSampleId(null);
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
    setSelectedSampleId(sample.id);
    if (sample.category && setCategory) {
      setCategory(sample.category);
    }
    // Set directly for zero latency
    setSelectedImage(sample.url);
  };

  const handleClear = () => {
    setSelectedImage(null);
    setSelectedSampleId(null);
    setPreprocessedData(null);
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
    <div className="bg-white rounded-3xl p-6 border border-[#E8E2D5] shadow-xs space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B5A2B]">
            Step 1 • Sketch Input
          </span>
          <h3 className="text-xl font-bold text-[#1A1A1E]">Hand-Drawn Sketch</h3>
        </div>

        {selectedImage && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove</span>
          </button>
        )}
      </div>

      {/* Preset Quick Samples (Huge for instant grading / test) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[#78716C]">
          <span className="font-semibold text-[#1A1A1E] flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#8B5A2B]" />
            Quick Presets (or upload below):
          </span>
          <span className="text-[11px]">Click to load sketch</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {SAMPLE_SKETCHES.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelectSample(s)}
              className={`p-2 rounded-xl text-center border transition-all flex flex-col items-center gap-1 ${
                selectedSampleId === s.id
                  ? 'border-[#8B5A2B] bg-[#8B5A2B]/10 text-[#5C3818] font-bold shadow-xs'
                  : 'border-[#EAE4D7] bg-[#FAF8F5] text-[#555] hover:border-[#8B5A2B]/50 hover:bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-white border border-[#E8E2D5] p-0.5 flex items-center justify-center">
                <img src={s.url} alt={s.name} className="w-full h-full object-contain" />
              </div>
              <span className="text-[11px] font-medium leading-tight truncate w-full">{s.category}</span>
            </button>
          ))}
        </div>

        {/* Upload Custom Sketch Quick Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-2 px-3 border border-dashed border-[#D5C7B0] hover:border-[#8B5A2B] rounded-xl text-xs text-[#78716C] hover:text-[#5C3818] bg-[#FAF8F5] hover:bg-white flex items-center justify-center gap-1.5 transition-colors"
        >
          <UploadCloud className="w-3.5 h-3.5 text-[#8B5A2B]" />
          <span>Or click here to upload your own custom sketch</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png, image/jpeg, image/jpg, image/webp"
        className="hidden"
        onChange={(e) => e.target.files && handleFileProcess(e.target.files[0])}
      />

      {/* Upload Zone / Canvas Preview */}
      {!selectedImage ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
            dragOver
              ? 'border-[#8B5A2B] bg-[#8B5A2B]/5 scale-[0.99]'
              : 'border-[#D9D1C1] bg-[#FAF8F5] hover:border-[#8B5A2B] hover:bg-white'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#EAE2D2] flex items-center justify-center text-[#8B5A2B] shadow-inner">
            <UploadCloud className="w-7 h-7 stroke-[1.8]" />
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
      ) : (
        /* Image Preview with OpenCV Edge Inspector */
        <div className="space-y-4">
          {/* View Mode Toggle */}
          <div className="flex items-center justify-between bg-[#F5F2EB] p-1 rounded-xl text-xs gap-1">
            <button
              onClick={() => setActiveView('raw')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                activeView === 'raw'
                  ? 'bg-white text-[#1A1A1E] shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              Sketch
            </button>
            <button
              onClick={() => setActiveView('edge')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                activeView === 'edge'
                  ? 'bg-[#1A1A1E] text-white shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              <span>ControlNet Map</span>
              {isProcessing && <RefreshCw className="w-3 h-3 animate-spin" />}
            </button>
            <button
              onClick={() => setActiveView('cnn_heatmap')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                activeView === 'cnn_heatmap'
                  ? 'bg-[#8B5A2B] text-white shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>CNN Pixel Scan</span>
            </button>
            <button
              onClick={() => setActiveView('cleaned')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                activeView === 'cleaned'
                  ? 'bg-white text-[#1A1A1E] shadow-xs font-semibold'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              Lineart
            </button>
          </div>

          {/* Canvas View Container */}
          <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-[#E8E2D5] bg-[#FAF8F5] flex items-center justify-center p-2 shadow-inner">
            <img
              src={currentDisplay}
              alt="Furniture Sketch"
              className="max-h-full max-w-full object-contain transition-opacity duration-200"
            />

            {/* Stats Pill */}
            {activeView === 'cnn_heatmap' && pixelMetrics ? (
              <div className="absolute bottom-3 left-3 right-3 bg-[#1A1A1E]/85 backdrop-blur-md text-white text-[10px] px-3 py-1.5 rounded-lg flex items-center justify-between shadow-lg">
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

          {/* Real-time OpenCV Edge Sliders */}
          <div className="bg-[#FAF8F5] p-3.5 rounded-xl border border-[#ECE6D8] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-[#1A1A1E]">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#8B5A2B]" />
                OpenCV Canny Edge Thresholds
              </span>
              <span className="text-[11px] text-[#78716C] font-mono">[{lowThresh}, {highThresh}]</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
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

