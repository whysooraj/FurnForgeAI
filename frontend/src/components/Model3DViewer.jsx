import React, { Suspense, Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html, OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  AlertTriangle,
  Box,
  Camera,
  Cpu,
  Download,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  generate3DModel,
  get3DDownloadUrl,
  get3DRequirements,
  get3DStatus,
} from '../services/api';
import { prepareGLBScene } from '../utils/glbUtils';
import ViewInRoomModal from './ViewInRoomModal';

const CAMERA_PRESETS = {
  reset: { label: 'Reset Camera', position: [1.75, 1.15, 2.05] },
  front: { label: 'Front', position: [0, 0.75, 2.55] },
  back: { label: 'Back', position: [0, 0.75, -2.55] },
  side: { label: 'Side', position: [2.55, 0.75, 0] },
  top: { label: 'Top', position: [0, 2.75, 0.01] },
};

class ViewportErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Failed to load 3D mesh asset.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-[380px] flex flex-col items-center justify-center p-6 text-center bg-rose-50/60 border border-rose-200 rounded-2xl space-y-2">
          <AlertTriangle className="w-7 h-7 text-rose-600" />
          <p className="text-xs font-bold text-rose-900">Unable to render 3D GLB asset</p>
          <p className="text-[11px] text-rose-700 max-w-md">{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadedGLBModel({ url }) {
  const gltf = useLoader(GLTFLoader, url);

  const normalizedScene = useMemo(() => {
    return prepareGLBScene(gltf.scene, { targetMaxDim: 1.55 }).scene;
  }, [gltf]);

  return <primitive object={normalizedScene} />;
}

function CameraRig({ cameraCommand }) {
  const { camera } = useThree();
  const controlsRef = useRef(null);

  useEffect(() => {
    if (!cameraCommand) return;
    const preset = CAMERA_PRESETS[cameraCommand.preset] || CAMERA_PRESETS.reset;
    camera.position.set(...preset.position);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0.45, 0);
      controlsRef.current.update();
    } else {
      camera.lookAt(0, 0.45, 0);
    }
  }, [camera, cameraCommand]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 0.45, 0]}
      enableDamping
      dampingFactor={0.08}
      enableZoom
      enablePan
      minDistance={0.65}
      maxDistance={6.0}
    />
  );
}

export default function Model3DViewer({ item, onModelUpdated, autoStartTrigger = 0, onViewInRoom }) {
  const [model3d, setModel3d] = useState(item?.model_3d || null);
  const [isRoomViewOpen, setIsRoomViewOpen] = useState(false);
  const [compatibility, setCompatibility] = useState(null);
  const [modelPreference, setModelPreference] = useState('auto');
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobState, setJobState] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [cameraCommand, setCameraCommand] = useState({ preset: 'reset', tick: 0 });
  const lastAutoTriggerRef = useRef(0);
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    if (!isGenerating) return undefined;
    const startMs = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(((Date.now() - startMs) / 1000).toFixed(1));
    }, 250);
    return () => clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    setModel3d(item?.model_3d || null);
  }, [item?.id, item?.model_3d]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadMeta() {
      try {
        const reqs = await get3DRequirements();
        if (!controller.signal.aborted) setCompatibility(reqs);
      } catch {
        // Handled when user triggers generation or backend is offline
      }

      if (item?.id) {
        try {
          const statusRes = await get3DStatus(item.id);
          if (!controller.signal.aborted) {
            if (statusRes.model_3d) setModel3d(statusRes.model_3d);
            if (statusRes.compatibility) setCompatibility(statusRes.compatibility);
          }
        } catch {
          // Item might not exist in DB if unsaved
        }
      }
    }
    loadMeta();
    return () => controller.abort();
  }, [item?.id]);

  const handleGenerate3D = useCallback(async () => {
    if (isGeneratingRef.current) return;
    if (!item?.id || !item?.result_image_url) {
      setErrorMsg('No generated photorealistic 2D render is available for this design.');
      return;
    }

    try {
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setElapsedSeconds('0.0');
      setErrorMsg('');
      setJobState({
        progress: 0.05,
        message: 'Starting TripoSR 3D reconstruction from photoreal render...',
      });

      const response = await generate3DModel(
        {
          generation_id: item.id,
          image_url: item.result_image_url,
          model_preference: modelPreference,
        },
        (job) => setJobState(job)
      );

      const generated = response?.model_3d || response;
      setModel3d(generated);
      setCameraCommand({ preset: 'reset', tick: Date.now() });
      if (onModelUpdated) {
        onModelUpdated(item.id, generated);
      }
    } catch (err) {
      setErrorMsg(err.message || '3D mesh reconstruction failed.');
      if (err.compatibility) {
        setCompatibility(err.compatibility);
      }
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }, [item?.id, item?.result_image_url, modelPreference, onModelUpdated]);

  useEffect(() => {
    if (
      autoStartTrigger > 0 &&
      autoStartTrigger !== lastAutoTriggerRef.current &&
      !model3d?.glb_url &&
      !isGeneratingRef.current
    ) {
      lastAutoTriggerRef.current = autoStartTrigger;
      handleGenerate3D();
    }
  }, [autoStartTrigger, model3d?.glb_url, handleGenerate3D]);

  const triggerCamera = (preset) => {
    setCameraCommand({ preset, tick: Date.now() });
  };

  const handleExportDownload = (fmt) => {
    if (!item?.id) return;
    const url = fmt === 'glb' && model3d?.glb_url
      ? model3d.glb_url
      : get3DDownloadUrl(item.id, fmt);
    const link = document.createElement('a');
    link.href = url;
    link.download = `furnforge-${item.category?.toLowerCase() || 'asset'}-${item.id}.${fmt}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const progressPct = jobState ? Math.round((jobState.progress || 0) * 100) : 0;
  const hasReadyModel = Boolean(model3d?.glb_url);
  const supportedFormats = model3d?.supported_formats || [];
  const primaryReady = Boolean(compatibility?.primary?.available);
  const fallbackReady = Boolean(compatibility?.fallback?.available);

  return (
    <div className="space-y-4">
      {/* Input Verification & Generate Controls */}
      <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E8E2D5]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl overflow-hidden border border-[#E8E2D5] bg-white shrink-0">
            <img
              src={item.result_image_url}
              alt="Photoreal input"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B5A2B] block">
              Source: Photorealistic 2D Render
            </span>
            <p className="text-xs font-semibold text-[#1A1A1E] truncate">
              1st: stabilityai/TripoSR • Fallback: tencent/Hunyuan3D-2mini
            </p>
            <p className="text-[11px] text-[#78716C] truncate">
              Uses the exact generated render (never sketch or edge map)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#ECE6D8]">
          <select
            value={modelPreference}
            onChange={(e) => setModelPreference(e.target.value)}
            disabled={isGenerating}
            aria-label="3D model priority"
            className="px-2.5 py-2 rounded-xl bg-white border border-[#E0D7C6] text-xs font-medium text-[#1A1A1E] flex-1 min-w-[200px]"
          >
            <option value="auto">Auto (TripoSR → Hunyuan3D-2mini)</option>
            <option value="triposr">TripoSR Only (Priority 1)</option>
            <option value="hunyuan3d">Hunyuan3D-2mini (Fallback)</option>
          </select>

          <button
            onClick={handleGenerate3D}
            disabled={isGenerating}
            className="px-4 py-2 rounded-xl bg-[#8B5A2B] hover:bg-[#724821] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all shrink-0"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Reconstructing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{hasReadyModel ? 'Regenerate 3D Model' : 'Generate 3D Model'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Engine Readiness Summary */}
      {compatibility && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={`px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1.5 ${
              primaryReady
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>
              Priority 1 (TripoSR): {primaryReady ? `Ready (${compatibility.primary?.device?.toUpperCase()})` : 'Unavailable'}
            </span>
          </span>
          <span
            className={`px-2.5 py-1 rounded-lg border font-medium ${
              fallbackReady
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-[#F5F2EB] border-[#E8E2D5] text-[#78716C]'
            }`}
          >
            Fallback (Hunyuan3D-2mini): {fallbackReady ? 'CUDA Ready' : 'Requires CUDA GPU + hy3dgen'}
          </span>
        </div>
      )}

      {/* Blocking Environment Warning (only if neither engine can run) */}
      {compatibility && !compatibility.ready && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>No Compatible 3D Engine Available</span>
          </div>
          <ul className="text-[11px] text-amber-900 space-y-1 list-disc pl-5">
            {compatibility.blocking_reasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Meaningful Failure Message */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2.5 text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <strong className="block font-bold">3D Reconstruction Failed</strong>
            <span className="text-[11px] leading-relaxed block">{errorMsg}</span>
          </div>
        </div>
      )}

      {/* Generation Progress */}
      {isGenerating && (
        <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E8E2D5] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 text-[#8B5A2B] animate-spin shrink-0" />
              <span className="text-xs font-semibold text-[#1A1A1E] truncate">
                {jobState?.message || 'Reconstructing 3D furniture mesh...'}
              </span>
            </div>
            <span className="font-mono text-xs font-bold text-[#8B5A2B] shrink-0">
              {progressPct}% • {jobState?.elapsed_seconds ? `${jobState.elapsed_seconds}s` : `${elapsedSeconds}s`}
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-[#EAE4D7] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#8B5A2B] to-[#D4A373] transition-all duration-300"
              style={{ width: `${Math.max(5, Math.min(100, progressPct))}%` }}
            />
          </div>
          <p className="text-[11px] text-[#78716C]">
            Priority 1: stabilityai/TripoSR (auto-fallback to tencent/Hunyuan3D-2mini if needed)
          </p>
        </div>
      )}

      {/* Interactive Three.js / React Three Fiber 3D Viewport */}
      {hasReadyModel ? (
        <div className="space-y-3">
          {/* Camera Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {['front', 'back', 'side', 'top'].map((presetKey) => (
                <button
                  key={presetKey}
                  onClick={() => triggerCamera(presetKey)}
                  className="px-3 py-1.5 rounded-lg bg-[#F5F2EB] hover:bg-[#EAE4D7] text-[#1A1A1E] text-[11px] font-semibold transition-colors"
                >
                  {CAMERA_PRESETS[presetKey].label}
                </button>
              ))}
              <button
                onClick={() => triggerCamera('reset')}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#E0D7C6] hover:bg-[#FAF8F5] text-[#5C3818] text-[11px] font-semibold flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Camera</span>
              </button>
            </div>

            <span className="text-[11px] text-[#78716C]">
              Drag: Rotate 360° • Scroll: Zoom • Right-drag: Pan
            </span>
          </div>

          <ViewportErrorBoundary key={model3d.glb_url}>
            <div className="relative h-[380px] w-full rounded-2xl overflow-hidden border border-[#E8E2D5] bg-gradient-to-b from-[#FAF8F5] to-[#EFECE4]">
              <Canvas
                shadows
                dpr={[1, 2]}
                camera={{ position: CAMERA_PRESETS.reset.position, fov: 40, near: 0.05, far: 50 }}
                gl={{
                  antialias: true,
                  toneMapping: THREE.ACESFilmicToneMapping,
                  toneMappingExposure: 0.92,
                }}
              >
                <ambientLight intensity={0.38} />
                <directionalLight
                  position={[3.5, 5, 3.5]}
                  intensity={0.95}
                  castShadow
                  shadow-mapSize-width={1024}
                  shadow-mapSize-height={1024}
                />
                <directionalLight position={[-3, 2, -2.5]} intensity={0.35} />
                <Environment preset="studio" environmentIntensity={0.45} />

                <Suspense
                  fallback={
                    <Html center>
                      <div className="px-3 py-2 rounded-xl bg-white/95 border border-[#E8E2D5] shadow-sm text-xs font-semibold text-[#1A1A1E] flex items-center gap-2 whitespace-nowrap">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8B5A2B]" />
                        <span>Loading 3D GLB mesh...</span>
                      </div>
                    </Html>
                  }
                >
                  <LoadedGLBModel url={model3d.glb_url} />
                </Suspense>

                <ContactShadows
                  position={[0, 0.001, 0]}
                  opacity={0.42}
                  scale={5}
                  blur={2.2}
                  far={2}
                />
                <CameraRig cameraCommand={cameraCommand} />
              </Canvas>

              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-xs border border-[#E8E2D5] text-[10px] font-bold text-[#1A1A1E]">
                {model3d.engine_used || 'TripoSR'} • Real 3D Mesh
              </div>

              <button
                onClick={() => (onViewInRoom ? onViewInRoom() : setIsRoomViewOpen(true))}
                className="absolute bottom-3 right-3 px-3.5 py-2 rounded-xl bg-[#1A1A1E]/90 hover:bg-[#1A1A1E] backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg transition-all hover:scale-[1.02]"
              >
                <Camera className="w-3.5 h-3.5 text-amber-300" />
                <span>View in Your Room</span>
              </button>
            </div>
          </ViewportErrorBoundary>

          {/* Mesh Stats & Single-View Proportion Note */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#ECE6D8]">
              <span className="text-[10px] text-[#78716C] block">Vertices</span>
              <span className="font-bold text-[#1A1A1E]">
                {model3d.vertex_count?.toLocaleString() || '—'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#ECE6D8]">
              <span className="text-[10px] text-[#78716C] block">Faces</span>
              <span className="font-bold text-[#1A1A1E]">
                {model3d.face_count?.toLocaleString() || '—'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#ECE6D8]">
              <span className="text-[10px] text-[#78716C] block">Surface Coloring</span>
              <span className="font-bold text-emerald-700">
                {model3d.uv_mapped ? 'UV PBR Texture' : 'Vertex Colors'}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#ECE6D8]">
              <span className="text-[10px] text-[#78716C] block">Build Time</span>
              <span className="font-bold text-[#1A1A1E]">
                {model3d.execution_time ? `${model3d.execution_time}s` : '—'}
              </span>
            </div>
          </div>

          {model3d.proportion_note && (
            <p className="text-[11px] text-[#78716C] italic px-1">
              {model3d.proportion_note}
            </p>
          )}

          {/* Export Downloads & AR Room Placement */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleExportDownload('glb')}
                className="px-4 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2C2C32] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download GLB</span>
              </button>

              {supportedFormats.includes('gltf') && (
                <button
                  onClick={() => handleExportDownload('gltf')}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F5F2EB] border border-[#E0D7C6] text-[#1A1A1E] text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#8B5A2B]" />
                  <span>Download GLTF</span>
                </button>
              )}

              {supportedFormats.includes('obj') && (
                <button
                  onClick={() => handleExportDownload('obj')}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F5F2EB] border border-[#E0D7C6] text-[#1A1A1E] text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#8B5A2B]" />
                  <span>Download OBJ</span>
                </button>
              )}
            </div>

            <button
              onClick={() => (onViewInRoom ? onViewInRoom() : setIsRoomViewOpen(true))}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#8B5A2B] to-[#5C3818] hover:from-[#724821] hover:to-[#4A2D12] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>View in Your Room</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="h-[300px] rounded-2xl border border-dashed border-[#D5C7B0] bg-[#FAF8F5] flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#F5F2EB] border border-[#E8E2D5] flex items-center justify-center text-[#8B5A2B]">
            <Box className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md">
            <h4 className="text-sm font-bold text-[#1A1A1E]">Interactive 3D Model Reconstruction</h4>
            <p className="text-xs text-[#78716C] leading-relaxed">
              Click <strong>Generate 3D Model</strong> to reconstruct a real 3D mesh (GLB, GLTF, OBJ)
              from this photorealistic furniture render using{' '}
              <span className="font-mono text-[11px]">stabilityai/TripoSR</span> (Priority 1) with{' '}
              <span className="font-mono text-[11px]">tencent/Hunyuan3D-2mini</span> fallback.
            </p>
          </div>
        </div>
      )}

      {!onViewInRoom && (
        <ViewInRoomModal
          isOpen={isRoomViewOpen}
          onClose={() => setIsRoomViewOpen(false)}
          item={{ ...item, model_3d: model3d || item?.model_3d }}
          onModelUpdated={(genId, generated) => {
            setModel3d(generated);
            onModelUpdated?.(genId, generated);
          }}
        />
      )}
    </div>
  );
}
