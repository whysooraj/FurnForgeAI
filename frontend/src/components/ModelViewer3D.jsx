import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { 
  Box, RotateCw, Eye, Download, Camera, Sparkles, 
  Layers, Maximize2, RefreshCw, Check
} from 'lucide-react';
import { createFurniture3DScene } from '../utils/furniture3D';
import { COLORS } from '../utils/presets';

export default function ModelViewer3D({
  category = 'Chair',
  material = 'Wood',
  color = 'Warm Walnut',
  style = 'Modern',
  finish = 'Matte',
  rawSketchUrl
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const furnitureGroupRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Viewport states
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [currentCameraView, setCurrentCameraView] = useState('iso');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState('');

  const currentColorHex = COLORS.find((c) => c.name === color)?.hex || '#523826';

  // 1. Initialize Three.js Scene, Camera, Lights, and OrbitControls
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 500;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F7F5F0');
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(4.5, 3.8, 5.2);
    cameraRef.current = camera;

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;
    container.replaceChildren(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent camera going below floor
    controls.minDistance = 2.5;
    controls.maxDistance = 12;
    controls.target.set(0, 1.2, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.8;
    controlsRef.current = controls;

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.7);
    scene.add(ambientLight);

    // Key Light
    const keyLight = new THREE.DirectionalLight(0xFFF8EE, 1.8);
    keyLight.position.set(5, 8, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    scene.add(keyLight);

    // Fill Light
    const fillLight = new THREE.DirectionalLight(0xE0ECF8, 0.9);
    fillLight.position.set(-5, 4, -3);
    scene.add(fillLight);

    // Back / Rim Light
    const rimLight = new THREE.DirectionalLight(0xFFFFFF, 0.7);
    rimLight.position.set(0, 5, -5);
    scene.add(rimLight);

    // Studio Circular Shadow Ground Plane
    const groundGeo = new THREE.PlaneGeometry(16, 16);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.22 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid Floor for architectural scale
    const gridHelper = new THREE.GridHelper(10, 20, 0xDDD6C8, 0xEBE5D8);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    // Animation Loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 2. Synchronize Auto-Rotate toggle with controls
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // 3. Rebuild 3D Model whenever category, material, color, or finish changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove existing furniture group
    if (furnitureGroupRef.current) {
      scene.remove(furnitureGroupRef.current);
      furnitureGroupRef.current.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }

    // Build fresh 3D geometry matching category and PBR specs
    const newGroup = createFurniture3DScene({
      category,
      material,
      colorHex: currentColorHex,
      finish
    });

    // Apply wireframe if active
    newGroup.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.wireframe = wireframe;
      }
    });

    scene.add(newGroup);
    furnitureGroupRef.current = newGroup;
  }, [category, material, currentColorHex, finish, wireframe]);

  // 4. Camera View Presets
  const setCameraView = (view) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    setCurrentCameraView(view);

    if (view === 'iso') {
      camera.position.set(4.5, 3.8, 5.2);
    } else if (view === 'front') {
      camera.position.set(0, 1.6, 6.2);
    } else if (view === 'side') {
      camera.position.set(6.2, 1.6, 0);
    } else if (view === 'top') {
      camera.position.set(0, 7.5, 0.01);
    }
    controls.target.set(0, 1.2, 0);
    controls.update();
  };

  // 5. Export 3D Model as Binary GLTF (.GLB)
  const handleExportGLB = () => {
    if (!furnitureGroupRef.current) return;
    setIsExporting(true);

    const exporter = new GLTFExporter();
    exporter.parse(
      furnitureGroupRef.current,
      (glbBuffer) => {
        const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `FurnForge_${category.toLowerCase()}_${material.toLowerCase()}_${color.toLowerCase().replace(/\s+/g, '_')}.glb`;
        link.click();
        URL.revokeObjectURL(url);
        setIsExporting(false);
        setExportSuccessMsg('Downloaded .GLB Model!');
        setTimeout(() => setExportSuccessMsg(''), 3000);
      },
      (error) => {
        console.error('GLTF Export error:', error);
        setIsExporting(false);
      },
      { binary: true }
    );
  };

  // 6. Export 3D Model as Wavefront OBJ (.OBJ)
  const handleExportOBJ = () => {
    if (!furnitureGroupRef.current) return;
    setIsExporting(true);

    const exporter = new OBJExporter();
    const result = exporter.parse(furnitureGroupRef.current);
    const blob = new Blob([result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FurnForge_${category.toLowerCase()}_${material.toLowerCase()}_${color.toLowerCase().replace(/\s+/g, '_')}.obj`;
    link.click();
    URL.revokeObjectURL(url);
    setIsExporting(false);
    setExportSuccessMsg('Downloaded .OBJ Mesh!');
    setTimeout(() => setExportSuccessMsg(''), 3000);
  };

  // 7. Capture High-Resolution Studio Screenshot
  const handleCaptureSnapshot = () => {
    if (!rendererRef.current) return;
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `FurnForge_3D_Snapshot_${category.toLowerCase()}.png`;
    link.click();
    setExportSuccessMsg('Saved 3D Viewport Snapshot!');
    setTimeout(() => setExportSuccessMsg(''), 3000);
  };

  return (
    <div className="bg-[#FAF8F5] rounded-2xl border border-[#E8E2D5] overflow-hidden flex flex-col space-y-3 p-4 shadow-inner">
      {/* 3D Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE4D7] pb-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#8B5A2B]/15 text-[#5C3818] flex items-center justify-center font-bold">
            <Box className="w-4 h-4 text-[#8B5A2B]" />
          </div>
          <div>
            <h4 className="font-bold text-[#1A1A1E] flex items-center gap-1.5">
              <span>Interactive 3D Furniture Model</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </h4>
            <p className="text-[11px] text-[#78716C]">
              Real-time WebGL PBR • Rotate 360°, zoom & pan
            </p>
          </div>
        </div>

        {/* View Camera Presets */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#E0D7C6] text-[11px]">
          <button
            onClick={() => setCameraView('iso')}
            className={`px-2 py-1 rounded-lg transition-colors font-medium ${
              currentCameraView === 'iso' ? 'bg-[#1A1A1E] text-white' : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            Perspective
          </button>
          <button
            onClick={() => setCameraView('front')}
            className={`px-2 py-1 rounded-lg transition-colors font-medium ${
              currentCameraView === 'front' ? 'bg-[#1A1A1E] text-white' : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            Front
          </button>
          <button
            onClick={() => setCameraView('side')}
            className={`px-2 py-1 rounded-lg transition-colors font-medium ${
              currentCameraView === 'side' ? 'bg-[#1A1A1E] text-white' : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            Side
          </button>
          <button
            onClick={() => setCameraView('top')}
            className={`px-2 py-1 rounded-lg transition-colors font-medium ${
              currentCameraView === 'top' ? 'bg-[#1A1A1E] text-white' : 'text-[#666] hover:text-[#1A1A1E]'
            }`}
          >
            Top
          </button>
        </div>
      </div>

      {/* Main 3D Canvas Viewport */}
      <div className="relative aspect-square w-full max-h-[460px] mx-auto rounded-xl overflow-hidden bg-gradient-to-b from-[#F9F7F2] to-[#ECE6DB] border border-[#DDD6C8] shadow-inner select-none cursor-grab active:cursor-grabbing">
        <div ref={mountRef} className="w-full h-full" />

        {/* Floating Quick Action Overlay (Turntable, Wireframe, Snapshot) */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-white/90 backdrop-blur-md p-1 rounded-xl border border-[#D5C7B0] shadow-sm text-xs">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle 360° Turntable Rotation"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              autoRotate ? 'bg-[#8B5A2B] text-white font-medium' : 'text-[#555] hover:bg-[#F2ECE1]'
            }`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
            <span>Turntable</span>
          </button>

          <button
            onClick={() => setWireframe(!wireframe)}
            title="Toggle Polygonal Wireframe"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              wireframe ? 'bg-[#1A1A1E] text-white font-medium' : 'text-[#555] hover:bg-[#F2ECE1]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Wireframe</span>
          </button>

          <button
            onClick={handleCaptureSnapshot}
            title="Capture Snapshot Image"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#555] hover:bg-[#F2ECE1] transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-[#8B5A2B]" />
            <span>Snap</span>
          </button>
        </div>

        {/* Live Active Specification Floating Badge */}
        <div className="absolute bottom-3 left-3 bg-[#1A1A1E]/85 backdrop-blur-md text-white text-[11px] px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg">
          <span className="w-2.5 h-2.5 rounded-full border border-white/30" style={{ backgroundColor: currentColorHex }} />
          <span className="font-semibold">{category}</span>
          <span className="text-white/40">•</span>
          <span>{material}</span>
          <span className="text-white/40">•</span>
          <span>{color}</span>
          <span className="text-white/40">•</span>
          <span className="text-white/70">{finish}</span>
        </div>

        {/* Success Alert Toast */}
        {exportSuccessMsg && (
          <div className="absolute top-3 right-3 bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-1.5 animate-in fade-in duration-200">
            <Check className="w-3.5 h-3.5" />
            <span>{exportSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* 3D Model Download & Export Action Strip */}
      <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
        <div className="text-[11px] text-[#78716C] flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-[#8B5A2B]" />
          <span>Export 3D model for Blender, Unity, Unreal Engine & CAD</span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Download GLTF / GLB */}
          <button
            onClick={handleExportGLB}
            disabled={isExporting}
            className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-[#8B5A2B] hover:bg-[#724822] text-white font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .GLB (3D)</span>
          </button>

          {/* Download Wavefront OBJ */}
          <button
            onClick={handleExportOBJ}
            disabled={isExporting}
            className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-white hover:bg-[#F2ECE1] border border-[#D5C7B0] text-[#5C3818] font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .OBJ</span>
          </button>
        </div>
      </div>
    </div>
  );
}
