import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  PenTool,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Check,
  Maximize2,
  Minimize2,
  Grid,
  Sparkles,
  Download
} from 'lucide-react';

const PEN_SIZES = [
  { id: 'fine', label: 'Fine', value: 2 },
  { id: 'regular', label: 'Pen', value: 4 },
  { id: 'bold', label: 'Marker', value: 8 },
  { id: 'thick', label: 'Broad', value: 16 },
];

const ERASER_SIZES = [
  { id: 'precision', label: 'Fine', value: 8 },
  { id: 'medium', label: 'Medium', value: 20 },
  { id: 'large', label: 'Large', value: 38 },
  { id: 'wide', label: 'Wide', value: 68 },
];

const PALETTE = [
  { name: 'Ink Black', value: '#1A1A1E' },
  { name: 'Pencil Gray', value: '#4B5563' },
  { name: 'Walnut Sepia', value: '#5C3818' },
  { name: 'Architect Blue', value: '#1E40AF' },
];

const EXPORT_RESOLUTION = 512;
const MAX_HISTORY = 30;

export default function SketchCanvas({
  onApplySketch,
  initialImage = null,
  className = ''
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const markerRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const isInitializedRef = useRef(false);

  const [activeTool, setActiveTool] = useState('pen'); // 'pen' | 'eraser'
  const [strokeColor, setStrokeColor] = useState('#1A1A1E');
  const [penSize, setPenSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(20);
  const [showGrid, setShowGrid] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [appliedNotification, setAppliedNotification] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  // Snapshot canvas state for Undo / Redo
  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL('image/png');
      let newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      newHistory.push(dataUrl);
      if (newHistory.length > MAX_HISTORY) {
        newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
      }
      historyRef.current = newHistory;
      historyIndexRef.current = newHistory.length - 1;

      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(false);
      setHasDrawn(true);
    } catch (e) {
      console.warn('Canvas saveState error:', e);
    }
  }, []);

  // Restore canvas state from snapshot
  const restoreState = useCallback((index) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataUrl = historyRef.current[index];
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      historyIndexRef.current = index;
      setCanUndo(index > 0);
      setCanRedo(index < historyRef.current.length - 1);
    };
    img.src = dataUrl;
  }, []);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      restoreState(historyIndexRef.current - 1);
    }
  }, [restoreState]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      restoreState(historyIndexRef.current + 1);
    }
  }, [restoreState]);

  // Clear canvas back to pure white
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.restore();

    saveState();
  }, [saveState]);

  // Lock body scroll in fullscreen mode to eliminate scrollbars
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Sync canvas pixel resolution to 100% of display box (High-DPI 1:1 mouse tracking)
  const syncCanvasResolution = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      let prevData = null;
      if (isInitializedRef.current && canvas.width > 0 && canvas.height > 0) {
        try {
          prevData = canvas.toDataURL('image/png');
        } catch (_) {}
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, rect.width, rect.height);

        if (prevData) {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, rect.width, rect.height);
          };
          img.src = prevData;
        } else if (initialImage) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, 0, 0, rect.width, rect.height);
            saveState();
          };
          img.src = initialImage;
        } else {
          saveState();
        }
      }
      isInitializedRef.current = true;
    }
  }, [initialImage, saveState]);

  // Handle resizing and fullscreen layout transitions
  useEffect(() => {
    syncCanvasResolution();

    const raf = requestAnimationFrame(() => {
      syncCanvasResolution();
    });

    const handleResize = () => {
      requestAnimationFrame(() => syncCanvasResolution());
    };

    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
    };
  }, [syncCanvasResolution, isFullscreen]);

  // Listen for native escape key or browser fullscreen exit
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [isFullscreen]);

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, E, P, [, ], Esc)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 'e') {
        setActiveTool('eraser');
      } else if (e.key.toLowerCase() === 'p') {
        setActiveTool('pen');
      } else if (e.key === '[') {
        // Decrease tool size
        if (activeTool === 'eraser') {
          setEraserSize((s) => Math.max(4, s - 4));
        } else {
          setPenSize((s) => Math.max(1, s - 1));
        }
      } else if (e.key === ']') {
        // Increase tool size
        if (activeTool === 'eraser') {
          setEraserSize((s) => Math.min(80, s + 4));
        } else {
          setPenSize((s) => Math.min(24, s + 2));
        }
      } else if (e.key === 'Escape' && isFullscreen) {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, isFullscreen, activeTool]);

  // Toggle true entire-screen mode
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (_) {}
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (_) {}
    }
  };

  // 1:1 Pixel Coordinates relative to canvas (exact mouse pointer alignment)
  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Move visual drawing marker directly on top of mouse pointer
  const updateMarker = (e) => {
    if (!markerRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    markerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const handlePointerEnter = (e) => {
    setIsHovering(true);
    updateMarker(e);
  };

  const handlePointerLeave = () => {
    setIsHovering(false);
  };

  const currentSize = activeTool === 'eraser' ? eraserSize : penSize;
  const currentColor = activeTool === 'eraser' ? '#FFFFFF' : strokeColor;

  const startDrawing = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    isDrawingRef.current = true;
    const point = getCanvasPoint(e);
    lastPointRef.current = point;

    ctx.save();
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(point.x, point.y, currentSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    updateMarker(e);
  };

  const draw = (e) => {
    updateMarker(e);

    if (!isDrawingRef.current) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const point = getCanvasPoint(e);
    const lastPoint = lastPointRef.current || point;

    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();

    lastPointRef.current = point;
  };

  const stopDrawing = (e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas && e.pointerId !== undefined) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    saveState();
  };

  // Export clean 512x512 image centered and padded for OpenCV and ControlNet
  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasStrokes = false;

    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const d = imgData.data;
      for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
          const idx = (y * width + x) * 4;
          if (d[idx] < 240 || d[idx + 1] < 240 || d[idx + 2] < 240) {
            hasStrokes = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    } catch (_) {}

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = EXPORT_RESOLUTION;
    exportCanvas.height = EXPORT_RESOLUTION;
    const expCtx = exportCanvas.getContext('2d');

    expCtx.fillStyle = '#FFFFFF';
    expCtx.fillRect(0, 0, EXPORT_RESOLUTION, EXPORT_RESOLUTION);
    expCtx.imageSmoothingEnabled = true;
    expCtx.imageSmoothingQuality = 'high';

    if (!hasStrokes || maxX <= minX || maxY <= minY) {
      const scale = Math.min(EXPORT_RESOLUTION / width, EXPORT_RESOLUTION / height);
      const dw = width * scale;
      const dh = height * scale;
      expCtx.drawImage(canvas, (EXPORT_RESOLUTION - dw) / 2, (EXPORT_RESOLUTION - dh) / 2, dw, dh);
    } else {
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      const pad = Math.max(boxW, boxH) * 0.14;

      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(width - cropX, boxW + pad * 2);
      const cropH = Math.min(height - cropY, boxH + pad * 2);

      const scale = Math.min(460 / cropW, 460 / cropH);
      const dw = cropW * scale;
      const dh = cropH * scale;
      const dx = (EXPORT_RESOLUTION - dw) / 2;
      const dy = (EXPORT_RESOLUTION - dh) / 2;

      expCtx.drawImage(canvas, cropX, cropY, cropW, cropH, dx, dy, dw, dh);
    }

    const dataUrl = exportCanvas.toDataURL('image/png');

    setAppliedNotification(true);
    setTimeout(() => setAppliedNotification(false), 2500);

    if (onApplySketch) {
      onApplySketch(dataUrl);
    }

    if (isFullscreen) {
      toggleFullscreen();
    }
  };

  // Download raw sketch locally as PNG
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `furnforge_sketch_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Reusable unified toolbar controls (clean single line)
  const renderControls = () => (
    <div className="flex items-center gap-2 select-none">
      {/* Tool selector: Pen vs Eraser */}
      <div className="flex items-center gap-0.5 bg-white p-0.5 rounded-lg border border-[#D5C7B0]/70 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={() => setActiveTool('pen')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-semibold text-xs transition-all ${
            activeTool === 'pen'
              ? 'bg-[#8B5A2B] text-white shadow-xs'
              : 'text-[#5C3818] hover:bg-[#F2ECE1]'
          }`}
          title="Drawing Pen (P)"
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>Pen</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('eraser')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-semibold text-xs transition-all ${
            activeTool === 'eraser'
              ? 'bg-rose-700 text-white shadow-xs'
              : 'text-rose-800 hover:bg-rose-50'
          }`}
          title="Eraser (E)"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>Eraser</span>
        </button>
      </div>

      <div className="h-5 w-[1px] bg-[#D5C7B0] hidden sm:block shrink-0" />

      {/* Dynamic Sizing Controls: Pen vs Eraser */}
      {activeTool === 'pen' ? (
        <>
          {/* Pen Stroke Size Selector */}
          <div className="flex items-center gap-0.5 bg-white p-0.5 rounded-lg border border-[#D5C7B0]/70 shadow-2xs shrink-0">
            <span className="text-[10px] uppercase font-bold text-[#8B5A2B] px-1.5 hidden md:inline">Pen:</span>
            {PEN_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPenSize(s.value)}
                className={`flex items-center justify-center px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  penSize === s.value
                    ? 'bg-[#EAE2D2] text-[#5C3818] font-bold shadow-2xs'
                    : 'text-[#78716C] hover:bg-[#F9F7F4]'
                }`}
                title={`Pen ${s.label} (${s.value}px)`}
              >
                <span
                  className="rounded-full bg-current mr-1"
                  style={{ width: `${Math.min(s.value + 2, 8)}px`, height: `${Math.min(s.value + 2, 8)}px` }}
                />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="h-5 w-[1px] bg-[#D5C7B0] hidden sm:block shrink-0" />

          {/* Color Palette (Pen mode) */}
          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-[#D5C7B0]/70 shadow-2xs shrink-0">
            {PALETTE.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setStrokeColor(c.value)}
                className={`w-4.5 h-4.5 rounded-full border transition-transform ${
                  strokeColor === c.value
                    ? 'scale-115 border-[#8B5A2B] ring-2 ring-[#8B5A2B]/40'
                    : 'border-black/20 hover:scale-110'
                }`}
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
            <label className="relative cursor-pointer flex items-center justify-center w-4.5 h-4.5 rounded-full border border-dashed border-[#8B5A2B] hover:bg-[#FAF8F5]" title="Custom Color">
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="sr-only"
              />
              <span className="text-[9px] font-bold text-[#8B5A2B] leading-none">+</span>
            </label>
          </div>
        </>
      ) : (
        /* Dedicated Eraser Size Adjustment Panel */
        <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-rose-200/90 shadow-2xs shrink-0 animate-in fade-in duration-150">
          <span className="text-[10px] uppercase font-bold text-rose-700 px-1 hidden md:inline">Eraser:</span>
          
          {/* Eraser Quick Presets */}
          <div className="flex items-center gap-0.5">
            {ERASER_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setEraserSize(s.value)}
                className={`flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  eraserSize === s.value
                    ? 'bg-rose-100 text-rose-900 font-bold shadow-2xs ring-1 ring-rose-300'
                    : 'text-[#78716C] hover:bg-rose-50 hover:text-rose-700'
                }`}
                title={`Eraser ${s.label} (${s.value}px)`}
              >
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          {/* Precision Eraser Slider */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-rose-200">
            <input
              type="range"
              min="4"
              max="80"
              step="2"
              value={eraserSize}
              onChange={(e) => setEraserSize(Number(e.target.value))}
              className="w-16 sm:w-24 h-1.5 accent-rose-600 bg-rose-100 rounded-lg cursor-pointer"
              title={`Adjust eraser size: ${eraserSize}px`}
            />
            <span className="font-mono text-[10px] font-bold text-rose-700 w-8 text-right">
              {eraserSize}px
            </span>
          </div>
        </div>
      )}

      <div className="h-5 w-[1px] bg-[#D5C7B0] hidden sm:block shrink-0" />

      {/* History & Board Utilities */}
      <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-[#D5C7B0]/70 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          className="p-1.5 rounded-md text-[#5C3818] hover:bg-[#F2ECE1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          className="p-1.5 rounded-md text-[#5C3818] hover:bg-[#F2ECE1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 rounded-md transition-colors ${
            showGrid
              ? 'bg-[#EAE2D2] text-[#5C3818] font-bold'
              : 'text-[#78716C] hover:bg-[#F2ECE1]'
          }`}
          title="Toggle Reference Grid"
        >
          <Grid className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={clearCanvas}
          className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50 transition-colors"
          title="Clear Whiteboard"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  // Drawing Canvas Surface Component
  const renderCanvasSurface = (isFull = false) => (
    <div
      ref={containerRef}
      className={`relative bg-white select-none overflow-hidden ${
        isFull
          ? 'flex-1 w-full h-full'
          : 'aspect-square w-full max-w-[512px] mx-auto rounded-2xl border-2 border-[#D5C7B0] shadow-inner'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Optional Reference Grid Guide */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none opacity-25 z-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, #8B5A2B 1px, transparent 1px),
              linear-gradient(to bottom, #8B5A2B 1px, transparent 1px)
            `,
            backgroundSize: '32px 32px',
          }}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-[#8B5A2B]/40" />
          <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-[#8B5A2B]/40" />
        </div>
      )}

      {/* Real-time Drawing Marker Pointer (Fixed Nib Alignment at 0, 0) */}
      <div
        ref={markerRef}
        className="pointer-events-none absolute left-0 top-0 z-30 select-none"
        style={{
          display: isHovering ? 'block' : 'none',
          transform: 'translate3d(-100px, -100px, 0)',
          willChange: 'transform',
        }}
      >
        {/* Stroke / Eraser Diameter Circle (centered at 0, 0) */}
        <div
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border pointer-events-none flex items-center justify-center transition-all ${
            activeTool === 'eraser' ? 'border-dashed' : ''
          }`}
          style={{
            width: `${Math.max(currentSize, 4)}px`,
            height: `${Math.max(currentSize, 4)}px`,
            borderColor: activeTool === 'eraser' ? '#E11D48' : strokeColor,
            backgroundColor: activeTool === 'eraser' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(0, 0, 0, 0.04)',
          }}
        >
          {/* Center Precision Contact Dot */}
          <div
            className="w-1 h-1 rounded-full pointer-events-none"
            style={{ backgroundColor: activeTool === 'eraser' ? '#E11D48' : strokeColor }}
          />
        </div>

        {/* Marker Pen / Eraser Graphic whose tip touches (0, 0) directly */}
        {activeTool === 'pen' ? (
          <div
            className="absolute left-0 bottom-0 pointer-events-none drop-shadow-sm select-none"
            style={{
              transform: 'translate(1px, -1px)',
              transformOrigin: 'bottom left',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="overflow-visible">
              <polygon points="0,24 3,18 7,20" fill={strokeColor} />
              <polygon points="3,18 7,20 9,17 5,15" fill="#D4A373" />
              <polygon points="5,15 9,17 21,5 17,3" fill="#FAF8F5" stroke="#5C3818" strokeWidth="1.2" strokeLinejoin="round" />
              <polygon points="10,10 14,12 17,9 13,7" fill={strokeColor} />
              <polygon points="17,3 21,5 23,3 19,1" fill="#5C3818" />
            </svg>
          </div>
        ) : (
          <div
            className="absolute left-0 bottom-0 pointer-events-none drop-shadow-sm select-none"
            style={{
              transform: 'translate(1px, -1px)',
              transformOrigin: 'bottom left',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="8" width="14" height="10" rx="2" transform="rotate(-35 1 8)" fill="#FFE4E6" stroke="#E11D48" strokeWidth="1.5" />
            </svg>
          </div>
        )}
      </div>

      {/* HTML5 Canvas Surface */}
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className="w-full h-full block cursor-none relative z-10"
      />

      {/* Empty State Callout */}
      {!hasDrawn && (
        <div className="absolute top-4 left-4 right-4 pointer-events-none z-20 flex items-center justify-center">
          <span className="bg-[#1A1A1E]/80 backdrop-blur-md text-white text-[11px] px-3.5 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
            <PenTool className="w-3.5 h-3.5 text-[#D5A065]" />
            Draw your furniture sketch here (mouse, stylus, or touch)
          </span>
        </div>
      )}

      {/* Fullscreen Helper Footnote Banner */}
      {isFull && (
        <div className="absolute bottom-3 left-4 right-4 pointer-events-none z-20 flex items-center justify-between text-[11px] text-[#78716C] bg-white/80 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-[#EAE4D7] shadow-xs">
          <span>
            💡 <strong>Tip:</strong> Draw anywhere. Use <strong>[</strong> and <strong>]</strong> to resize pen/eraser. Automatically frames into 512×512 HD on apply.
          </span>
          <span className="hidden sm:inline font-mono text-[10px] text-[#8B5A2B]">
            Press <strong>ESC</strong> to exit fullscreen
          </span>
        </div>
      )}
    </div>
  );

  // TRUE FULLSCREEN: Entire Screen (Zero scrollbars, single clean header, full-bleed canvas)
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 w-full h-full bg-[#FAF7F2] flex flex-col overflow-hidden select-none animate-in fade-in">
        {/* Fullscreen Header: Clean single-row layout without line breaking */}
        <header className="h-14 px-4 bg-[#FAF7F2] border-b border-[#E3D9C4] flex items-center justify-between gap-3 shrink-0 shadow-2xs z-40 select-none">
          {/* Left Brand Badge */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-[#8B5A2B] text-white flex items-center justify-center font-bold shadow-xs">
              <PenTool className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B5A2B] leading-none block">
                FurnForge AI Studio
              </span>
              <h3 className="text-sm font-bold text-[#1A1A1E] leading-tight flex items-center gap-1.5">
                <span>Sketch Whiteboard</span>
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-[#EAE2D2] text-[#5C3818] hidden sm:inline">
                  Entire Screen
                </span>
              </h3>
            </div>
          </div>

          {/* Center Unified Tool Controls in ONE horizontal bar */}
          <div className="flex items-center gap-2 bg-[#F2EDE2] p-1 rounded-xl border border-[#DFD3BE] shadow-2xs overflow-x-auto no-scrollbar">
            {renderControls()}
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="hidden lg:flex px-3 py-1.5 rounded-xl bg-white hover:bg-[#FAF8F5] border border-[#D5C7B0] text-xs font-medium text-[#5C3818] items-center gap-1.5 transition-colors shadow-2xs"
              title="Download PNG to your computer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="px-4 sm:px-5 py-2 rounded-xl bg-[#8B5A2B] hover:bg-[#724822] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md hover:shadow-lg shadow-[#8B5A2B]/20"
            >
              {appliedNotification ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Applied!</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Use as Furniture Sketch</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white hover:bg-[#F2ECE1] border border-[#D5C7B0] text-xs font-semibold text-[#5C3818] shadow-2xs transition-colors"
              title="Exit Fullscreen (Esc)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </button>
          </div>
        </header>

        {/* Fullscreen Canvas Board (Fills 100% of remaining screen area) */}
        {renderCanvasSurface(true)}
      </div>
    );
  }

  // Normal Inline Studio View
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Top Toolbar */}
      <div className="bg-[#FAF7F2] border border-[#E3D9C4] p-2 sm:p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 shadow-2xs">
        <div className="overflow-x-auto no-scrollbar py-0.5">
          {renderControls()}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-1.5 rounded-lg bg-white border border-[#E2D9C4] text-[#5C3818] hover:bg-[#F2ECE1] shadow-2xs transition-colors shrink-0"
          title="Expand to Entire Screen Fullscreen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {renderCanvasSurface(false)}

      {/* Footer Submission Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
        <div className="flex items-center gap-2 text-xs text-[#78716C]">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Real-time Whiteboard Canvas (HD)</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="px-3 py-2 rounded-xl bg-white hover:bg-[#FAF8F5] border border-[#D5C7B0] text-xs font-medium text-[#5C3818] flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
            title="Download PNG to your computer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="flex-1 sm:flex-none px-5 py-2 rounded-xl bg-[#8B5A2B] hover:bg-[#724822] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md hover:shadow-lg shadow-[#8B5A2B]/20"
          >
            {appliedNotification ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                <span>Sketch Applied!</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Use as Furniture Sketch</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
