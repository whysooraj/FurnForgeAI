import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  CheckCircle2,
  Download,
  ImagePlus,
  Loader2,
  Move,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Scan,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SwitchCamera,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { generate3DModel, get3DRequirements, get3DStatus } from '../services/api';
import { getCategoryDimensions } from '../utils/glbUtils';
import { detectWebXRCapabilities, requestFurnForgeXRSession } from '../utils/webxrSupport';
import WebXRARScene from './ar/WebXRARScene';
import PreviewARScene from './ar/PreviewARScene';

function getGlbUrl(model3d) {
  return model3d?.glb_url || model3d?.files?.glb || null;
}

function getFriendlyAR3DError(err) {
  const msg = String(err?.message || err || '');
  if (/alloc_cpu|not enough memory|DefaultCPUAllocator/i.test(msg)) {
    return 'CPU RAM is too low right now to build this 3D model. Close other heavy apps or use a smaller render and retry.';
  }
  if (/Failed to fetch|NetworkError|Lost connection/i.test(msg)) {
    return 'Cannot reach the FurnForge AI backend on port 8005. Ensure the backend server is running.';
  }
  return msg || 'Failed to build 3D model for room preview.';
}

class ARCanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || '3D room renderer failed' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-black/80 text-white text-center">
          <div className="max-w-sm rounded-2xl bg-neutral-900 border border-white/15 p-5 space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm font-bold">3D AR Renderer Error</p>
            <p className="text-xs text-neutral-300">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold"
            >
              Retry View
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ViewInRoomModal({ isOpen, onClose, item, onModelUpdated }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasDomRef = useRef(null);
  const photoInputRef = useRef(null);
  const overlayRootRef = useRef(null);
  const controlsOverlayRef = useRef(null);
  const topControlsOverlayRef = useRef(null);
  const snapshotTimeoutRef = useRef(null);
  const statusTimerRef = useRef(null);

  // Camera & Fallback Backdrop State
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraStatus, setCameraStatus] = useState('idle'); // 'idle' | 'starting' | 'active' | 'denied' | 'unavailable'
  const [cameraError, setCameraError] = useState('');
  const [roomPhotoUrl, setRoomPhotoUrl] = useState(null);
  const [viewMode, setViewMode] = useState('desktop3d'); // 'webxr' | 'camera' | 'photo' | 'desktop3d'

  // WebXR Session & Real-World Capability State
  const [xrCaps, setXrCaps] = useState({
    checking: true,
    xrApiAvailable: false,
    immersiveARSupported: false,
    isSecureContext: true,
    isAndroid: false,
    reason: 'Checking WebXR hardware capabilities...',
  });
  const [webXRSession, setWebXRSession] = useState(null);
  const [xrLaunching, setXrLaunching] = useState(false);
  const [xrError, setXrError] = useState('');
  const [xrSessionCaps, setXrSessionCaps] = useState({
    anchorsSupported: false,
    planeDetectionSupported: false,
    lightEstimationSupported: false,
    depthSensingSupported: false,
    anchorActive: false,
    depthOcclusionAvailable: false,
    referenceSpace: 'none',
  });

  // 3D Reconstruction State
  const [resolvedModel3d, setResolvedModel3d] = useState(item?.model_3d || null);
  const [auto3DStatus, setAuto3DStatus] = useState('idle'); // 'idle' | 'checking' | 'generating' | 'ready' | 'failed'
  const [auto3DProgress, setAuto3DProgress] = useState(0);
  const [auto3DMessage, setAuto3DMessage] = useState('');
  const [auto3DElapsed, setAuto3DElapsed] = useState(0);
  const [auto3DError, setAuto3DError] = useState('');
  const [autoBuildTrigger, setAutoBuildTrigger] = useState(0);

  // Placement & Manipulation State
  const [placementState, setPlacementState] = useState('scanning'); // 'scanning' | 'placed'
  const [statusTag, setStatusTag] = useState('scanning');
  const [statusBannerText, setStatusBannerText] = useState('Scanning environment...');
  const [isRepositioning, setIsRepositioning] = useState(false);

  const [reticlePos, setReticlePos] = useState([0, 0, -2.1]);
  const [placedPos, setPlacedPos] = useState([0, 0, -2.1]);
  const [initialPlacedPos, setInitialPlacedPos] = useState([0, 0, -2.1]);
  const [dropTick, setDropTick] = useState(0);

  // Ticks forwarded to WebXR scene actions
  const [xrPlaceTick, setXrPlaceTick] = useState(0);
  const [xrResetPosTick, setXrResetPosTick] = useState(0);
  const [xrRemoveTick, setXrRemoveTick] = useState(0);

  const [rotationDeg, setRotationDeg] = useState(0);
  const [userScale, setUserScale] = useState(1.0); // 1.0 = exact 1:1 metric real-world dimensions
  const [floorTiltDeg, setFloorTiltDeg] = useState(14);
  const [lightExposure, setLightExposure] = useState(1.0);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [snapshotToast, setSnapshotToast] = useState(false);

  const dims = useMemo(
    () => getCategoryDimensions(item?.category, item?.dimensions),
    [item?.category, item?.dimensions]
  );

  const glbUrl = getGlbUrl(resolvedModel3d);

  const setTransientStatus = useCallback((text, fallbackTag, fallbackText) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusBannerText(text);
    statusTimerRef.current = setTimeout(() => {
      setStatusTag(fallbackTag);
      setStatusBannerText(fallbackText);
    }, 2200);
  }, []);

  const handleXRStatusChange = useCallback((tag, text) => {
    setStatusTag(tag);
    setStatusBannerText(text);
  }, []);

  const handleXRCapabilitiesReport = useCallback((patch) => {
    setXrSessionCaps((prev) => ({ ...prev, ...patch }));
  }, []);

  // Prevent WebXR overlay DOM taps from triggering XR 'select' events underneath buttons
  useEffect(() => {
    const attachGuard = (el) => {
      if (!el) return () => {};
      const stopSelect = (e) => e.preventDefault();
      el.addEventListener('beforexrselect', stopSelect);
      return () => el.removeEventListener('beforexrselect', stopSelect);
    };
    const cleanupBottom = attachGuard(controlsOverlayRef.current);
    const cleanupTop = attachGuard(topControlsOverlayRef.current);
    return () => {
      cleanupBottom();
      cleanupTop();
    };
  }, [isOpen, webXRSession, showCalibrate]);

  // Reset state whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setResolvedModel3d(item?.model_3d || null);
    setAuto3DError('');
    setAuto3DProgress(0);
    setAuto3DElapsed(0);
    setPlacementState('scanning');
    setIsRepositioning(false);
    setStatusTag('scanning');
    setStatusBannerText('Scanning environment...');
    setReticlePos([0, 0, -2.1]);
    setPlacedPos([0, 0, -2.1]);
    setInitialPlacedPos([0, 0, -2.1]);
    setRotationDeg(0);
    setUserScale(1.0);
    setFloorTiltDeg(14);
    setLightExposure(1.0);
    setShowCalibrate(false);
    setXrError('');
    setCameraError('');
    setRoomPhotoUrl(null);
  }, [isOpen, item?.id, item?.model_3d]);

  // Elapsed timer during auto-3D build
  useEffect(() => {
    if (!isOpen || auto3DStatus !== 'generating') return undefined;
    const timer = setInterval(() => setAuto3DElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isOpen, auto3DStatus]);

  // Automatically check/build GLB 3D model when opened if missing
  useEffect(() => {
    if (!isOpen || !item?.id) return undefined;
    if (getGlbUrl(item?.model_3d)) {
      setResolvedModel3d(item.model_3d);
      setAuto3DStatus('ready');
      return undefined;
    }

    let cancelled = false;
    async function ensure3DModel() {
      setAuto3DStatus('checking');
      setAuto3DError('');
      try {
        const status = await get3DStatus(item.id);
        if (cancelled) return;
        if (getGlbUrl(status?.model_3d)) {
          setResolvedModel3d(status.model_3d);
          setAuto3DStatus('ready');
          onModelUpdated?.(item.id, status.model_3d);
          return;
        }

        const reqs = await get3DRequirements();
        if (cancelled) return;
        const engineAvailable = Boolean(
          reqs?.ready ||
            reqs?.primary?.available ||
            reqs?.fallback?.available ||
            reqs?.triposr?.available ||
            reqs?.hunyuan3d?.available
        );
        if (!engineAvailable) {
          setAuto3DStatus('failed');
          setAuto3DError(
            (Array.isArray(reqs?.blocking_reasons) && reqs.blocking_reasons.join(' ')) ||
              reqs?.recommendation ||
              'Local 3D reconstruction engine is currently unavailable.'
          );
          return;
        }

        setAuto3DStatus('generating');
        setAuto3DProgress(8);
        setAuto3DMessage('Preparing true 3D furniture mesh for AR...');
        const res = await generate3DModel(
          {
            generation_id: item.id,
            image_url: item.result_image_url,
            model_preference: 'auto',
          },
          (job) => {
            if (cancelled) return;
            const raw = Number(job?.progress ?? 0.15);
            const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
            setAuto3DProgress(Math.max(8, Math.min(100, pct)));
            setAuto3DMessage(job?.message || 'Reconstructing 3D furniture mesh...');
          }
        );
        if (cancelled) return;
        const generated = res?.model_3d || res;
        if (getGlbUrl(generated)) {
          setResolvedModel3d(generated);
          setAuto3DStatus('ready');
          setAuto3DProgress(100);
          onModelUpdated?.(item.id, generated);
        } else {
          throw new Error('3D build completed without a GLB asset.');
        }
      } catch (err) {
        if (cancelled) return;
        setAuto3DStatus('failed');
        setAuto3DError(getFriendlyAR3DError(err));
      }
    }

    ensure3DModel();
    return () => {
      cancelled = true;
    };
  }, [isOpen, item?.id, item?.model_3d, item?.result_image_url, autoBuildTrigger, onModelUpdated]);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode) => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraStatus('unavailable');
        setCameraError('Camera API is unavailable in this browser. Using Desktop 3D Viewer.');
        setViewMode('desktop3d');
        return;
      }

      stopCameraStream();
      setCameraStatus('starting');
      setCameraError('');

      try {
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraStatus('active');
        setViewMode('camera');
      } catch (err) {
        const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
        setCameraStatus(denied ? 'denied' : 'unavailable');
        setCameraError(
          denied
            ? 'Camera access blocked. Switched to Desktop 3D Viewer — or upload a Room Photo.'
            : 'No webcam detected on this device. Switched to Desktop 3D Viewer.'
        );
        setViewMode('desktop3d');
      }
    },
    [stopCameraStream]
  );

  // Detect WebXR capabilities cleanly when modal opens (never claim webcam = WebXR world tracking)
  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      if (webXRSession) {
        webXRSession.end().catch(() => {});
        setWebXRSession(null);
      }
      return undefined;
    }

    let cancelled = false;
    async function initModalMode() {
      setXrCaps((prev) => ({ ...prev, checking: true }));
      const caps = await detectWebXRCapabilities();
      if (cancelled) return;
      setXrCaps({ checking: false, ...caps });

      if (caps.immersiveARSupported) {
        // Auto-attempt WebXR session only if supported, otherwise fall back cleanly
        try {
          const session = await requestFurnForgeXRSession(overlayRootRef.current);
          if (cancelled) {
            session.end().catch(() => {});
            return;
          }
          setWebXRSession(session);
          setViewMode('webxr');
          setStatusTag('detecting_floor');
          setStatusBannerText('Detecting floor...');
          return;
        } catch (err) {
          if (!cancelled) {
            setXrError(
              err?.message || 'Tap "Start AR Tracking" when ready, or use Camera Preview / Desktop 3D.'
            );
          }
        }
      }

      // Desktop / non-WebXR fallback: default to Desktop 3D Viewer if on desktop without WebXR,
      // or attempt camera preview for visual placement check with explicit non-AR notice.
      if (!caps.isAndroid) {
        setViewMode('desktop3d');
        setStatusTag('surface_detected');
        setStatusBannerText('Surface detected. Tap to place furniture.');
        setPlacementState('placed');
      } else {
        await startCamera('environment');
        setStatusTag('surface_detected');
        setStatusBannerText('Surface detected. Tap to place furniture.');
      }
    }

    initModalMode();
    return () => {
      cancelled = true;
      stopCameraStream();
      if (snapshotTimeoutRef.current) clearTimeout(snapshotTimeoutRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [isOpen, startCamera, stopCameraStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLaunchWebXR = async () => {
    setXrError('');
    setXrLaunching(true);
    stopCameraStream();
    try {
      const session = await requestFurnForgeXRSession(overlayRootRef.current);
      setWebXRSession(session);
      setViewMode('webxr');
      setPlacementState('scanning');
      setStatusTag('detecting_floor');
      setStatusBannerText('Detecting floor...');
    } catch (err) {
      setXrError(
        err?.message || 'Could not start WebXR ARCore session. Check Chrome & ARCore permissions.'
      );
    } finally {
      setXrLaunching(false);
    }
  };

  const handleExitWebXR = useCallback(() => {
    setWebXRSession(null);
    setViewMode(xrCaps.isAndroid ? 'camera' : 'desktop3d');
    setPlacementState('scanning');
    setXrSessionCaps((prev) => ({ ...prev, anchorActive: false }));
  }, [xrCaps.isAndroid]);

  const handleSwitchCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    setRoomPhotoUrl(null);
    if (webXRSession) {
      webXRSession.end().catch(() => {});
      setWebXRSession(null);
    }
    startCamera(next);
  };

  const handleUploadRoomPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (webXRSession) {
      webXRSession.end().catch(() => {});
      setWebXRSession(null);
    }
    const url = URL.createObjectURL(file);
    stopCameraStream();
    setCameraError('');
    setRoomPhotoUrl(url);
    setViewMode('photo');
    setPlacementState('scanning');
    setStatusTag('surface_detected');
    setStatusBannerText('Surface detected. Tap to place furniture.');
    e.target.value = '';
  };

  const handleUseDesktop3D = () => {
    if (webXRSession) {
      webXRSession.end().catch(() => {});
      setWebXRSession(null);
    }
    stopCameraStream();
    setCameraError('');
    setRoomPhotoUrl(null);
    setViewMode('desktop3d');
    setPlacementState('placed');
    setStatusTag('placed');
    setStatusBannerText('1:1 Desktop 3D Inspection');
  };

  const handlePlaceAt = useCallback((coords) => {
    setPlacedPos(coords);
    setInitialPlacedPos(coords);
    setPlacementState('placed');
    setIsRepositioning(false);
    setDropTick((t) => t + 1);
    setStatusTag('placed');
    setStatusBannerText('Furniture successfully placed.');
  }, []);

  const handlePrimaryPlaceTap = () => {
    if (!glbUrl) return;
    if (webXRSession) {
      if (statusTag !== 'surface_detected' && statusTag !== 'placed') return;
      setXrPlaceTick((t) => t + 1);
      return;
    }
    handlePlaceAt(reticlePos);
  };

  const handleReposition = () => {
    if (webXRSession) {
      setIsRepositioning(true);
      setTransientStatus(
        'Reposition furniture.',
        'placed',
        'Drag furniture or tap detected floor to relocate'
      );
      return;
    }
    setIsRepositioning(true);
    setPlacementState('scanning');
    setStatusTag('surface_detected');
    setStatusBannerText('Reposition furniture.');
  };

  const handleResetPosition = () => {
    if (webXRSession) {
      setXrResetPosTick((t) => t + 1);
      setTransientStatus('Reset placement.', 'placed', 'Furniture successfully placed.');
      return;
    }
    setPlacedPos(initialPlacedPos);
    setDropTick((t) => t + 1);
    setPlacementState('placed');
    setTransientStatus('Reset placement.', 'placed', 'Furniture successfully placed.');
  };

  const handleResetRotation = () => {
    setRotationDeg(0);
  };

  const handleRemovePlaced = () => {
    if (webXRSession) {
      setXrRemoveTick((t) => t + 1);
    }
    setPlacementState('scanning');
    setIsRepositioning(false);
    setUserScale(1.0);
    setRotationDeg(0);
    setStatusTag('surface_detected');
    setTransientStatus(
      'Reset placement.',
      'surface_detected',
      'Surface detected. Tap to place furniture.'
    );
  };

  const handleCloseModal = () => {
    if (webXRSession) {
      webXRSession.end().catch(() => {});
      setWebXRSession(null);
    }
    stopCameraStream();
    onClose();
  };

  const handleCaptureSnapshot = () => {
    const glCanvas = canvasDomRef.current;
    if (!glCanvas) return;

    const width = glCanvas.width || 1280;
    const height = glCanvas.height || 720;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    const drawOverlayAndSave = () => {
      ctx.drawImage(glCanvas, 0, 0, width, height);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(20, height - 56, 360, 36);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        `FurnForge AI • ${item?.title || item?.category || 'Room Preview'} (${dims.label})`,
        32,
        height - 33
      );

      const link = document.createElement('a');
      link.download = `FurnForge_${(item?.category || 'Furniture').replace(/\s+/g, '_')}_RoomPreview.png`;
      link.href = out.toDataURL('image/png');
      link.click();

      setSnapshotToast(true);
      if (snapshotTimeoutRef.current) clearTimeout(snapshotTimeoutRef.current);
      snapshotTimeoutRef.current = setTimeout(() => setSnapshotToast(false), 2600);
    };

    if (viewMode === 'camera' && videoRef.current && videoRef.current.readyState >= 2) {
      const vw = videoRef.current.videoWidth || width;
      const vh = videoRef.current.videoHeight || height;
      const scale = Math.max(width / vw, height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(videoRef.current, (width - dw) / 2, (height - dh) / 2, dw, dh);
      drawOverlayAndSave();
    } else if (viewMode === 'photo' && roomPhotoUrl) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(width / img.width, height / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
        drawOverlayAndSave();
      };
      img.src = roomPhotoUrl;
    } else {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, width, height);
      drawOverlayAndSave();
    }
  };

  if (!isOpen) return null;

  const isTrueWebXR = Boolean(webXRSession);
  const isOrbitMode = !isTrueWebXR && viewMode === 'desktop3d';
  const showBackdropMedia = !isTrueWebXR && (viewMode === 'camera' || viewMode === 'photo');

  return (
    <div
      ref={overlayRootRef}
      className="fixed inset-0 z-50 bg-neutral-950 flex flex-col select-none overflow-hidden"
    >
      {/* Hidden input for Room Photo fallback */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={handleUploadRoomPhoto}
        className="hidden"
      />

      {/* Backdrop: Live Webcam or Room Photo (strictly omitted during native WebXR AR) */}
      {!isTrueWebXR && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${
            viewMode === 'camera' && cameraStatus === 'active' ? 'block' : 'hidden'
          }`}
        />
      )}

      {!isTrueWebXR && viewMode === 'photo' && roomPhotoUrl && (
        <img
          src={roomPhotoUrl}
          alt="Uploaded Room"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {isOrbitMode && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 35%, rgba(68, 64, 60, 0.35), rgba(12, 10, 9, 0.96) 72%)',
          }}
        />
      )}

      {/* Three.js AR / 3D Canvas */}
      <div className="absolute inset-0 z-10">
        <ARCanvasErrorBoundary>
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{
              alpha: true,
              antialias: true,
              preserveDrawingBuffer: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: lightExposure,
            }}
            onCreated={({ gl }) => {
              canvasDomRef.current = gl.domElement;
            }}
          >
            {isTrueWebXR ? (
              <WebXRARScene
                glbUrl={glbUrl}
                category={item?.category}
                itemDimensions={item?.dimensions}
                webXRSession={webXRSession}
                placementState={placementState}
                rotationDeg={rotationDeg}
                userScale={userScale}
                lightExposure={lightExposure}
                onStatusChange={handleXRStatusChange}
                onCapabilitiesReport={handleXRCapabilitiesReport}
                onPlaced={() => setPlacementState('placed')}
                onExitWebXR={handleExitWebXR}
                placeTriggerTick={xrPlaceTick}
                resetPositionTick={xrResetPosTick}
                removeTick={xrRemoveTick}
              />
            ) : (
              <PreviewARScene
                glbUrl={glbUrl}
                category={item?.category}
                itemDimensions={item?.dimensions}
                isOrbitMode={isOrbitMode}
                placementState={placementState}
                dropTick={dropTick}
                reticlePos={reticlePos}
                setReticlePos={setReticlePos}
                placedPos={placedPos}
                setPlacedPos={setPlacedPos}
                rotationDeg={rotationDeg}
                setRotationDeg={setRotationDeg}
                userScale={userScale}
                setUserScale={setUserScale}
                floorTiltDeg={floorTiltDeg}
                lightExposure={lightExposure}
                isInteracting={isInteracting}
                setIsInteracting={setIsInteracting}
                onPlaceAt={handlePlaceAt}
                onWebGLReady={(dom) => {
                  canvasDomRef.current = dom;
                }}
              />
            )}
          </Canvas>
        </ARCanvasErrorBoundary>
      </div>

      {/* Top HUD Bar */}
      <div
        ref={topControlsOverlayRef}
        className="relative z-20 p-3 sm:p-5 flex flex-wrap items-start justify-between gap-2 pointer-events-none"
      >
        {/* Left: Close + Mode & Exact Real-World Metric Dimensions */}
        <div className="pointer-events-auto flex items-center gap-2.5 bg-black/65 backdrop-blur-md border border-white/15 px-3 py-2 rounded-2xl text-white shadow-xl">
          <button
            type="button"
            onClick={handleCloseModal}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer"
            title="Close AR View"
          >
            <X className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`w-2 h-2 rounded-full ${
                  isTrueWebXR
                    ? xrSessionCaps.anchorActive
                      ? 'bg-emerald-400'
                      : 'bg-amber-400 animate-pulse'
                    : showBackdropMedia
                      ? 'bg-amber-400'
                      : 'bg-sky-400'
                }`}
              />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                {isTrueWebXR
                  ? xrSessionCaps.anchorActive
                    ? 'WebXR World-Anchored'
                    : 'WebXR Floor Scan'
                  : viewMode === 'camera'
                    ? 'Camera Preview (No World Tracking)'
                    : viewMode === 'photo'
                      ? 'Room Photo Preview'
                      : 'Desktop 3D Viewer (1:1 Metric)'}
              </span>
              <span className="text-[11px] text-white/70 font-mono">
                • {dims.label}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-bold leading-tight truncate max-w-[200px] sm:max-w-[300px]">
              {item?.title || `${item?.style || 'Modern'} ${item?.category || 'Furniture'}`}
            </p>
          </div>
        </div>

        {/* Right: Mode & Utility Buttons (preserving Switch Camera & Room Photo) */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {!isTrueWebXR && xrCaps.immersiveARSupported && (
            <button
              type="button"
              onClick={handleLaunchWebXR}
              disabled={xrLaunching}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg cursor-pointer disabled:opacity-60"
            >
              {xrLaunching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scan className="w-3.5 h-3.5" />}
              <span>Start WebXR AR</span>
            </button>
          )}

          {!isTrueWebXR && (
            <button
              type="button"
              onClick={() => (viewMode === 'desktop3d' ? startCamera(facingMode) : handleUseDesktop3D())}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/65 hover:bg-black/80 backdrop-blur-md border border-white/15 text-white text-xs font-semibold cursor-pointer"
              title="Switch between Desktop 3D Viewer and Camera Preview"
            >
              {viewMode === 'desktop3d' ? (
                <>
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Camera Preview</span>
                </>
              ) : (
                <>
                  <Box className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">Desktop 3D</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleSwitchCamera}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/65 hover:bg-black/80 backdrop-blur-md border border-white/15 text-white text-xs font-semibold cursor-pointer"
            title="Switch Camera"
          >
            <SwitchCamera className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Switch Camera</span>
          </button>

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/65 hover:bg-black/80 backdrop-blur-md border border-white/15 text-white text-xs font-semibold cursor-pointer"
            title="Upload a Room Photo"
          >
            <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
            <span>Room Photo</span>
          </button>

          <button
            type="button"
            onClick={handleCloseModal}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      {/* Live AR Status Pill & Compatibility Advisory */}
      <div className="relative z-20 flex flex-col items-center px-4 gap-2 pointer-events-none">
        {glbUrl && (
          <div
            className={`px-4 py-2 rounded-full backdrop-blur-md border text-xs font-semibold shadow-lg flex items-center gap-2 ${
              statusTag === 'placed'
                ? 'bg-emerald-950/80 border-emerald-400/40 text-emerald-200'
                : statusTag === 'surface_detected'
                  ? 'bg-amber-950/85 border-amber-400/50 text-amber-200'
                  : 'bg-black/75 border-white/15 text-white/95'
            }`}
          >
            {statusTag === 'placed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : statusTag === 'surface_detected' ? (
              <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Scan className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
            )}
            <span>
              {isTrueWebXR
                ? statusBannerText
                : isOrbitMode
                  ? 'Drag to orbit 360° • Scroll to zoom • 1:1 real-world metric grid'
                  : placementState === 'placed'
                    ? `${statusBannerText} • Drag to move • Rotate below`
                    : `${statusBannerText} • Move pointer on floor & tap to place`}
            </span>
          </div>
        )}

        {/* Honest WebXR Compatibility Warning when real-world tracking is unavailable */}
        {!isTrueWebXR && !xrCaps.checking && (
          <div className="pointer-events-auto max-w-xl px-3.5 py-2 rounded-xl bg-neutral-900/85 backdrop-blur-md border border-amber-500/30 text-amber-100 text-[11px] flex items-start gap-2 shadow-lg">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-300">
                {xrCaps.immersiveARSupported
                  ? 'Preview Mode Active — '
                  : 'WebXR World Tracking Unavailable — '}
              </span>
              <span className="text-neutral-200">
                {xrError || cameraError || xrCaps.reason}
              </span>
            </div>
          </div>
        )}

        {/* Snapshot saved confirmation */}
        {snapshotToast && (
          <div className="px-4 py-2 rounded-full bg-emerald-600/95 text-white text-xs font-bold shadow-lg flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Room photo snapshot downloaded!
          </div>
        )}
      </div>

      {/* Auto 3D Model Loading Overlay */}
      {!glbUrl && (
        <div className="relative z-20 flex-1 flex items-center justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto max-w-sm w-full rounded-2xl bg-neutral-900/92 backdrop-blur-xl border border-white/15 p-6 text-white text-center shadow-2xl space-y-4">
            {auto3DStatus === 'failed' ? (
              <>
                <AlertTriangle className="w-9 h-9 text-amber-400 mx-auto" />
                <div>
                  <p className="text-sm font-bold">3D Mesh Needed for AR Placement</p>
                  <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
                    {auto3DError || 'Could not reconstruct the 3D furniture mesh.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoBuildTrigger((t) => t + 1)}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry 3D Mesh Reconstruction
                </button>
              </>
            ) : (
              <>
                <Loader2 className="w-9 h-9 text-amber-400 animate-spin mx-auto" />
                <div>
                  <p className="text-sm font-bold">Preparing 3D Furniture Mesh...</p>
                  <p className="text-xs text-neutral-300 mt-1">
                    {auto3DMessage || 'Building metric-scaled GLB asset'}
                  </p>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(8, auto3DProgress)}%` }}
                  />
                </div>
                <p className="text-[11px] font-mono text-neutral-400">
                  {auto3DProgress}% • {auto3DElapsed}s elapsed
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Spacer pushes controls bar to bottom */}
      {glbUrl && <div className="flex-1 pointer-events-none" />}

      {/* Bottom Controls Deck */}
      {glbUrl && (
        <div
          ref={controlsOverlayRef}
          className="relative z-20 p-3 sm:p-5 flex flex-col items-center gap-2.5 pointer-events-none"
        >
          {/* Calibrate & WebXR Diagnostics Drawer */}
          {showCalibrate && (
            <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-black/85 backdrop-blur-xl border border-white/15 p-4 text-white space-y-3 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Calibration & AR Diagnostics
                </span>
                <button
                  type="button"
                  onClick={() => setShowCalibrate(false)}
                  className="text-xs text-white/60 hover:text-white cursor-pointer"
                >
                  Done
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-white/5 rounded-xl p-2.5 border border-white/10">
                <div className="text-neutral-400">Dimensions (H×W×D):</div>
                <div className="font-mono text-right text-amber-300">{dims.label}</div>

                <div className="text-neutral-400">Reference Space:</div>
                <div className="font-mono text-right">
                  {isTrueWebXR ? xrSessionCaps.referenceSpace : isOrbitMode ? 'metric-grid' : 'preview-plane'}
                </div>

                <div className="text-neutral-400">World XR Anchor:</div>
                <div className="font-mono text-right">
                  {isTrueWebXR
                    ? xrSessionCaps.anchorActive
                      ? 'Locked (XRAnchor)'
                      : xrSessionCaps.anchorsSupported
                        ? 'Ready'
                        : 'Session Pose'
                    : 'Not Available'}
                </div>

                <div className="text-neutral-400">Light Estimation:</div>
                <div className="font-mono text-right">
                  {isTrueWebXR
                    ? xrSessionCaps.lightEstimationSupported
                      ? 'Active (ARCore)'
                      : 'Fallback Light'
                    : 'Studio Environment'}
                </div>

                <div className="text-neutral-400">Hardware Occlusion:</div>
                <div className="font-mono text-right">
                  {isTrueWebXR && xrSessionCaps.depthOcclusionAvailable
                    ? 'Depth Available'
                    : 'Unavailable'}
                </div>
              </div>

              {!isTrueWebXR && !isOrbitMode && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/80">Preview Floor Perspective Tilt</span>
                    <span className="font-mono text-amber-300">{floorTiltDeg}°</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="36"
                    value={floorTiltDeg}
                    onChange={(e) => setFloorTiltDeg(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              )}

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/80">Scale Adjustment (100% = Real Metric Size)</span>
                  <span className="font-mono text-amber-300">{Math.round(userScale * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="50"
                    max="200"
                    value={Math.round(userScale * 100)}
                    onChange={(e) => setUserScale(Number(e.target.value) / 100)}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setUserScale(1.0)}
                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-bold shrink-0 cursor-pointer"
                  >
                    1:1
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/80">Lighting Brightness</span>
                  <span className="font-mono text-amber-300">{lightExposure.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="1.8"
                  step="0.1"
                  value={lightExposure}
                  onChange={(e) => setLightExposure(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Main Action Bar */}
          <div className="pointer-events-auto w-full max-w-2xl rounded-2xl bg-black/75 backdrop-blur-xl border border-white/15 p-3 text-white shadow-2xl space-y-2.5">
            {placementState === 'scanning' && !isOrbitMode ? (
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="text-xs text-white/85 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    {isTrueWebXR
                      ? statusTag === 'surface_detected'
                        ? 'Surface detected. Tap Place on Floor or tap the detected floor.'
                        : 'Move device slowly to scan flat floor surfaces...'
                      : 'Aim floor ring where you want the furniture placed'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handlePrimaryPlaceTap}
                  disabled={isTrueWebXR && statusTag !== 'surface_detected'}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed text-black text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-lg cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {isRepositioning ? 'Confirm New Spot' : 'Place on Floor'}
                </button>
              </div>
            ) : (
              <>
                {/* Rotate & Scale Row */}
                <div className="flex flex-wrap items-center gap-2.5 px-1">
                  <button
                    type="button"
                    onClick={() => setRotationDeg((r) => (r - 45 + 360) % 360)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                    title="Rotate -45°"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex-1 min-w-[120px] flex flex-col">
                    <div className="flex justify-between text-[10px] text-white/75 mb-0.5">
                      <span>Rotate</span>
                      <span className="font-mono text-amber-300">{Math.round(rotationDeg)}°</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={Math.round(rotationDeg)}
                      onChange={(e) => setRotationDeg(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1.5"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setRotationDeg((r) => (r + 45) % 360)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                    title="Rotate +45°"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleResetRotation}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold cursor-pointer"
                    title="Reset Rotation to 0°"
                  >
                    Reset Rot
                  </button>

                  {/* Scale Controls */}
                  <div className="flex items-center gap-1 bg-white/10 rounded-lg px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setUserScale((s) => Math.max(0.5, Number((s - 0.1).toFixed(2))))}
                      className="p-0.5 hover:text-amber-300 cursor-pointer"
                      title="Scale Down"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserScale(1.0)}
                      className="text-[11px] font-mono w-11 text-center text-amber-300 cursor-pointer"
                      title="Click to reset to 1:1 Real Scale"
                    >
                      {Math.round(userScale * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserScale((s) => Math.min(2.0, Number((s + 0.1).toFixed(2))))}
                      className="p-0.5 hover:text-amber-300 cursor-pointer"
                      title="Scale Up"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Primary Footer Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                  <div className="flex items-center gap-1.5">
                    {!isOrbitMode && (
                      <button
                        type="button"
                        onClick={handleReposition}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                      >
                        <Move className="w-3.5 h-3.5 text-amber-400" />
                        <span>Reposition</span>
                      </button>
                    )}

                    {!isOrbitMode && (
                      <button
                        type="button"
                        onClick={handleResetPosition}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                        title="Reset Position to original floor anchor"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-sky-300" />
                        <span className="hidden sm:inline">Reset Pos</span>
                      </button>
                    )}

                    {!isOrbitMode && (
                      <button
                        type="button"
                        onClick={handleRemovePlaced}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/35 text-red-200 text-xs font-semibold cursor-pointer"
                        title="Remove Placed Furniture"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleCaptureSnapshot}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-amber-50 text-black text-xs font-bold shadow-lg cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-amber-700" />
                    <span>Snap Room Photo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCalibrate((s) => !s)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                      showCalibrate
                        ? 'bg-amber-500 text-black'
                        : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Calibrate</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
