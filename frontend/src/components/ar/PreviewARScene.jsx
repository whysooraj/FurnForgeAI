import React, { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Grid, Html, OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Loader2 } from 'lucide-react';
import { getCategoryDimensions, prepareGLBScene } from '../../utils/glbUtils';

const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const RAYCAST_HIT = new THREE.Vector3();

function PreviewFloorReticle({ position, visible, isReady }) {
  const ringRef = useRef(null);
  const pulseRef = useRef(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringRef.current) ringRef.current.rotation.z = t * 0.45;
    if (pulseRef.current) {
      const s = 1 + Math.sin(t * 3.2) * 0.08;
      pulseRef.current.scale.set(s, s, 1);
    }
  });

  if (!visible) return null;
  const color = isReady ? '#F59E0B' : '#9CA3AF';

  return (
    <group position={[position[0], 0.005, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.26, 0.295, 48, 1, 0, Math.PI * 1.55]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.13, 0.155, 36]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.036, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function PreviewFurnitureMesh({
  url,
  category,
  itemDimensions,
  position,
  rotationDeg,
  userScale,
  showFootprint,
  dropTick,
  onStartDrag,
}) {
  const gltf = useLoader(GLTFLoader, url);
  const dims = getCategoryDimensions(category, itemDimensions);
  const groupRef = useRef(null);
  const dropProgressRef = useRef(0);

  const { scene, size } = useMemo(
    () =>
      prepareGLBScene(gltf.scene, {
        targetHeightMeters: dims.height,
        targetWidthMeters: dims.width,
        targetDepthMeters: dims.depth,
      }),
    [gltf.scene, dims.height, dims.width, dims.depth]
  );

  useEffect(() => {
    dropProgressRef.current = 0;
  }, [dropTick, url]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (dropProgressRef.current < 1) {
      dropProgressRef.current = Math.min(1, dropProgressRef.current + delta * 5);
      const ease = 1 - Math.pow(1 - dropProgressRef.current, 3);
      groupRef.current.position.y = (1 - ease) * 0.12;
    } else {
      groupRef.current.position.y = 0;
    }
  });

  const footprintRadius = Math.max(size.x, size.z, 0.5) * 0.62;
  const rotRad = (rotationDeg * Math.PI) / 180;

  return (
    <group position={[position[0], 0, position[2]]}>
      <group
        ref={groupRef}
        rotation={[0, rotRad, 0]}
        scale={[userScale, userScale, userScale]}
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartDrag?.(e);
        }}
      >
        <primitive object={scene} />
      </group>

      {showFootprint && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
          <ringGeometry args={[footprintRadius * userScale, footprintRadius * userScale + 0.025, 48]} />
          <meshBasicMaterial color="#F59E0B" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function PreviewFloorCameraRig({ floorTiltDeg, isOrbitMode }) {
  const { camera } = useThree();

  useEffect(() => {
    if (isOrbitMode) {
      camera.position.set(1.65, 1.25, 2.25);
      camera.lookAt(0, 0.35, 0);
      camera.updateProjectionMatrix();
      return;
    }
    const rad = THREE.MathUtils.degToRad(Math.max(6, Math.min(45, floorTiltDeg)));
    const camHeight = 1.25;
    const camDist = THREE.MathUtils.clamp(camHeight / Math.tan(rad), 1.6, 4.4);
    camera.position.set(0, camHeight, camDist);
    camera.lookAt(0, 0.25, -0.35);
    camera.updateProjectionMatrix();
  }, [camera, floorTiltDeg, isOrbitMode]);

  return null;
}

export default function PreviewARScene({
  glbUrl,
  category,
  itemDimensions,
  isOrbitMode,
  placementState,
  dropTick,
  reticlePos,
  setReticlePos,
  placedPos,
  setPlacedPos,
  rotationDeg,
  setRotationDeg,
  userScale,
  setUserScale,
  floorTiltDeg,
  lightExposure,
  isInteracting,
  setIsInteracting,
  onPlaceAt,
  onWebGLReady,
}) {
  const { gl, camera } = useThree();
  const dragModeRef = useRef(null);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const lastClientXRef = useRef(0);
  const touchStateRef = useRef({ dist: 0, angle: 0, active: false });

  useEffect(() => {
    gl.toneMappingExposure = lightExposure;
  }, [gl, lightExposure]);

  useEffect(() => {
    onWebGLReady?.(gl.domElement);
  }, [gl, onWebGLReady]);

  const raycastFloor = useCallback(
    (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const hit = raycaster.ray.intersectPlane(FLOOR_PLANE, RAYCAST_HIT);
      if (!hit) return null;
      return [
        THREE.MathUtils.clamp(hit.x, -2.3, 2.3),
        0,
        THREE.MathUtils.clamp(hit.z, -3.2, 1.3),
      ];
    },
    [gl, camera]
  );

  useEffect(() => {
    if (isOrbitMode) return undefined;
    const dom = gl.domElement;

    const handlePointerMove = (e) => {
      if (touchStateRef.current.active) return;

      if (placementState === 'scanning') {
        const hit = raycastFloor(e.clientX, e.clientY);
        if (hit) setReticlePos(hit);
        return;
      }

      if (!dragModeRef.current) return;
      if (dragModeRef.current === 'rotate') {
        const dx = e.clientX - lastClientXRef.current;
        lastClientXRef.current = e.clientX;
        setRotationDeg((prev) => (prev + dx * 0.7 + 360) % 360);
        return;
      }

      const hit = raycastFloor(e.clientX, e.clientY);
      if (hit) {
        setPlacedPos([
          THREE.MathUtils.clamp(hit[0] - dragOffsetRef.current.x, -2.3, 2.3),
          0,
          THREE.MathUtils.clamp(hit[2] - dragOffsetRef.current.z, -3.2, 1.3),
        ]);
      }
    };

    const handlePointerDown = (e) => {
      if (e.pointerType === 'touch' && !e.isPrimary) return;

      if (placementState === 'scanning') {
        if (!glbUrl) return;
        const hit = raycastFloor(e.clientX, e.clientY) || reticlePos;
        onPlaceAt(hit);
        return;
      }

      if (e.shiftKey) {
        dragModeRef.current = 'rotate';
        lastClientXRef.current = e.clientX;
        setIsInteracting(true);
        return;
      }

      const hit = raycastFloor(e.clientX, e.clientY);
      if (hit) {
        dragOffsetRef.current.set(hit[0] - placedPos[0], 0, hit[2] - placedPos[2]);
        dragModeRef.current = 'move';
        setIsInteracting(true);
      }
    };

    const handlePointerUp = () => {
      dragModeRef.current = null;
      setIsInteracting(false);
    };

    const handleWheel = (e) => {
      if (placementState !== 'placed') return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.06 : 0.06;
      setUserScale((s) => Number(THREE.MathUtils.clamp(s + delta, 0.5, 2.0).toFixed(2)));
    };

    const getTouchMetrics = (t1, t2) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return {
        dist: Math.hypot(dx, dy),
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2 && placementState === 'placed') {
        const metrics = getTouchMetrics(e.touches[0], e.touches[1]);
        touchStateRef.current = { ...metrics, active: true };
        dragModeRef.current = null;
        setIsInteracting(true);
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2 && touchStateRef.current.active && placementState === 'placed') {
        e.preventDefault();
        const metrics = getTouchMetrics(e.touches[0], e.touches[1]);
        const scaleRatio = metrics.dist / Math.max(touchStateRef.current.dist, 1);
        const angleDelta = metrics.angle - touchStateRef.current.angle;
        touchStateRef.current.dist = metrics.dist;
        touchStateRef.current.angle = metrics.angle;

        setUserScale((s) => Number(THREE.MathUtils.clamp(s * scaleRatio, 0.5, 2.0).toFixed(2)));
        setRotationDeg((prev) => (prev + angleDelta * 1.15 + 360) % 360);
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        touchStateRef.current.active = false;
        setIsInteracting(false);
      }
    };

    dom.addEventListener('pointermove', handlePointerMove);
    dom.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    dom.addEventListener('wheel', handleWheel, { passive: false });
    dom.addEventListener('touchstart', handleTouchStart, { passive: true });
    dom.addEventListener('touchmove', handleTouchMove, { passive: false });
    dom.addEventListener('touchend', handleTouchEnd);

    return () => {
      dom.removeEventListener('pointermove', handlePointerMove);
      dom.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      dom.removeEventListener('wheel', handleWheel);
      dom.removeEventListener('touchstart', handleTouchStart);
      dom.removeEventListener('touchmove', handleTouchMove);
      dom.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    gl,
    glbUrl,
    isOrbitMode,
    placementState,
    placedPos,
    reticlePos,
    raycastFloor,
    setReticlePos,
    setPlacedPos,
    setRotationDeg,
    setUserScale,
    setIsInteracting,
    onPlaceAt,
  ]);

  const activePos = isOrbitMode ? [0, 0, 0] : placedPos;
  const shouldShowPlaced = (isOrbitMode || placementState === 'placed') && Boolean(glbUrl);

  return (
    <>
      <PreviewFloorCameraRig floorTiltDeg={floorTiltDeg} isOrbitMode={isOrbitMode} />

      {isOrbitMode && (
        <OrbitControls
          makeDefault
          target={[0, 0.38, 0]}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.8}
          maxDistance={6.5}
        />
      )}

      <ambientLight intensity={0.42 * lightExposure} />
      <hemisphereLight args={['#fffaf2', '#78716c', 0.48 * lightExposure]} />
      <directionalLight
        position={[2.8, 5.2, 3.0]}
        intensity={1.0 * lightExposure}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-2.5, 2.2, -2.0]} intensity={0.35 * lightExposure} />
      <Environment preset="apartment" environmentIntensity={0.42 * lightExposure} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <shadowMaterial transparent opacity={0.34} />
      </mesh>

      {isOrbitMode && (
        <Grid
          position={[0, 0.001, 0]}
          args={[8, 8]}
          cellSize={0.25}
          cellThickness={0.6}
          cellColor="#44403C"
          sectionSize={1}
          sectionThickness={1.1}
          sectionColor="#D97706"
          fadeDistance={6}
          infiniteGrid
        />
      )}

      {!isOrbitMode && (
        <PreviewFloorReticle
          position={reticlePos}
          visible={placementState === 'scanning'}
          isReady={Boolean(glbUrl)}
        />
      )}

      {shouldShowPlaced && (
        <>
          <Suspense
            fallback={
              <Html center position={[activePos[0], 0.45, activePos[2]]}>
                <div className="px-3.5 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap shadow-xl">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Loading 3D mesh...</span>
                </div>
              </Html>
            }
          >
            <PreviewFurnitureMesh
              url={glbUrl}
              category={category}
              itemDimensions={itemDimensions}
              position={activePos}
              rotationDeg={rotationDeg}
              userScale={userScale}
              showFootprint={!isOrbitMode && isInteracting}
              dropTick={dropTick}
              onStartDrag={(e) => {
                if (isOrbitMode) return;
                const hit = raycastFloor(e.clientX, e.clientY);
                if (hit) {
                  dragOffsetRef.current.set(hit[0] - placedPos[0], 0, hit[2] - placedPos[2]);
                  dragModeRef.current = 'move';
                  setIsInteracting(true);
                }
              }}
            />
          </Suspense>

          <ContactShadows
            position={[activePos[0], 0.002, activePos[2]]}
            opacity={0.44}
            scale={3.2 * userScale}
            blur={2.2}
            far={1.8}
          />
        </>
      )}
    </>
  );
}
