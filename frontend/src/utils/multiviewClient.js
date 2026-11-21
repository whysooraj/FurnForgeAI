/**
 * FurnForge AI - Client-Side Texture-Locked Multi-View Synthesizer.
 *
 * Synthesizes 512x512 Side (90°), Top (90° Overhead), Back (180°), and 2x2 Sheet
 * views directly from the generated Front View photoreal render with 2D structure
 * preservation (zero 1D barcode striping, solid dark legs, intact crossbars, and
 * overhead accessory projection).
 */

const DEPTH_RATIOS = {
  chair: 0.82,
  sofa: 0.54,
  table: 0.64,
  bed: 0.92,
  cabinet: 0.48,
};

const multiViewCache = new Map();

function toProxyFetchUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const parsed = new URL(url);
      if (
        parsed.pathname.startsWith('/outputs/') ||
        parsed.pathname.startsWith('/sample_sketches/') ||
        parsed.pathname.startsWith('/uploads/')
      ) {
        return `${parsed.pathname}${parsed.search}`;
      }
    }
  } catch {
    // ignore URL parse errors
  }
  return url;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

async function getFrontImageData(imageUrl, size = 512) {
  const proxyUrl = toProxyFetchUrl(imageUrl);
  let img;
  try {
    img = await loadImageElement(proxyUrl);
  } catch {
    img = await loadImageElement(imageUrl);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

function medianOfSorted(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentileOf(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))));
  return s[idx];
}

function reconstructStudioBg(rgb, w, h) {
  const mIn = 4;
  const mOut = 24;
  const leftR = new Float32Array(h);
  const leftG = new Float32Array(h);
  const leftB = new Float32Array(h);
  const rightR = new Float32Array(h);
  const rightG = new Float32Array(h);
  const rightB = new Float32Array(h);

  for (let y = 0; y < h; y++) {
    const lrs = [], lgs = [], lbs = [];
    const rrs = [], rgs = [], rbs = [];
    for (let x = mIn; x < mOut; x++) {
      const idxL = (y * w + x) * 4;
      lrs.push(rgb[idxL]);
      lgs.push(rgb[idxL + 1]);
      lbs.push(rgb[idxL + 2]);
      const idxR = (y * w + (w - 1 - x)) * 4;
      rrs.push(rgb[idxR]);
      rgs.push(rgb[idxR + 1]);
      rbs.push(rgb[idxR + 2]);
    }
    leftR[y] = medianOfSorted(lrs);
    leftG[y] = medianOfSorted(lgs);
    leftB[y] = medianOfSorted(lbs);
    rightR[y] = medianOfSorted(rrs);
    rightG[y] = medianOfSorted(rgs);
    rightB[y] = medianOfSorted(rbs);
  }

  const rad = 8;
  const bg = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    let lr = 0, lg = 0, lb = 0, rr = 0, rg = 0, rb = 0, cnt = 0;
    for (let dy = -rad; dy <= rad; dy++) {
      const yy = Math.min(h - 1, Math.max(0, y + dy));
      lr += leftR[yy];
      lg += leftG[yy];
      lb += leftB[yy];
      rr += rightR[yy];
      rg += rightG[yy];
      rb += rightB[yy];
      cnt++;
    }
    lr /= cnt; lg /= cnt; lb /= cnt;
    rr /= cnt; rg /= cnt; rb /= cnt;
    for (let x = 0; x < w; x++) {
      const t = x / Math.max(1, w - 1);
      const i = (y * w + x) * 4;
      bg[i] = Math.round(lr * (1 - t) + rr * t);
      bg[i + 1] = Math.round(lg * (1 - t) + rg * t);
      bg[i + 2] = Math.round(lb * (1 - t) + rb * t);
      bg[i + 3] = 255;
    }
  }
  return bg;
}

function reconstructFloorBg(studioBg, w, h) {
  let fr = 0, fg = 0, fb = 0, fCnt = 0;
  let wr = 0, wg = 0, wb = 0, wCnt = 0;
  for (let y = Math.floor(h * 0.78); y < Math.floor(h * 0.95); y += 2) {
    for (let x = 20; x < w - 20; x += 8) {
      const i = (y * w + x) * 4;
      fr += studioBg[i]; fg += studioBg[i + 1]; fb += studioBg[i + 2]; fCnt++;
    }
  }
  for (let y = Math.floor(h * 0.10); y < Math.floor(h * 0.25); y += 2) {
    for (let x = 20; x < w - 20; x += 8) {
      const i = (y * w + x) * 4;
      wr += studioBg[i]; wg += studioBg[i + 1]; wb += studioBg[i + 2]; wCnt++;
    }
  }
  const baseR = 0.55 * (fr / Math.max(1, fCnt)) + 0.45 * (wr / Math.max(1, wCnt));
  const baseG = 0.55 * (fg / Math.max(1, fCnt)) + 0.45 * (wg / Math.max(1, wCnt));
  const baseB = 0.55 * (fb / Math.max(1, fCnt)) + 0.45 * (wb / Math.max(1, wCnt));

  const floor = new Uint8ClampedArray(w * h * 4);
  const cx = w * 0.5, cy = h * 0.5;
  const rx = w * 0.65, ry = h * 0.65;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d2 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const vig = 1.05 - 0.14 * Math.min(1.96, d2);
      const i = (y * w + x) * 4;
      floor[i] = Math.min(255, Math.max(0, Math.round(baseR * vig)));
      floor[i + 1] = Math.min(255, Math.max(0, Math.round(baseG * vig)));
      floor[i + 2] = Math.min(255, Math.max(0, Math.round(baseB * vig)));
      floor[i + 3] = 255;
    }
  }
  return floor;
}

function segmentForeground(rgb, studioBg, w, h) {
  const diff = new Float32Array(w * h);
  const chroma = new Float32Array(w * h);
  const dLum = new Float32Array(w * h);
  const gradMap = new Float32Array(w * h);
  const borderSamples = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * 4;
      const dr = rgb[i] - studioBg[i];
      const dg = rgb[i + 1] - studioBg[i + 1];
      const db = rgb[i + 2] - studioBg[i + 2];
      const lumI = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
      const lumB = 0.299 * studioBg[i] + 0.587 * studioBg[i + 1] + 0.114 * studioBg[i + 2];
      const dl = lumI - lumB;
      const dc = Math.sqrt((dr - dl) ** 2 + (dg - dl) ** 2 + (db - dl) ** 2);
      const de = Math.sqrt(dl * dl + 1.5 * dc * dc);
      diff[idx] = de;
      chroma[idx] = dc;
      dLum[idx] = dl;
      if ((y >= 3 && y < 14 && x >= 3 && x < w - 3) || (y >= 3 && y < h - 3 && (x < 14 || x >= w - 14))) {
        borderSamples.push(de);
      }
    }
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = Math.abs(dLum[idx + 1] - dLum[idx - 1]);
      const gy = Math.abs(dLum[idx + w] - dLum[idx - w]);
      gradMap[idx] = gx + gy;
    }
  }

  borderSamples.sort((a, b) => a - b);
  const p90 = borderSamples.length ? borderSamples[Math.floor(borderSamples.length * 0.9)] : 10;
  const thresh = Math.min(28, Math.max(13, p90 * 1.40 + 6));

  const mask = new Uint8Array(w * h);
  for (let y = 4; y < h - 4; y++) {
    const yNorm = y / h;
    for (let x = 4; x < w - 4; x++) {
      const idx = y * w + x;
      const grad = gradMap[idx];
      // Check if pixel is near a sharp leg/crossbar edge within +-8px horizontally
      let nearEdge = grad > 14;
      if (!nearEdge && yNorm > 0.58) {
        for (let dx = -8; dx <= 8; dx += 2) {
          if (gradMap[idx + dx] > 16) {
            nearEdge = true;
            break;
          }
        }
      }
      // Only suppress mild diffuse floor shadow; NEVER erase dark walnut/black legs (dLum < -22)
      const isShadow =
        yNorm > 0.65 &&
        dLum[idx] < -2.5 &&
        dLum[idx] > -22.0 &&
        chroma[idx] < 5.5 &&
        grad < 9.5 &&
        !nearEdge &&
        diff[idx] < Math.max(22, thresh * 1.12);

      if (!isShadow && (diff[idx] > thresh || (grad > 20 && diff[idx] > thresh * 0.55))) {
        mask[idx] = 1;
      }
    }
  }

  // Close small horizontal & vertical gaps (< 7px) inside dark legs & crossbars
  const closed = new Uint8Array(mask);
  for (let y = 4; y < h - 4; y++) {
    let lastOne = -1;
    for (let x = 4; x < w - 4; x++) {
      if (mask[y * w + x]) {
        if (lastOne >= 0 && x - lastOne <= 7) {
          for (let k = lastOne + 1; k < x; k++) closed[y * w + k] = 1;
        }
        lastOne = x;
      }
    }
  }

  // 3x3 majority filter
  const cleaned = new Uint8Array(w * h);
  for (let y = 4; y < h - 4; y++) {
    for (let x = 4; x < w - 4; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += closed[(y + dy) * w + (x + dx)];
        }
      }
      cleaned[y * w + x] = sum >= 4 ? 1 : 0;
    }
  }

  const alpha = new Float32Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          s += cleaned[(y + dy) * w + (x + dx)];
        }
      }
      alpha[y * w + x] = s / 9.0;
    }
  }
  return { alpha, fg: cleaned };
}

function getRowIntervals(fg, y, w, minLen = 2) {
  const segs = [];
  let start = -1;
  const rowOff = y * w;
  for (let x = 0; x < w; x++) {
    if (fg[rowOff + x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start >= minLen) segs.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0 && w - start >= minLen) segs.push([start, w - 1]);
  return segs;
}

function analyzeStructure(fg, w, h, category) {
  let xMin = w, xMax = 0, yMin = h, yMax = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fg[y * w + x]) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
        count++;
      }
    }
  }
  if (count < 40) {
    return { empty: true };
  }

  const wF = Math.max(1, xMax - xMin + 1);
  const hF = Math.max(1, yMax - yMin + 1);
  const xC = 0.5 * (xMin + xMax);
  const rowInfo = {};
  const legThicknesses = [];

  for (let y = yMin; y <= yMax; y++) {
    const segs = getRowIntervals(fg, y, w, 2);
    if (!segs.length) continue;
    const xL = segs[0][0];
    const xR = segs[segs.length - 1][1];
    const span = xR - xL + 1;
    let fill = 0;
    const lens = [];
    for (const [s, e] of segs) {
      const len = e - s + 1;
      fill += len;
      lens.push(len);
    }
    lens.sort((a, b) => a - b);
    const fillRatio = fill / Math.max(1, span);
    rowInfo[y] = {
      xL,
      xR,
      span,
      fill,
      fillRatio,
      segs,
      nSegs: segs.length,
      legThick: segs.length >= 2 ? lens[0] : lens[lens.length - 1],
    };
    if (y > yMin + 0.45 * hF && segs.length >= 2 && fillRatio < 0.65) {
      legThicknesses.push(...lens);
    }
  }

  const aspect = wF / Math.max(1, hF);
  const rawCat = (category || 'Chair').toLowerCase();
  let effCat = rawCat;
  if (aspect >= 1.34 && !['bed', 'table', 'cabinet'].includes(rawCat)) {
    effCat = 'sofa';
  }

  // Base structure detection: distinguish continuous solid plinth / sled base from separated legs
  const botY0 = Math.max(yMin, Math.floor(yMax - 0.25 * hF));
  const bottomRows = [];
  for (let y = botY0; y <= yMax; y++) {
    if (rowInfo[y]) bottomRows.push(rowInfo[y].fillRatio);
  }
  const botMedianFill = medianOfSorted(bottomRows) || 0.5;

  let hasSeparatedLegs = false;
  let legYStart = yMax + 1;
  const legSearchY0 = yMin + Math.floor(0.55 * hF);
  const candLegRows = [];
  for (let y = legSearchY0; y <= yMax; y++) {
    const info = rowInfo[y];
    if (info && info.nSegs >= 2 && info.fillRatio < 0.58) {
      candLegRows.push(y);
    }
  }
  if (candLegRows.length >= Math.max(6, Math.floor(0.10 * hF)) && botMedianFill < 0.62) {
    if (candLegRows.some((y) => y >= yMax - Math.floor(0.12 * hF))) {
      hasSeparatedLegs = true;
      legYStart = candLegRows[0];
    }
  }

  const typicalLegThick = Math.min(
    Math.max(12, Math.floor(wF / 4)),
    Math.max(10, Math.round(wF * 0.052), legThicknesses.length ? Math.round(medianOfSorted(legThicknesses)) : Math.round(wF * 0.065))
  );

  // 1) Detect resting top accessory (only for tables / single chairs, never sofas)
  let accYEnd = null;
  let accXCenter = xC;
  let accW = Math.round(wF * 0.25);
  let hasTableSlab = false;
  if (effCat !== 'sofa') {
    const narrowRows = [];
    for (let y = yMin; y <= yMin + Math.floor(0.45 * hF); y++) {
      const info = rowInfo[y];
      if (!info) continue;
      if (info.span < 0.48 * wF) {
        narrowRows.push(y);
      } else if (info.span >= 0.68 * wF && narrowRows.length >= 6) {
        accYEnd = narrowRows[narrowRows.length - 1];
        accXCenter = medianOfSorted(narrowRows.map((yy) => 0.5 * (rowInfo[yy].xL + rowInfo[yy].xR)));
        accW = Math.round(percentileOf(narrowRows.map((yy) => rowInfo[yy].span), 90));
        break;
      } else if (info.span >= 0.56 * wF) {
        break;
      }
    }

    // 2) Detect horizontal tabletop/bench slab right above separated legs where upper section is narrower (< 0.74 * slabW)
    if (hasSeparatedLegs && legYStart < yMax - Math.floor(0.18 * hF)) {
      const slabCandidates = [];
      for (let y = Math.max(yMin, legYStart - Math.floor(0.22 * hF)); y < legYStart; y++) {
        const info = rowInfo[y];
        if (info && info.fillRatio >= 0.62 && info.span >= 0.68 * wF) {
          slabCandidates.push(y);
        }
      }
      if (slabCandidates.length >= 5) {
        const slabY0 = slabCandidates[0];
        const slabW = percentileOf(slabCandidates.map((y) => rowInfo[y].span), 85);
        const upperRows = [];
        for (let y = yMin; y < slabY0; y++) {
          if (rowInfo[y]) upperRows.push(y);
        }
        if (upperRows.length >= 8) {
          const upperW = percentileOf(upperRows.map((y) => rowInfo[y].span), 85);
          if (upperW < 0.74 * slabW) {
            hasTableSlab = true;
            effCat = 'table';
            accYEnd = slabY0 - 1;
            accXCenter = medianOfSorted(upperRows.map((yy) => 0.5 * (rowInfo[yy].xL + rowInfo[yy].xR)));
            accW = Math.round(percentileOf(upperRows.map((yy) => rowInfo[yy].span), 80));
          }
        }
      }
    }
  }

  const bodyYStart = accYEnd !== null ? accYEnd + 1 : yMin;
  const bodyYEnd = !hasSeparatedLegs ? yMax : Math.min(yMax, Math.max(bodyYStart + 4, legYStart - 1));

  const solidRows = [];
  for (let y = bodyYStart; y <= bodyYEnd; y++) {
    const info = rowInfo[y];
    if (info && info.fillRatio >= 0.40 && info.span >= 0.35 * wF) {
      solidRows.push(y);
    }
  }
  if (!solidRows.length) {
    for (let y = bodyYStart; y <= bodyYEnd; y++) {
      if (rowInfo[y]) solidRows.push(y);
    }
  }

  const sampleIdx = !hasTableSlab && (effCat === 'chair' || effCat === 'sofa' || effCat === 'bed') && solidRows.length > 8
    ? Math.floor(solidRows.length * 0.25)
    : 0;
  const bodyYSampleStart = solidRows.length ? solidRows[sampleIdx] : bodyYStart;

  return {
    empty: false,
    xMin,
    xMax,
    yMin,
    yMax,
    wF,
    hF,
    xC,
    aspect,
    effCat,
    hasSeparatedLegs,
    rowInfo,
    accYEnd,
    accXCenter,
    accW,
    hasTableSlab,
    bodyYStart,
    bodyYEnd,
    bodyYSampleStart,
    solidRows,
    legYStart,
    typicalLegThick,
  };
}

function sampleLegStrip(frontRgb, fg, rowInfo, w, h, y, widthOut, legThick) {
  const rSamples = [], gSamples = [], bSamples = [];
  for (const dy of [-3, -1, 0, 1, 3]) {
    const yy = Math.min(h - 1, Math.max(0, y + dy));
    const info = rowInfo[yy];
    if (!info || !info.segs || !info.segs.length) continue;
    const [sL, eL] = info.segs[0];
    const [sR, eR] = info.segs[info.segs.length - 1];
    const rs = [], gs = [], bs = [];
    for (let x = sL + 1; x <= Math.min(eL, sL + Math.max(4, legThick)); x++) {
      const p = (yy * w + x) * 4;
      rs.push(frontRgb[p]); gs.push(frontRgb[p + 1]); bs.push(frontRgb[p + 2]);
    }
    for (let x = Math.max(sR, eR - Math.max(4, legThick)); x <= eR - 1; x++) {
      const p = (yy * w + x) * 4;
      rs.push(frontRgb[p]); gs.push(frontRgb[p + 1]); bs.push(frontRgb[p + 2]);
    }
    if (rs.length) {
      rSamples.push(medianOfSorted(rs));
      gSamples.push(medianOfSorted(gs));
      bSamples.push(medianOfSorted(bs));
    }
  }
  const out = new Float32Array(Math.max(1, widthOut) * 3);
  const mr = rSamples.length ? medianOfSorted(rSamples) : 95;
  const mg = gSamples.length ? medianOfSorted(gSamples) : 70;
  const mb = bSamples.length ? medianOfSorted(bSamples) : 55;
  for (let i = 0; i < widthOut; i++) {
    out[i * 3] = mr;
    out[i * 3 + 1] = mg;
    out[i * 3 + 2] = mb;
  }
  return out;
}

function sampleRowStrip(frontRgb, fg, w, h, y, widthOut, preferOuter = true) {
  const nOut = Math.max(1, widthOut);
  const candidateStrips = [];

  for (const dy of [-4, -2, 0, 2, 4]) {
    const yc = Math.min(h - 1, Math.max(0, y + dy));
    let cols = [];
    for (let x = 0; x < w; x++) {
      if (fg[yc * w + x]) cols.push(x);
    }
    if (cols.length < 4) continue;
    if (cols.length > 8) cols = cols.slice(2, -2);

    let activeCols = cols;
    if (preferOuter && cols.length > 20) {
      const flankN = Math.max(10, Math.floor(cols.length / 4));
      activeCols = cols.slice(cols.length - flankN);
    }

    const rs = [], gs = [], bs = [];
    for (const c of activeCols) {
      const p = (yc * w + c) * 4;
      rs.push(frontRgb[p]); gs.push(frontRgb[p + 1]); bs.push(frontRgb[p + 2]);
    }
    const medR = medianOfSorted(rs);
    const medG = medianOfSorted(gs);
    const medB = medianOfSorted(bs);

    const strip = new Float32Array(nOut * 3);
    for (let i = 0; i < nOut; i++) {
      const srcIdx = activeCols[Math.min(activeCols.length - 1, Math.floor((i / Math.max(1, nOut - 1)) * (activeCols.length - 1)))];
      const p = (yc * w + srcIdx) * 4;
      const pr = frontRgb[p], pg = frontRgb[p + 1], pb = frontRgb[p + 2];
      const dist = Math.hypot(pr - medR, pg - medG, pb - medB);
      if (dist > 42) {
        strip[i * 3] = medR;
        strip[i * 3 + 1] = medG;
        strip[i * 3 + 2] = medB;
      } else {
        strip[i * 3] = 0.35 * pr + 0.65 * medR;
        strip[i * 3 + 1] = 0.35 * pg + 0.65 * medG;
        strip[i * 3 + 2] = 0.35 * pb + 0.65 * medB;
      }
    }
    candidateStrips.push(strip);
  }

  const out = new Float32Array(nOut * 3);
  if (!candidateStrips.length) {
    out.fill(135);
    return out;
  }
  for (let i = 0; i < nOut * 3; i++) {
    const vals = candidateStrips.map((s) => s[i]);
    out[i] = medianOfSorted(vals);
  }
  return out;
}

function applyFloorShadow(canvasRgba, w, h, cx, cy, rx, ry, darkness = 0.22) {
  const out = new Uint8ClampedArray(canvasRgba);
  const rxSafe = Math.max(8, rx);
  const rySafe = Math.max(4, ry);
  const y0 = Math.max(0, Math.floor(cy - rySafe * 2.2));
  const y1 = Math.min(h - 1, Math.ceil(cy + rySafe * 2.2));
  const x0 = Math.max(0, Math.floor(cx - rxSafe * 2.2));
  const x1 = Math.min(w - 1, Math.ceil(cx + rxSafe * 2.2));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const r2 = ((x - cx) / rxSafe) ** 2 + ((y - cy) / rySafe) ** 2;
      if (r2 < 3.5) {
        const sh = 1.0 - darkness * Math.exp(-1.8 * r2);
        const i = (y * w + x) * 4;
        out[i] = Math.round(out[i] * sh);
        out[i + 1] = Math.round(out[i + 1] * sh);
        out[i + 2] = Math.round(out[i + 2] * sh);
      }
    }
  }
  return out;
}

function renderSideView(frontRgb, fg, studioBg, struct, w, h, category) {
  if (struct.empty) return new Uint8ClampedArray(frontRgb);
  const rawCat = (category || 'Chair').toLowerCase();
  const cat = struct.hasTableSlab ? 'table' : (struct.effCat || rawCat);
  const depthRatio = cat === 'sofa' ? 0.58 : (DEPTH_RATIOS[cat] || 0.72);
  const hasSeparatedLegs = struct.hasSeparatedLegs !== false;
  const { yMin, yMax, bodyYStart, bodyYEnd, legYStart, accYEnd, wF, rowInfo, typicalLegThick } = struct;

  const spans = struct.solidRows.map((y) => rowInfo[y]?.span || wF);
  spans.sort((a, b) => a - b);
  const baseWidth = spans.length ? spans[Math.floor(spans.length * 0.85)] : wF;
  const sideDepth = Math.max(44, Math.min(w * 0.76, baseWidth * depthRatio));

  const cx = w * 0.5;
  const zBack = cx - sideDepth * 0.5;
  const zFront = cx + sideDepth * 0.5;
  const bodyH = Math.max(1, bodyYEnd - bodyYStart + 1);

  const seatTopY = (cat === 'chair' || cat === 'sofa')
    ? bodyYStart + Math.floor(0.42 * bodyH)
    : cat === 'bed'
    ? bodyYStart + Math.floor(0.50 * bodyH)
    : bodyYStart;
  const armTopY = (cat === 'chair' || cat === 'sofa')
    ? bodyYStart + Math.floor(0.24 * bodyH)
    : seatTopY;

  const out = applyFloorShadow(studioBg, w, h, cx, yMax + 2, sideDepth * 0.62, Math.max(8, h * 0.032), 0.22);

  // Estimate leg splay
  const legRows = [];
  if (hasSeparatedLegs) {
    for (let y = legYStart; y <= yMax; y++) {
      if (rowInfo[y] && rowInfo[y].nSegs >= 2) legRows.push(y);
    }
  }
  let splayPerPx = 0;
  if (legRows.length >= 6) {
    const yT = legRows[0], yB = legRows[legRows.length - 1];
    if (yB > yT) {
      splayPerPx = Math.max(-0.2, Math.min(0.28, 0.3 * ((rowInfo[yB].span - rowInfo[yT].span) / (2 * (yB - yT)))));
    }
  }

  for (let y = yMin; y <= yMax; y++) {
    const info = rowInfo[y];
    if (!info) continue;

    // 1. Resting top accessory centered on tabletop
    if (accYEnd !== null && y <= accYEnd) {
      const wAcc = Math.max(6, Math.min(info.span, Math.round(sideDepth * 0.86)));
      const x0 = Math.max(0, Math.round(cx - 0.5 * wAcc));
      const x1 = Math.min(w, x0 + wAcc);
      const segW = Math.max(1, x1 - x0);
      const strip = sampleRowStrip(frontRgb, fg, w, h, y, segW, false);
      for (let i = 0; i < segW; i++) {
        const nx = (i / Math.max(1, segW - 1)) * 2 - 1;
        const sh = 0.96 + 0.06 * Math.cos(nx * 1.1) + 0.03 * nx;
        const k = i * 3;
        const p = (y * w + (x0 + i)) * 4;
        out[p] = Math.min(255, Math.round(strip[k] * sh));
        out[p + 1] = Math.min(255, Math.round(strip[k + 1] * sh));
        out[p + 2] = Math.min(255, Math.round(strip[k + 2] * sh));
      }
      continue;
    }

    // 2. Separated legs & horizontal stretcher bars (every row y >= legYStart)
    if (hasSeparatedLegs && y >= legYStart) {
      const offset = Math.max(0, y - legYStart) * splayPerPx;
      const lxBack = zBack + 0.10 * sideDepth - offset;
      const lxFront = zFront - 0.10 * sideDepth + offset;
      const tRow = Math.max(10, Math.min(Math.floor(sideDepth * 0.22), typicalLegThick));

      // Draw horizontal stretcher bar strictly BETWEEN back and front legs if present
      const hasStretcher = y > legYStart + 5 && (info.fillRatio >= 0.58 || (info.nSegs === 1 && info.span >= 0.50 * baseWidth));
      if (hasStretcher) {
        const rx0 = Math.max(0, Math.round(lxBack));
        const rx1 = Math.min(w, Math.max(rx0 + 2, Math.round(lxFront)));
        const midX0 = Math.min(w - 2, info.xL + tRow);
        const midX1 = Math.max(midX0 + 2, info.xR - tRow);
        const rs = [], gs = [], bs = [];
        for (let x = midX0; x < midX1; x++) {
          if (fg[y * w + x]) {
            const p = (y * w + x) * 4;
            rs.push(frontRgb[p]); gs.push(frontRgb[p + 1]); bs.push(frontRgb[p + 2]);
          }
        }
        const rr = rs.length ? medianOfSorted(rs) * 0.90 : 90;
        const rg = gs.length ? medianOfSorted(gs) * 0.90 : 80;
        const rb = bs.length ? medianOfSorted(bs) * 0.90 : 70;
        for (let x = rx0; x < rx1; x++) {
          const p = (y * w + x) * 4;
          out[p] = Math.min(255, Math.round(rr));
          out[p + 1] = Math.min(255, Math.round(rg));
          out[p + 2] = Math.min(255, Math.round(rb));
        }
      }

      // Draw back and front structural legs over stretcher rail ends
      for (const [lc, sh] of [[lxBack, 0.90], [lxFront, 1.03]]) {
        const x0 = Math.max(0, Math.round(lc - 0.5 * tRow));
        const x1 = Math.min(w, Math.max(x0 + 2, Math.round(lc + 0.5 * tRow)));
        const segW = x1 - x0;
        const strip = sampleLegStrip(frontRgb, fg, rowInfo, w, h, y, segW, tRow);
        for (let i = 0; i < segW; i++) {
          const nx = (i / Math.max(1, segW - 1)) * 2 - 1;
          const cyl = sh * (0.94 + 0.09 * Math.cos(nx * 1.1) + 0.05 * nx);
          const p = (y * w + (x0 + i)) * 4;
          out[p] = Math.min(255, Math.round(strip[i * 3] * cyl));
          out[p + 1] = Math.min(255, Math.round(strip[i * 3 + 1] * cyl));
          out[p + 2] = Math.min(255, Math.round(strip[i * 3 + 2] * cyl));
        }
      }
      continue;
    }

    // 3. Backrest + armrest profile for Chair / Sofa / Bed
    if ((cat === 'chair' || cat === 'sofa' || cat === 'bed') && y < seatTopY && bodyYEnd > bodyYStart + 8) {
      const prog = (y - bodyYStart) / Math.max(1, seatTopY - bodyYStart);
      const rake = (1 - prog) * sideDepth * 0.06;
      const backThick = Math.max(14, sideDepth * (cat === 'sofa' ? 0.28 : 0.22));
      const x0 = Math.max(0, Math.round(zBack - rake));
      const x1 = Math.min(w, Math.max(x0 + 4, Math.round(x0 + backThick)));
      const segW = x1 - x0;
      const strip = sampleRowStrip(frontRgb, fg, w, h, y, segW, true);
      for (let i = 0; i < segW; i++) {
        const nx = (i / Math.max(1, segW - 1)) * 2 - 1;
        const sh = 0.96 + 0.08 * nx - 0.04 * nx * nx;
        const p = (y * w + (x0 + i)) * 4;
        out[p] = Math.min(255, Math.round(strip[i * 3] * sh));
        out[p + 1] = Math.min(255, Math.round(strip[i * 3 + 1] * sh));
        out[p + 2] = Math.min(255, Math.round(strip[i * 3 + 2] * sh));
      }

      if ((cat === 'chair' || cat === 'sofa') && y >= armTopY && info.span >= 0.72 * baseWidth) {
        const armStart = Math.max(0, x1 - 4);
        const armEnd = Math.min(w, Math.max(armStart + 4, Math.round(zFront - sideDepth * 0.06)));
        const armW = armEnd - armStart;
        const armStrip = sampleRowStrip(frontRgb, fg, w, h, y, armW, true);
        for (let i = 0; i < armW; i++) {
          const sh = 0.97 + 0.06 * (i / Math.max(1, armW - 1));
          const p = (y * w + (armStart + i)) * 4;
          out[p] = Math.min(255, Math.round(armStrip[i * 3] * sh));
          out[p + 1] = Math.min(255, Math.round(armStrip[i * 3 + 1] * sh));
          out[p + 2] = Math.min(255, Math.round(armStrip[i * 3 + 2] * sh));
        }
      }
    } else {
      // 4. Seat / frame / tabletop / cabinet side profile
      const widthScale = Math.min(1.04, info.span / Math.max(1, baseWidth));
      const rowDepth = Math.max(typicalLegThick * 2, sideDepth * widthScale);
      const x0 = Math.max(0, Math.round(cx - 0.5 * rowDepth));
      const x1 = Math.min(w, Math.max(x0 + 4, Math.round(cx + 0.5 * rowDepth)));
      const segW = x1 - x0;
      const strip = sampleRowStrip(frontRgb, fg, w, h, y, segW, cat !== 'table');
      for (let i = 0; i < segW; i++) {
        const nx = (i / Math.max(1, segW - 1)) * 2 - 1;
        const bevel = Math.abs(nx) > 0.92 ? 0.90 : 1.0;
        const sh = (0.97 + 0.06 * nx) * bevel;
        const p = (y * w + (x0 + i)) * 4;
        out[p] = Math.min(255, Math.round(strip[i * 3] * sh));
        out[p + 1] = Math.min(255, Math.round(strip[i * 3 + 1] * sh));
        out[p + 2] = Math.min(255, Math.round(strip[i * 3 + 2] * sh));
      }
    }
  }
  return out;
}

function renderTopView(frontRgb, fg, floorBg, struct, w, h, category) {
  if (struct.empty) return new Uint8ClampedArray(frontRgb);
  const rawCat = (category || 'Chair').toLowerCase();
  const cat = struct.hasTableSlab ? 'table' : (struct.effCat || rawCat);
  const depthRatio = cat === 'sofa' ? 0.58 : (DEPTH_RATIOS[cat] || 0.72);
  const { xMin, xMax, yMin, bodyYStart, bodyYEnd, bodyYSampleStart, accYEnd, accXCenter, accW, rowInfo, solidRows } = struct;

  const xLs = solidRows.map((y) => rowInfo[y]?.xL ?? xMin).sort((a, b) => a - b);
  const xRs = solidRows.map((y) => rowInfo[y]?.xR ?? xMax).sort((a, b) => a - b);
  const bx0 = Math.max(16, xLs.length ? xLs[Math.floor(xLs.length * 0.1)] : xMin);
  const bx1 = Math.min(w - 16, Math.max(bx0 + 40, xRs.length ? xRs[Math.floor(xRs.length * 0.9)] : xMax));
  const topW = bx1 - bx0 + 1;
  const topD = Math.max(Math.floor(h * 0.28), Math.min(Math.floor(h * 0.76), Math.round(topW * depthRatio)));
  const by0 = Math.floor((h - topD) / 2);
  const by1 = by0 + topD;

  const out = applyFloorShadow(floorBg, w, h, 0.5 * (bx0 + bx1) + 6, 0.5 * (by0 + by1) + 12, topW * 0.55, topD * 0.55, 0.28);

  // Sample horizontal surface rows & compute global dominant material color (eliminates 1D vertical barcode blocks!)
  const sampleRows = [];
  const allR = [], allG = [], allB = [];
  for (let y = bodyYSampleStart; y <= bodyYEnd; y++) {
    const strip = sampleRowStrip(frontRgb, fg, w, h, y, topW, false);
    sampleRows.push(strip);
    for (let i = 0; i < topW; i += 4) {
      allR.push(strip[i * 3]);
      allG.push(strip[i * 3 + 1]);
      allB.push(strip[i * 3 + 2]);
    }
  }
  if (!sampleRows.length) {
    const strip = sampleRowStrip(frontRgb, fg, w, h, Math.floor(0.5 * (bodyYStart + bodyYEnd)), topW, false);
    sampleRows.push(strip);
    allR.push(strip[0]); allG.push(strip[1]); allB.push(strip[2]);
  }

  const domR = medianOfSorted(allR);
  const domG = medianOfSorted(allG);
  const domB = medianOfSorted(allB);

  // Build smooth horizontal profile clamped toward dominant material palette
  const rawProfile = new Float32Array(topW * 3);
  for (let i = 0; i < topW; i++) {
    const rs = [], gs = [], bs = [];
    for (const r of sampleRows) {
      rs.push(r[i * 3]);
      gs.push(r[i * 3 + 1]);
      bs.push(r[i * 3 + 2]);
    }
    const mr = medianOfSorted(rs);
    const mg = medianOfSorted(gs);
    const mb = medianOfSorted(bs);
    const dist = Math.hypot(mr - domR, mg - domG, mb - domB);
    const wIn = Math.max(0.10, Math.min(1.0, 1.0 - Math.max(0, dist - 24) / 32));
    rawProfile[i * 3] = domR * (1 - 0.28 * wIn) + mr * (0.28 * wIn);
    rawProfile[i * 3 + 1] = domG * (1 - 0.28 * wIn) + mg * (0.28 * wIn);
    rawProfile[i * 3 + 2] = domB * (1 - 0.28 * wIn) + mb * (0.28 * wIn);
  }

  // Wide horizontal box-blur so X-variations never form vertical stripes
  const smoothProfile = new Float32Array(topW * 3);
  const bRad = Math.max(12, Math.floor(topW * 0.16));
  for (let i = 0; i < topW; i++) {
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let d = -bRad; d <= bRad; d++) {
      const ii = Math.min(topW - 1, Math.max(0, i + d));
      sr += rawProfile[ii * 3];
      sg += rawProfile[ii * 3 + 1];
      sb += rawProfile[ii * 3 + 2];
      cnt++;
    }
    smoothProfile[i * 3] = sr / cnt;
    smoothProfile[i * 3 + 1] = sg / cnt;
    smoothProfile[i * 3 + 2] = sb / cnt;
  }

  const backDepth = (cat === 'chair' || cat === 'sofa' || cat === 'bed')
    ? Math.max(14, Math.floor(topD * (cat === 'bed' ? 0.12 : 0.20)))
    : 0;
  const armW = (cat === 'chair' || cat === 'sofa')
    ? Math.max(12, Math.floor(topW * (cat === 'chair' ? 0.14 : 0.11)))
    : 0;

  for (let dy = 0; dy < topD; dy++) {
    const yn = (dy - 0.5 * (topD - 1)) / Math.max(1, 0.5 * (topD - 2));
    const rowA = sampleRows[dy % sampleRows.length];

    for (let dx = 0; dx < topW; dx++) {
      const xn = (dx - 0.5 * (topW - 1)) / Math.max(1, 0.5 * (topW - 2));
      const shapeR = (Math.abs(xn) ** 10 + Math.abs(yn) ** 10) ** 0.1;
      if (shapeR > 1.0) continue;

      const edgeAlpha = Math.min(1, Math.max(0, (1.0 - shapeR) * (Math.min(topD, topW) * 0.28)));
      const edgeBevel = Math.max(0.88, Math.min(1.0, 1.0 - Math.max(0, shapeR - 0.93) * 1.6));
      let light = (1.04 - 0.12 * (xn * xn + yn * yn)) * edgeBevel;

      // Isotropic 2D wood/fabric micro-grain (blending X and Y directions)
      const rowB = sampleRows[dx % sampleRows.length];
      const yIdx = Math.min(topW - 1, Math.floor((dy / Math.max(1, topD - 1)) * (topW - 1)));
      const gxR = Math.max(-9, Math.min(9, (rowA[dx * 3] - rawProfile[dx * 3]) * 0.45));
      const gyR = Math.max(-9, Math.min(9, (rowB[yIdx * 3] - rawProfile[yIdx * 3]) * 0.35));

      let r = smoothProfile[dx * 3] + gxR + gyR;
      let g = smoothProfile[dx * 3 + 1] + gxR + gyR;
      let b = smoothProfile[dx * 3 + 2] + gxR + gyR;

      if (backDepth > 0 && dy < backDepth) {
        light *= 1.04;
      } else if (backDepth > 0 && dy < backDepth + 14) {
        const atten = 0.85 + 0.15 * ((dy - backDepth) / 14);
        light *= atten;
      }

      if (armW > 0 && dy >= Math.floor(backDepth * 0.5) && (dx < armW || dx >= topW - armW)) {
        light *= 1.03;
      }

      const p = ((by0 + dy) * w + (bx0 + dx)) * 4;
      const fr = Math.min(255, Math.max(0, Math.round(r * light)));
      const fgC = Math.min(255, Math.max(0, Math.round(g * light)));
      const fb = Math.min(255, Math.max(0, Math.round(b * light)));
      out[p] = Math.round(fr * edgeAlpha + out[p] * (1 - edgeAlpha));
      out[p + 1] = Math.round(fgC * edgeAlpha + out[p + 1] * (1 - edgeAlpha));
      out[p + 2] = Math.round(fb * edgeAlpha + out[p + 2] * (1 - edgeAlpha));
    }
  }

  // Project resting top accessory (e.g. potted plant) centered on overhead tabletop
  if (accYEnd !== null) {
    const accCx = Math.min(bx1 - 24, Math.max(bx0 + 24, accXCenter || 0.5 * (bx0 + bx1)));
    const accCy = 0.5 * (by0 + by1);
    const accH = Math.max(6, accYEnd - yMin + 1);
    const accR = Math.max(14, Math.min(topD * 0.34, (accW || 40) * 0.38, accH * 0.36));

    // Sample foliage / upper accessory colors & pot / lower accessory colors
    const splitY = yMin + Math.max(3, Math.floor(accH * 0.62));
    const leafRs = [], leafGs = [], leafBs = [];
    const potRs = [], potGs = [], potBs = [];
    for (let y = yMin; y <= accYEnd; y++) {
      for (let x = Math.max(0, Math.floor(accCx - accR)); x < Math.min(w, Math.ceil(accCx + accR)); x++) {
        if (!fg[y * w + x]) continue;
        const p = (y * w + x) * 4;
        if (y < splitY) {
          leafRs.push(frontRgb[p]); leafGs.push(frontRgb[p + 1]); leafBs.push(frontRgb[p + 2]);
        } else {
          potRs.push(frontRgb[p]); potGs.push(frontRgb[p + 1]); potBs.push(frontRgb[p + 2]);
        }
      }
    }
    const leafR = leafRs.length ? percentileOf(leafRs, 35) : domR;
    const leafG = leafGs.length ? percentileOf(leafGs, 60) : domG;
    const leafB = leafBs.length ? percentileOf(leafBs, 35) : domB;
    const potR = potRs.length ? medianOfSorted(potRs) : leafR;
    const potG = potGs.length ? medianOfSorted(potGs) : leafG;
    const potB = potBs.length ? medianOfSorted(potBs) : leafB;

    const ay0 = Math.max(0, Math.floor(accCy - accR - 10));
    const ay1 = Math.min(h - 1, Math.ceil(accCy + accR + 12));
    const ax0 = Math.max(0, Math.floor(accCx - accR - 10));
    const ax1 = Math.min(w - 1, Math.ceil(accCx + accR + 12));

    for (let y = ay0; y <= ay1; y++) {
      for (let x = ax0; x <= ax1; x++) {
        const dx = x - accCx;
        const dy = y - accCy;
        const dist = Math.hypot(dx, dy);
        const shDist2 = ((dx - 4) / (accR * 0.85)) ** 2 + ((dy - 5) / (accR * 0.85)) ** 2;
        const p = (y * w + x) * 4;
        if (shDist2 < 2.8) {
          const sh = 1.0 - 0.28 * Math.exp(-2.2 * shDist2);
          out[p] = Math.round(out[p] * sh);
          out[p + 1] = Math.round(out[p + 1] * sh);
          out[p + 2] = Math.round(out[p + 2] * sh);
        }
        const theta = Math.atan2(dy, dx);
        const petalWave = 1.0 - 0.16 * Math.abs(Math.sin(3.5 * theta)) - 0.08 * Math.abs(Math.cos(5.0 * theta));
        const effR = accR * petalWave;
        const accAlpha = Math.min(1, Math.max(0, (effR - dist) * 0.75));
        if (accAlpha <= 0) continue;

        const radNorm = dist / Math.max(1, accR);
        const isRim = radNorm > 0.48 && radNorm < 0.64;
        const shadeAcc = 1.06 - 0.18 * radNorm;
        const cr = (isRim ? 0.65 * potR + 0.35 * leafR : leafR) * shadeAcc;
        const cg = (isRim ? 0.65 * potG + 0.35 * leafG : leafG) * shadeAcc;
        const cb = (isRim ? 0.65 * potB + 0.35 * leafB : leafB) * shadeAcc;

        out[p] = Math.min(255, Math.max(0, Math.round(cr * accAlpha + out[p] * (1 - accAlpha))));
        out[p + 1] = Math.min(255, Math.max(0, Math.round(cg * accAlpha + out[p + 1] * (1 - accAlpha))));
        out[p + 2] = Math.min(255, Math.max(0, Math.round(cb * accAlpha + out[p + 2] * (1 - accAlpha))));
      }
    }
  }

  return out;
}

function renderBackView(frontRgb, alpha, fg, studioBg, struct, w, h, category) {
  if (struct.empty) return new Uint8ClampedArray(frontRgb);
  const rawCat = (category || 'Chair').toLowerCase();
  const cat = struct.hasTableSlab ? 'table' : (struct.effCat || rawCat);
  const { xMin, xMax, yMax, wF, xC, bodyYStart, bodyYEnd } = struct;

  const cxM = (w - 1) - xC;
  const out = applyFloorShadow(studioBg, w, h, cxM, yMax + 2, wF * 0.56, Math.max(8, h * 0.032), 0.22);

  // Build 2D local box-smoothed foreground buffer (radius 7) so rear surfaces have zero 1D vertical barcodes!
  const smoothR = new Float32Array(w * h);
  const smoothG = new Float32Array(w * h);
  const smoothB = new Float32Array(w * h);
  const rad = 6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (alpha[idx] <= 0.1) continue;
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -rad; dy <= rad; dy += 2) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -rad; dx <= rad; dx += 2) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const a2 = alpha[yy * w + xx];
          if (a2 > 0.35) {
            const p2 = (yy * w + xx) * 4;
            sr += frontRgb[p2] * a2;
            sg += frontRgb[p2 + 1] * a2;
            sb += frontRgb[p2 + 2] * a2;
            sw += a2;
          }
        }
      }
      const p = idx * 4;
      smoothR[idx] = sw > 0 ? sr / sw : frontRgb[p];
      smoothG[idx] = sw > 0 ? sg / sw : frontRgb[p + 1];
      smoothB[idx] = sw > 0 ? sb / sw : frontRgb[p + 2];
    }
  }

  const panelW = Math.max(16, xMax - xMin + 1);
  const isEnclosedBack = cat === 'chair' || cat === 'sofa' || cat === 'bed' || cat === 'cabinet';

  for (let y = 0; y < h; y++) {
    const inBody = isEnclosedBack && y >= bodyYStart + 6 && y <= bodyYEnd - 6;
    for (let x = 0; x < w; x++) {
      const srcX = w - 1 - x;
      const srcIdx = y * w + srcX;
      const a = alpha[srcIdx];
      if (a <= 0.02) continue;

      const srcP = srcIdx * 4;
      let r = frontRgb[srcP];
      let g = frontRgb[srcP + 1];
      let b = frontRgb[srcP + 2];

      const u = Math.min(panelW - 1, Math.max(0, panelW - 1 - (srcX - xMin)));
      const nx = (u / Math.max(1, panelW - 1)) * 2 - 1;

      if (inBody && a > 0.72 && srcX > xMin + 8 && srcX < xMax - 8) {
        // 2D structure-preserving rear backrest blend (zero 1D barcode lines)
        const sh = 0.94 + 0.05 * Math.cos(nx * 1.1) + 0.03 * nx;
        r = (0.65 * smoothR[srcIdx] + 0.35 * r) * sh;
        g = (0.65 * smoothG[srcIdx] + 0.35 * g) * sh;
        b = (0.65 * smoothB[srcIdx] + 0.35 * b) * sh;
      } else {
        const sh = 0.95 + 0.04 * nx;
        r = (0.78 * r + 0.22 * smoothR[srcIdx]) * sh;
        g = (0.78 * g + 0.22 * smoothG[srcIdx]) * sh;
        b = (0.78 * b + 0.22 * smoothB[srcIdx]) * sh;
      }

      const dstP = (y * w + x) * 4;
      out[dstP] = Math.min(255, Math.max(0, Math.round(r * a + out[dstP] * (1 - a))));
      out[dstP + 1] = Math.min(255, Math.max(0, Math.round(g * a + out[dstP + 1] * (1 - a))));
      out[dstP + 2] = Math.min(255, Math.max(0, Math.round(b * a + out[dstP + 2] * (1 - a))));
    }
  }
  return out;
}

function rgbaToDataUrl(rgba, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = new ImageData(rgba, w, h);
  ctx.putImageData(imgData, 0, 0);
  return { canvas: c, dataUrl: c.toDataURL('image/png') };
}

function buildQuadSheetDataUrl(tiles, tileSize = 512) {
  const sheet = document.createElement('canvas');
  sheet.width = tileSize * 2;
  sheet.height = tileSize * 2;
  const ctx = sheet.getContext('2d');

  tiles.forEach(({ label, canvas }, idx) => {
    const ox = (idx % 2) * tileSize;
    const oy = Math.floor(idx / 2) * tileSize;
    ctx.drawImage(canvas, ox, oy, tileSize, tileSize);
    ctx.strokeStyle = '#E2DACB';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, tileSize - 2, tileSize - 2);

    ctx.font = 'bold 13px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#1A1A1E';
    ctx.fillRect(ox + 12, oy + 12, tw + 20, 28);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, ox + 22, oy + 31);
  });

  return sheet.toDataURL('image/png');
}

export async function synthesizeClientMultiViews(frontImageUrl, category = 'Chair') {
  if (!frontImageUrl) return null;
  const cacheKey = `${frontImageUrl}::${category}::v2`;
  if (multiViewCache.has(cacheKey)) {
    return multiViewCache.get(cacheKey);
  }

  const w = 512, h = 512;
  const imgData = await getFrontImageData(frontImageUrl, w);
  const frontRgb = imgData.data;

  const studioBg = reconstructStudioBg(frontRgb, w, h);
  const floorBg = reconstructFloorBg(studioBg, w, h);
  const { alpha, fg } = segmentForeground(frontRgb, studioBg, w, h);
  const struct = analyzeStructure(fg, w, h, category);

  const sideRgba = renderSideView(frontRgb, fg, studioBg, struct, w, h, category);
  const topRgba = renderTopView(frontRgb, fg, floorBg, struct, w, h, category);
  const backRgba = renderBackView(frontRgb, alpha, fg, studioBg, struct, w, h, category);

  const frontOut = rgbaToDataUrl(new Uint8ClampedArray(frontRgb), w, h);
  const sideOut = rgbaToDataUrl(sideRgba, w, h);
  const topOut = rgbaToDataUrl(topRgba, w, h);
  const backOut = rgbaToDataUrl(backRgba, w, h);

  const sheetDataUrl = buildQuadSheetDataUrl([
    { label: 'FRONT VIEW (0 deg)', canvas: frontOut.canvas },
    { label: 'SIDE VIEW (90 deg)', canvas: sideOut.canvas },
    { label: 'TOP VIEW (OVERHEAD)', canvas: topOut.canvas },
    { label: 'BACK VIEW (180 deg)', canvas: backOut.canvas },
  ], w);

  const result = {
    front: frontImageUrl,
    side: sideOut.dataUrl,
    top: topOut.dataUrl,
    back: backOut.dataUrl,
    sheet: sheetDataUrl,
    views: [
      { id: 'front', label: 'Front View', angle: '0° Front', image_url: frontImageUrl },
      { id: 'side', label: 'Side View', angle: '90° Side', image_url: sideOut.dataUrl },
      { id: 'top', label: 'Top View', angle: '90° Top', image_url: topOut.dataUrl },
      { id: 'back', label: 'Back View', angle: '180° Back', image_url: backOut.dataUrl },
    ],
  };

  multiViewCache.set(cacheKey, result);
  return result;
}
