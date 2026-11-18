import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Loader2 } from 'lucide-react';
import { getCategoryDimensions, prepareGLBScene } from '../../utils/glbUtils';

const UP_VEC = new THREE.Vector3(0, 1, 0);

function GroundedARFurniture({ url, category, itemDimensions, rotationDeg, userScale }) {
  const gltf = useLoader(GLTFLoader, url);
  const dims = getCategoryDimensions(category, itemDimensions);

  const { scene, size } = useMemo(
    () =>
      prepareGLBScene(gltf.scene, {
        targetHeightMeters: dims.height,
        targetWidthMeters: dims.width,
        targetDepthMeters: dims.depth,
      }),
    [gltf.scene, dims.height, dims.width, dims.depth]
  );

  const rotRad = (rotationDeg * Math.PI) / 180;
  const shadowScale = Math.max(size.x, size.z, 0.8) * 2.2 * userScale;

  return (
    <group>
      <group rotation={[0, rotRad, 0]} scale={[userScale, userScale, userScale]}>
        <primitive object={scene} />
      </group>

      {/* Floor shadow catcher anchored directly to the real-world detected floor plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <shadowMaterial transparent opacity={0.36} />
      </mesh>

      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.46}
        scale={shadowScale}
        blur={2.1}
        far={1.6}
      />
    </group>
  );
}

/**
 * Extract an upright matrix (preserving world X/Y/Z translation and yaw, keeping furniture vertical).
 */
function buildUprightSurfaceMatrix(sourceMatrix, outMatrix) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  sourceMatrix.decompose(pos, quat, scale);

  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
  const uprightQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'));
  outMatrix.compose(pos, uprightQuat, new THREE.Vector3(1, 1, 1));
  return outMatrix;
}

export default function WebXRARScene({
  glbUrl,
  category,
  itemDimensions,
  webXRSession,
  placementState,
  rotationDeg,
  userScale,
  lightExposure,
  onStatusChange,
  onCapabilitiesReport,
  onPlaced,
  onExitWebXR,
  placeTriggerTick,
  resetPositionTick,
  removeTick,
}) {
  const { gl } = useThree();

  const reticleGroupRef = useRef(null);
  const ringMeshRef = useRef(null);
  const anchorGroupRef = useRef(null);
  const dirLightRef = useRef(null);
  const hemiLightRef = useRef(null);

  const hitTestSourceRef = useRef(null);
  const transientHitSourceRef = useRef(null);
  const lightProbeRef = useRef(null);

  const latestHitResultRef = useRef(null);
  const latestHitMatrixRef = useRef(new THREE.Matrix4());
  const hasValidSurfaceRef = useRef(false);

  const anchorRef = useRef(null);
  const fixedWorldMatrixRef = useRef(new THREE.Matrix4());
  const initialWorldMatrixRef = useRef(null);
  const isDraggingRef = useRef(false);
  const pendingActionRef = useRef(null); // 'place' | 'reanchor' | null
  const statusTagRef = useRef('scanning');
  const depthReportedRef = useRef(false);
  const placementStateRef = useRef(placementState);
  const glbUrlRef = useRef(glbUrl);

  useEffect(() => {
    placementStateRef.current = placementState;
  }, [placementState]);

  useEffect(() => {
    glbUrlRef.current = glbUrl;
  }, [glbUrl]);

  const emitStatus = (tag, text) => {
    if (statusTagRef.current !== tag) {
      statusTagRef.current = tag;
      onStatusChange?.(tag, text);
    }
  };

  useEffect(() => {
    gl.toneMappingExposure = lightExposure;
  }, [gl, lightExposure]);

  // Triggered when user taps the "Place" CTA button inside DOM Overlay
  useEffect(() => {
    if (placeTriggerTick > 0 && hasValidSurfaceRef.current) {
      pendingActionRef.current = 'place';
    }
  }, [placeTriggerTick]);

  // Reset Position back to the initial real-world anchor pose
  useEffect(() => {
    if (resetPositionTick > 0 && initialWorldMatrixRef.current && anchorGroupRef.current) {
      fixedWorldMatrixRef.current.copy(initialWorldMatrixRef.current);
      anchorGroupRef.current.matrix.copy(initialWorldMatrixRef.current);
      anchorGroupRef.current.matrixWorldNeedsUpdate = true;
      pendingActionRef.current = 'reanchor_initial';
    }
  }, [resetPositionTick]);

  // Remove / Reset Placement
  useEffect(() => {
    if (removeTick > 0) {
      if (anchorRef.current) {
        try {
          anchorRef.current.delete();
        } catch {
          // ignore already deleted anchor
        }
        anchorRef.current = null;
      }
      initialWorldMatrixRef.current = null;
      emitStatus(
        hasValidSurfaceRef.current ? 'surface_detected' : 'detecting_floor',
        hasValidSurfaceRef.current
          ? 'Surface detected. Tap to place furniture.'
          : 'Detecting floor...'
      );
    }
  }, [removeTick]);

  // Initialize WebXR session, Hit-Test sources, Light Probe, and Select/Touch handlers
  useEffect(() => {
    if (!webXRSession) return undefined;

    let cancelled = false;
    depthReportedRef.current = false;
    hasValidSurfaceRef.current = false;
    emitStatus('scanning', 'Scanning environment...');

    async function setupXR() {
      try {
        gl.xr.enabled = true;
        if (gl.xr.setReferenceSpaceType) {
          gl.xr.setReferenceSpaceType('local-floor');
        }
        await gl.xr.setSession(webXRSession);

        const viewerSpace = await webXRSession.requestReferenceSpace('viewer');
        if (cancelled) return;

        if (webXRSession.requestHitTestSource) {
          hitTestSourceRef.current = await webXRSession.requestHitTestSource({ space: viewerSpace });
        }

        if (webXRSession.requestHitTestSourceForTransientInput) {
          try {
            transientHitSourceRef.current = await webXRSession.requestHitTestSourceForTransientInput({
              profile: 'generic-touchscreen',
            });
          } catch {
            transientHitSourceRef.current = null;
          }
        }

        let hasLightEstimation = false;
        if (webXRSession.requestLightProbe) {
          try {
            lightProbeRef.current = await webXRSession.requestLightProbe();
            hasLightEstimation = true;
          } catch {
            lightProbeRef.current = null;
          }
        }

        const enabledFeatures = webXRSession.enabledFeatures
          ? Array.from(webXRSession.enabledFeatures)
          : [];

        onCapabilitiesReport?.({
          anchorsSupported: enabledFeatures.includes('anchors') || typeof XRFrame?.prototype?.createAnchor === 'function',
          planeDetectionSupported: enabledFeatures.includes('plane-detection'),
          lightEstimationSupported: hasLightEstimation,
          depthSensingSupported: enabledFeatures.includes('depth-sensing'),
          referenceSpace: gl.xr.getReferenceSpace ? 'local-floor' : 'local',
        });

        emitStatus('detecting_floor', 'Detecting floor...');
      } catch (err) {
        console.warn('WebXR initialization failed:', err);
      }
    }

    setupXR();

    const handleSelectStart = () => {
      if (placementStateRef.current === 'placed') {
        isDraggingRef.current = true;
      }
    };

    const handleSelectEnd = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        if (hasValidSurfaceRef.current) {
          pendingActionRef.current = 'reanchor';
        }
      }
    };

    const handleSelect = () => {
      if (cancelled || !glbUrlRef.current) return;
      if (!hasValidSurfaceRef.current) return;
      if (placementStateRef.current === 'scanning') {
        pendingActionRef.current = 'place';
      } else if (placementStateRef.current === 'placed') {
        pendingActionRef.current = 'reanchor';
      }
    };

    const handleSessionEnd = () => {
      if (anchorRef.current) {
        try {
          anchorRef.current.delete();
        } catch {
          // ignore
        }
        anchorRef.current = null;
      }
      hitTestSourceRef.current = null;
      transientHitSourceRef.current = null;
      lightProbeRef.current = null;
      gl.xr.enabled = false;
      onExitWebXR?.();
    };

    webXRSession.addEventListener('selectstart', handleSelectStart);
    webXRSession.addEventListener('selectend', handleSelectEnd);
    webXRSession.addEventListener('select', handleSelect);
    webXRSession.addEventListener('end', handleSessionEnd);

    return () => {
      cancelled = true;
      webXRSession.removeEventListener('selectstart', handleSelectStart);
      webXRSession.removeEventListener('selectend', handleSelectEnd);
      webXRSession.removeEventListener('select', handleSelect);
      webXRSession.removeEventListener('end', handleSessionEnd);

      [hitTestSourceRef.current, transientHitSourceRef.current].forEach((src) => {
        if (src) {
          try {
            src.cancel();
          } catch {
            // ignore
          }
        }
      });
      hitTestSourceRef.current = null;
      transientHitSourceRef.current = null;
      lightProbeRef.current = null;
      if (anchorRef.current) {
        try {
          anchorRef.current.delete();
        } catch {
          // ignore
        }
        anchorRef.current = null;
      }
      gl.xr.enabled = false;
    };
  }, [webXRSession, gl, onExitWebXR, onCapabilitiesReport]);

  const createAnchorAtHit = async (xrFrame, refSpace, hitResult, matrixFallback) => {
    if (anchorRef.current) {
      try {
        anchorRef.current.delete();
      } catch {
        // ignore
      }
      anchorRef.current = null;
    }

    let createdAnchor = null;
    if (hitResult && typeof hitResult.createAnchor === 'function') {
      try {
        createdAnchor = await hitResult.createAnchor();
      } catch {
        createdAnchor = null;
      }
    }

    if (!createdAnchor && xrFrame && typeof xrFrame.createAnchor === 'function') {
      try {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        matrixFallback.decompose(pos, quat, scl);
        const transform = new XRRigidTransform(
          { x: pos.x, y: pos.y, z: pos.z, w: 1 },
          { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
        );
        createdAnchor = await xrFrame.createAnchor(transform, refSpace);
      } catch {
        createdAnchor = null;
      }
    }

    anchorRef.current = createdAnchor;
    onCapabilitiesReport?.({ anchorActive: Boolean(createdAnchor) });
  };

  useFrame((state, _, xrFrame) => {
    if (!webXRSession || !xrFrame) return;

    const refSpace = gl.xr.getReferenceSpace();
    if (!refSpace) return;

    // Spin reticle smoothly
    if (ringMeshRef.current && reticleGroupRef.current?.visible) {
      ringMeshRef.current.rotation.z = state.clock.getElapsedTime() * 0.55;
    }

    // 1. Check horizontal planes if plane-detection is supported
    if (xrFrame.detectedPlanes && statusTagRef.current === 'scanning') {
      for (const plane of xrFrame.detectedPlanes) {
        if (plane.orientation === 'horizontal') {
          emitStatus('detecting_floor', 'Detecting floor...');
          break;
        }
      }
    }

    // 2. Evaluate transient touchscreen hit-test first (for touch tap/drag), then center viewer hit-test
    let activeHit = null;
    let activePose = null;

    if (transientHitSourceRef.current) {
      const transientResults = xrFrame.getHitTestResultsForTransientInput(
        transientHitSourceRef.current
      );
      if (transientResults && transientResults.length > 0 && transientResults[0].results.length > 0) {
        const cand = transientResults[0].results[0];
        const pose = cand.getPose(refSpace);
        if (pose) {
          const q = pose.transform.orientation;
          const normal = UP_VEC.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
          if (normal.y >= 0.72) {
            activeHit = cand;
            activePose = pose;
          }
        }
      }
    }

    if (!activePose && hitTestSourceRef.current) {
      const hitResults = xrFrame.getHitTestResults(hitTestSourceRef.current);
      for (const cand of hitResults) {
        const pose = cand.getPose(refSpace);
        if (!pose) continue;
        const q = pose.transform.orientation;
        const normal = UP_VEC.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        if (normal.y >= 0.72) {
          activeHit = cand;
          activePose = pose;
          break;
        }
      }
    }

    if (activePose) {
      hasValidSurfaceRef.current = true;
      latestHitResultRef.current = activeHit;
      latestHitMatrixRef.current.fromArray(activePose.transform.matrix);

      if (reticleGroupRef.current) {
        reticleGroupRef.current.visible = placementState === 'scanning';
        reticleGroupRef.current.matrix.copy(latestHitMatrixRef.current);
        reticleGroupRef.current.matrixWorldNeedsUpdate = true;
      }

      if (placementState === 'scanning') {
        emitStatus('surface_detected', 'Surface detected. Tap to place furniture.');
      }
    } else if (reticleGroupRef.current && placementState === 'scanning') {
      reticleGroupRef.current.visible = false;
    }

    // 3. Process pending placement / re-anchoring inside active XRFrame
    if (pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;

      if ((action === 'place' || action === 'reanchor') && hasValidSurfaceRef.current) {
        const uprightMatrix = buildUprightSurfaceMatrix(
          latestHitMatrixRef.current,
          fixedWorldMatrixRef.current
        );
        if (action === 'place' || !initialWorldMatrixRef.current) {
          initialWorldMatrixRef.current = uprightMatrix.clone();
        }
        if (anchorGroupRef.current) {
          anchorGroupRef.current.matrix.copy(uprightMatrix);
          anchorGroupRef.current.matrixWorldNeedsUpdate = true;
        }
        createAnchorAtHit(xrFrame, refSpace, latestHitResultRef.current, uprightMatrix);
        if (action === 'place') {
          onPlaced?.();
        }
        emitStatus('placed', 'Furniture successfully placed.');
      } else if (action === 'reanchor_initial' && initialWorldMatrixRef.current) {
        createAnchorAtHit(xrFrame, refSpace, null, initialWorldMatrixRef.current);
        emitStatus('placed', 'Furniture successfully placed.');
      }
    }

    // 4. Live drag tracking along detected surface
    if (placementState === 'placed' && isDraggingRef.current && activePose && anchorGroupRef.current) {
      const dragMatrix = buildUprightSurfaceMatrix(
        latestHitMatrixRef.current,
        fixedWorldMatrixRef.current
      );
      anchorGroupRef.current.matrix.copy(dragMatrix);
      anchorGroupRef.current.matrixWorldNeedsUpdate = true;
    } else if (placementState === 'placed' && anchorGroupRef.current) {
      // Lock placed furniture to persistent XRAnchor every frame
      if (anchorRef.current) {
        const anchorPose = xrFrame.getPose(anchorRef.current.anchorSpace, refSpace);
        if (anchorPose) {
          const rawMat = new THREE.Matrix4().fromArray(anchorPose.transform.matrix);
          buildUprightSurfaceMatrix(rawMat, fixedWorldMatrixRef.current);
        }
      }
      anchorGroupRef.current.matrix.copy(fixedWorldMatrixRef.current);
      anchorGroupRef.current.matrixWorldNeedsUpdate = true;
    }

    // 5. WebXR Lighting Estimation
    if (lightProbeRef.current && xrFrame.getLightEstimate) {
      const estimate = xrFrame.getLightEstimate(lightProbeRef.current);
      if (estimate) {
        if (dirLightRef.current && estimate.primaryLightDirection) {
          const d = estimate.primaryLightDirection;
          dirLightRef.current.position.set(d.x * 4, Math.max(d.y * 4, 1.5), d.z * 4);
        }
        if (dirLightRef.current && estimate.primaryLightIntensity) {
          const i = estimate.primaryLightIntensity;
          dirLightRef.current.color.setRGB(i.x, i.y, i.z);
          dirLightRef.current.intensity = THREE.MathUtils.clamp(
            Math.max(i.x, i.y, i.z) * lightExposure,
            0.35,
            2.2
          );
        }
        if (hemiLightRef.current && estimate.sphericalHarmonicsCoefficients) {
          const c = estimate.sphericalHarmonicsCoefficients;
          const avg = Math.max(0.25, (c[0] + c[1] + c[2]) / 3);
          hemiLightRef.current.intensity = THREE.MathUtils.clamp(avg * 0.65 * lightExposure, 0.25, 1.2);
        }
      }
    }

    // 6. Report hardware depth availability once per session without faking occlusion
    if (!depthReportedRef.current && xrFrame.getDepthInformation) {
      try {
        const viewerPose = xrFrame.getViewerPose(refSpace);
        if (viewerPose && viewerPose.views.length > 0) {
          const depthInfo = xrFrame.getDepthInformation(viewerPose.views[0]);
          depthReportedRef.current = true;
          onCapabilitiesReport?.({ depthOcclusionAvailable: Boolean(depthInfo) });
        }
      } catch {
        depthReportedRef.current = true;
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.35 * lightExposure} />
      <hemisphereLight ref={hemiLightRef} args={['#fffaf2', '#78716c', 0.48 * lightExposure]} />
      <directionalLight
        ref={dirLightRef}
        position={[2.5, 4.8, 2.8]}
        intensity={1.05 * lightExposure}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.2}
        shadow-camera-far={12}
        shadow-camera-left={-2.5}
        shadow-camera-right={2.5}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-2.5}
      />
      <Environment preset="apartment" environmentIntensity={0.4 * lightExposure} />

      {/* Floor Hit-Test Reticle (oriented strictly to detected XR surface pose) */}
      <group ref={reticleGroupRef} matrixAutoUpdate={false} visible={false}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <mesh ref={ringMeshRef}>
            <ringGeometry args={[0.24, 0.275, 48, 1, 0, Math.PI * 1.55]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <ringGeometry args={[0.12, 0.14, 36]} />
            <meshBasicMaterial color="#FFFFFF" transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <circleGeometry args={[0.032, 24]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>

      {/* World-Anchored Furniture Root */}
      <group
        ref={anchorGroupRef}
        matrixAutoUpdate={false}
        visible={placementState === 'placed' && Boolean(glbUrl)}
      >
        {placementState === 'placed' && glbUrl && (
          <Suspense
            fallback={
              <Html center position={[0, 0.45, 0]}>
                <div className="px-3.5 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap shadow-xl">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Anchoring 3D furniture...</span>
                </div>
              </Html>
            }
          >
            <GroundedARFurniture
              url={glbUrl}
              category={category}
              itemDimensions={itemDimensions}
              rotationDeg={rotationDeg}
              userScale={userScale}
            />
          </Suspense>
        )}
      </group>
    </>
  );
}
