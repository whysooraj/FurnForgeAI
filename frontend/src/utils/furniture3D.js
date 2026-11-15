import * as THREE from 'three';

/**
 * Procedural PBR Texture Generators for realistic furniture materials
 */
function createNoiseTexture(type = 'leather') {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  if (type === 'wood') {
    // Wood grain rings
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const dist = Math.sqrt((x - size * 0.5) ** 2 + ((y - size * 0.5) * 4) ** 2);
        const ring = Math.sin(dist * 0.08 + Math.sin(y * 0.04) * 2.0);
        const val = Math.floor(128 + ring * 60 + (Math.random() - 0.5) * 15);
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }
  } else if (type === 'fabric') {
    // Boucle / Linen weave
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const wx = Math.sin(x * 0.8) * 0.5 + 0.5;
        const wy = Math.sin(y * 0.8) * 0.5 + 0.5;
        const weave = (wx * wy + (Math.random() - 0.5) * 0.2) * 255;
        const val = Math.floor(Math.max(0, Math.min(255, weave)));
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }
  } else {
    // Leather pebble grain
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const p1 = Math.sin(x * 0.25) * Math.cos(y * 0.25);
        const p2 = Math.sin(x * 0.5 + y * 0.5) * 0.5;
        const noise = (p1 + p2 + (Math.random() - 0.5) * 0.3) * 128 + 128;
        const val = Math.floor(Math.max(0, Math.min(255, noise)));
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(type === 'wood' ? 2 : 4, type === 'wood' ? 4 : 4);
  return texture;
}

/**
 * Build PBR Material based on Category, Material, Color, and Finish
 */
export function createPBRMaterial(materialType, colorHex, finish = 'Matte') {
  const color = new THREE.Color(colorHex);
  const finishLower = (finish || 'matte').toLowerCase();
  const matLower = (materialType || 'wood').toLowerCase();

  let roughness = 0.6;
  let metalness = 0.05;
  let clearcoat = 0.0;
  let clearcoatRoughness = 0.1;
  let transmission = 0.0;
  let bumpScale = 0.015;
  let bumpMap = null;

  if (finishLower === 'matte') {
    roughness = 0.85;
    metalness = matLower === 'metal' ? 0.35 : 0.02;
  } else if (finishLower === 'glossy') {
    roughness = 0.18;
    clearcoat = 0.85;
    clearcoatRoughness = 0.08;
    metalness = matLower === 'metal' ? 0.85 : 0.08;
  } else if (finishLower === 'polished') {
    roughness = 0.28;
    clearcoat = 0.55;
    metalness = matLower === 'metal' ? 0.75 : 0.05;
  } else if (finishLower === 'brushed') {
    roughness = 0.42;
    metalness = matLower === 'metal' ? 0.90 : 0.15;
    bumpScale = 0.03;
  }

  if (matLower === 'metal') {
    metalness = Math.max(metalness, 0.75);
    bumpMap = createNoiseTexture('fabric');
  } else if (matLower === 'glass') {
    return new THREE.MeshPhysicalMaterial({
      color: color.clone().lerp(new THREE.Color('#FFFFFF'), 0.3),
      transmission: 0.92,
      opacity: 0.85,
      transparent: true,
      roughness: finishLower === 'matte' ? 0.35 : 0.08,
      ior: 1.52,
      thickness: 0.6,
      reflectivity: 0.7,
      specularIntensity: 1.0,
      side: THREE.DoubleSide
    });
  } else if (matLower === 'leather') {
    bumpMap = createNoiseTexture('leather');
    bumpScale = 0.025;
    roughness = Math.max(roughness, 0.45);
  } else if (matLower === 'fabric') {
    bumpMap = createNoiseTexture('fabric');
    bumpScale = 0.035;
    roughness = Math.max(roughness, 0.75);
    metalness = 0.0;
  } else {
    // Wood
    bumpMap = createNoiseTexture('wood');
    bumpScale = 0.02;
  }

  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness,
    bumpMap,
    bumpScale,
    reflectivity: 0.5,
    specularIntensity: 0.8,
    side: THREE.DoubleSide
  });
}

/**
 * Secondary accent material for legs / structural frame
 */
export function createAccentMaterial(primaryMaterial, colorHex) {
  const matLower = (primaryMaterial || '').toLowerCase();
  if (matLower === 'metal') {
    // Deep graphite accent
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2C2C30'),
      metalness: 0.85,
      roughness: 0.3
    });
  }
  // Architectural dark wood / brushed brass accent
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3A2A1D'),
    metalness: 0.25,
    roughness: 0.5
  });
}

// --------------------------------------------------------------------------
// 3D Furniture Geometry Generators
// --------------------------------------------------------------------------

/**
 * 1. Chair 3D Model
 */
export function buildChairGeometry(group, primaryMat, accentMat) {
  // Seat Cushion
  const seatGeo = new THREE.BoxGeometry(1.6, 0.25, 1.6);
  const seatMesh = new THREE.Mesh(seatGeo, primaryMat);
  seatMesh.position.y = 1.4;
  seatMesh.castShadow = true;
  seatMesh.receiveShadow = true;
  group.add(seatMesh);

  // Curved Backrest
  const backGeo = new THREE.BoxGeometry(1.5, 1.6, 0.18);
  const backMesh = new THREE.Mesh(backGeo, primaryMat);
  backMesh.position.set(0, 2.3, -0.72);
  backMesh.rotation.x = -0.08;
  backMesh.castShadow = true;
  backMesh.receiveShadow = true;
  group.add(backMesh);

  // Armrests
  const armGeo = new THREE.BoxGeometry(0.16, 0.12, 1.4);
  const leftArm = new THREE.Mesh(armGeo, primaryMat);
  leftArm.position.set(-0.84, 1.95, -0.05);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, primaryMat);
  rightArm.position.set(0.84, 1.95, -0.05);
  rightArm.castShadow = true;
  group.add(rightArm);

  // Armrest supports
  const armSupportGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 16);
  const leftSupp = new THREE.Mesh(armSupportGeo, accentMat);
  leftSupp.position.set(-0.84, 1.65, 0.45);
  group.add(leftSupp);

  const rightSupp = new THREE.Mesh(armSupportGeo, accentMat);
  rightSupp.position.set(0.84, 1.65, 0.45);
  group.add(rightSupp);

  // 4 Tapered Architectural Legs
  const legGeo = new THREE.CylinderGeometry(0.04, 0.025, 1.35, 16);
  const legCoords = [
    [-0.65, 0.68, -0.65, -0.08, 0.08],
    [0.65, 0.68, -0.65, -0.08, -0.08],
    [-0.65, 0.68, 0.65, 0.08, 0.08],
    [0.65, 0.68, 0.65, 0.08, -0.08]
  ];

  legCoords.forEach(([x, y, z, rotX, rotZ]) => {
    const leg = new THREE.Mesh(legGeo, accentMat);
    leg.position.set(x, y, z);
    leg.rotation.x = rotX;
    leg.rotation.z = rotZ;
    leg.castShadow = true;
    group.add(leg);

    // Brass foot ferrule
    const capGeo = new THREE.CylinderGeometry(0.03, 0.026, 0.15, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, metalness: 0.9, roughness: 0.2 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, 0.1, z);
    group.add(cap);
  });
}

/**
 * 2. Sofa 3D Model
 */
export function buildSofaGeometry(group, primaryMat, accentMat) {
  // Main seat base cushion
  const baseGeo = new THREE.BoxGeometry(3.6, 0.45, 1.8);
  const baseMesh = new THREE.Mesh(baseGeo, primaryMat);
  baseMesh.position.y = 0.9;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  group.add(baseMesh);

  // 3 Plush Individual Seat Cushions
  for (let i = -1; i <= 1; i++) {
    const cGeo = new THREE.BoxGeometry(1.12, 0.25, 1.6);
    const cMesh = new THREE.Mesh(cGeo, primaryMat);
    cMesh.position.set(i * 1.16, 1.25, 0.05);
    cMesh.castShadow = true;
    group.add(cMesh);

    // Backrest cushions
    const bGeo = new THREE.BoxGeometry(1.12, 1.1, 0.35);
    const bMesh = new THREE.Mesh(bGeo, primaryMat);
    bMesh.position.set(i * 1.16, 1.85, -0.72);
    bMesh.rotation.x = -0.08;
    bMesh.castShadow = true;
    group.add(bMesh);
  }

  // Left & Right Armrests
  const armGeo = new THREE.BoxGeometry(0.35, 0.9, 1.85);
  const leftArm = new THREE.Mesh(armGeo, primaryMat);
  leftArm.position.set(-1.85, 1.35, 0.0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, primaryMat);
  rightArm.position.set(1.85, 1.35, 0.0);
  rightArm.castShadow = true;
  group.add(rightArm);

  // 4 Low Minimalist Cylindrical Legs
  const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.65, 16);
  const legPositions = [
    [-1.6, 0.33, -0.75],
    [1.6, 0.33, -0.75],
    [-1.6, 0.33, 0.75],
    [1.6, 0.33, 0.75]
  ];
  legPositions.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, accentMat);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    group.add(leg);
  });
}

/**
 * 3. Table 3D Model
 */
export function buildTableGeometry(group, primaryMat, accentMat) {
  // Beveled rectangular or pill tabletop
  const topGeo = new THREE.BoxGeometry(3.4, 0.16, 2.0);
  const topMesh = new THREE.Mesh(topGeo, primaryMat);
  topMesh.position.y = 2.2;
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // Apron structural rim under top
  const apronGeo = new THREE.BoxGeometry(3.0, 0.12, 1.6);
  const apronMesh = new THREE.Mesh(apronGeo, accentMat);
  apronMesh.position.y = 2.06;
  apronMesh.castShadow = true;
  group.add(apronMesh);

  // 4 Architectural Scandinavian Legs
  const legGeo = new THREE.CylinderGeometry(0.065, 0.04, 2.05, 16);
  const legCoords = [
    [-1.4, 1.05, -0.75, -0.06, 0.06],
    [1.4, 1.05, -0.75, -0.06, -0.06],
    [-1.4, 1.05, 0.75, 0.06, 0.06],
    [1.4, 1.05, 0.75, 0.06, -0.06]
  ];

  legCoords.forEach(([x, y, z, rotX, rotZ]) => {
    const leg = new THREE.Mesh(legGeo, accentMat);
    leg.position.set(x, y, z);
    leg.rotation.x = rotX;
    leg.rotation.z = rotZ;
    leg.castShadow = true;
    group.add(leg);
  });
}

/**
 * 4. Bed 3D Model
 */
export function buildBedGeometry(group, primaryMat, accentMat) {
  // Platform Frame
  const frameGeo = new THREE.BoxGeometry(3.0, 0.35, 3.4);
  const frameMesh = new THREE.Mesh(frameGeo, accentMat);
  frameMesh.position.y = 0.55;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  // High Upholstered Headboard
  const headGeo = new THREE.BoxGeometry(3.1, 1.8, 0.25);
  const headMesh = new THREE.Mesh(headGeo, primaryMat);
  headMesh.position.set(0, 1.5, -1.6);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  group.add(headMesh);

  // Plush Mattress
  const matGeo = new THREE.BoxGeometry(2.75, 0.5, 3.1);
  const matMesh = new THREE.Mesh(matGeo, primaryMat);
  matMesh.position.set(0, 0.95, 0.1);
  matMesh.castShadow = true;
  group.add(matMesh);

  // Pillows
  const pillowGeo = new THREE.BoxGeometry(1.0, 0.18, 0.65);
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xF5F5F7, roughness: 0.9 });
  const p1 = new THREE.Mesh(pillowGeo, pillowMat);
  p1.position.set(-0.75, 1.28, -1.1);
  p1.rotation.x = 0.15;
  group.add(p1);

  const p2 = new THREE.Mesh(pillowGeo, pillowMat);
  p2.position.set(0.75, 1.28, -1.1);
  p2.rotation.x = 0.15;
  group.add(p2);

  // 4 Platform Corner Legs
  const legGeo = new THREE.BoxGeometry(0.12, 0.38, 0.12);
  const corners = [
    [-1.35, 0.19, -1.55],
    [1.35, 0.19, -1.55],
    [-1.35, 0.19, 1.55],
    [1.35, 0.19, 1.55]
  ];
  corners.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, accentMat);
    leg.position.set(x, y, z);
    group.add(leg);
  });
}

/**
 * 5. Cabinet 3D Model
 */
export function buildCabinetGeometry(group, primaryMat, accentMat) {
  // Main credenza / cabinet box
  const boxGeo = new THREE.BoxGeometry(3.4, 1.6, 1.4);
  const boxMesh = new THREE.Mesh(boxGeo, primaryMat);
  boxMesh.position.y = 1.65;
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  group.add(boxMesh);

  // 3 Door Panels with subtle seams
  const doorGeo = new THREE.BoxGeometry(1.08, 1.52, 0.04);
  for (let i = -1; i <= 1; i++) {
    const door = new THREE.Mesh(doorGeo, primaryMat);
    door.position.set(i * 1.11, 1.65, 0.72);
    door.castShadow = true;
    group.add(door);

    // Minimalist brass pull handle
    const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.28, 12);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, metalness: 0.95, roughness: 0.2 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(i * 1.11 + 0.42, 1.65, 0.77);
    group.add(handle);
  }

  // Sled base / 4 slender modern legs
  const legGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.85, 16);
  const legCoords = [
    [-1.5, 0.42, -0.55],
    [1.5, 0.42, -0.55],
    [-1.5, 0.42, 0.55],
    [1.5, 0.42, 0.55]
  ];
  legCoords.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, accentMat);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    group.add(leg);
  });
}

/**
 * Master Factory: Build Complete 3D Furniture Model
 */
export function createFurniture3DScene({ category = 'Chair', material = 'Wood', colorHex = '#523826', finish = 'Matte' }) {
  const group = new THREE.Group();
  group.name = `furniture_${category.toLowerCase()}`;

  const primaryMat = createPBRMaterial(material, colorHex, finish);
  const accentMat = createAccentMaterial(material, colorHex);

  const catLower = (category || 'chair').toLowerCase();
  if (catLower === 'chair') {
    buildChairGeometry(group, primaryMat, accentMat);
  } else if (catLower === 'sofa') {
    buildSofaGeometry(group, primaryMat, accentMat);
  } else if (catLower === 'table') {
    buildTableGeometry(group, primaryMat, accentMat);
  } else if (catLower === 'bed') {
    buildBedGeometry(group, primaryMat, accentMat);
  } else if (catLower === 'cabinet') {
    buildCabinetGeometry(group, primaryMat, accentMat);
  } else {
    buildChairGeometry(group, primaryMat, accentMat);
  }

  return group;
}
