import * as THREE from 'three';

export const CATEGORY_REAL_DIMENSIONS = {
  Chair: { height: 0.82, width: 0.68, depth: 0.70, label: '82 × 68 × 70 cm' },
  Sofa: { height: 0.84, width: 2.05, depth: 0.92, label: '84 × 205 × 92 cm' },
  Table: { height: 0.75, width: 1.50, depth: 0.90, label: '75 × 150 × 90 cm' },
  Bed: { height: 1.05, width: 1.85, depth: 2.15, label: '105 × 185 × 215 cm' },
  Cabinet: { height: 0.85, width: 1.45, depth: 0.48, label: '85 × 145 × 48 cm' },
};

function toMeters(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Values > 10 are treated as centimeters (e.g. 82 cm -> 0.82 m)
  return num > 10 ? num / 100 : num;
}

export function getCategoryDimensions(category, itemDimensions = null) {
  const base = CATEGORY_REAL_DIMENSIONS[category] || {
    height: 0.85,
    width: 0.90,
    depth: 0.85,
    label: '85 × 90 × 85 cm',
  };

  if (!itemDimensions || typeof itemDimensions !== 'object') {
    return base;
  }

  const h = toMeters(itemDimensions.height_cm ?? itemDimensions.height) ?? base.height;
  const w = toMeters(itemDimensions.width_cm ?? itemDimensions.width) ?? base.width;
  const d = toMeters(itemDimensions.depth_cm ?? itemDimensions.depth) ?? base.depth;

  return {
    height: h,
    width: w,
    depth: d,
    label: `${Math.round(h * 100)} × ${Math.round(w * 100)} × ${Math.round(d * 100)} cm`,
  };
}

/**
 * Clone a loaded GLTF scene, normalize surface shading/normals, align its
 * bottom bounding plane exactly to local y = 0 (centered on X/Z), and scale
 * uniformly to real-world meter dimensions while preserving proportions.
 */
export function prepareGLBScene(
  gltfScene,
  { targetHeightMeters = null, targetWidthMeters = null, targetDepthMeters = null, targetMaxDim = 1.55 } = {}
) {
  const cloned = gltfScene.clone(true);
  cloned.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(cloned);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  let scale;
  if (targetHeightMeters) {
    scale = targetHeightMeters / Math.max(size.y, 0.001);
  } else if (targetWidthMeters && targetDepthMeters) {
    const sx = targetWidthMeters / Math.max(size.x, 0.001);
    const sz = targetDepthMeters / Math.max(size.z, 0.001);
    scale = (sx + sz) * 0.5;
  } else {
    scale = targetMaxDim / Math.max(size.x, size.y, size.z, 0.001);
  }

  cloned.scale.setScalar(scale);
  cloned.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  cloned.updateMatrixWorld(true);

  // Verify exact floor grounding (min.y === 0)
  const groundedBox = new THREE.Box3().setFromObject(cloned);
  if (Math.abs(groundedBox.min.y) > 1e-4) {
    cloned.position.y -= groundedBox.min.y;
    cloned.updateMatrixWorld(true);
  }

  cloned.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (!obj.geometry?.attributes?.normal && obj.geometry?.computeVertexNormals) {
        obj.geometry.computeVertexNormals();
      }
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((mat) => {
          mat.flatShading = false;
          if (obj.geometry?.attributes?.color && !mat.map) {
            mat.vertexColors = true;
            mat.roughness = 0.78;
            mat.metalness = 0.04;
            mat.envMapIntensity = 0.35;
          }
          mat.needsUpdate = true;
        });
      }
    }
  });

  const finalBox = new THREE.Box3().setFromObject(cloned);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  return {
    scene: cloned,
    size: { x: finalSize.x, y: finalSize.y, z: finalSize.z },
    bounds: {
      minY: finalBox.min.y,
      maxY: finalBox.max.y,
    },
    scale,
  };
}
