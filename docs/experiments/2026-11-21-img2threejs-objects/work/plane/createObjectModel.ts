import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Toy Propeller Plane
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createToyPropellerPlaneModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Toy Propeller Plane";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["body"] = createSculptMaterial(
    "body",
    {"id": "body", "name": "body", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f4b49a", "color": "#f4b49a", "albedo": {"dominant": "#f4b49a", "secondary": ["#cf9982", "#ffc6a9"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#f4b49a", "#cf9982", "#ffc6a9"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "body-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#ffc2a6", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "body-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#c3907b", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["wing"] = createSculptMaterial(
    "wing",
    {"id": "wing", "name": "wing", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2c4a4e", "color": "#2c4a4e", "albedo": {"dominant": "#2c4a4e", "secondary": ["#253e42", "#305155"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#2c4a4e", "#253e42", "#305155"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "wing-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#2f4f54", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "wing-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#233b3e", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9cc6e8", "color": "#9cc6e8", "albedo": {"dominant": "#9cc6e8", "secondary": ["#84a8c5", "#abd9ff"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#9cc6e8", "#84a8c5", "#abd9ff"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.08, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#a8d5fa", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "glass-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#7c9eb9", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["white"] = createSculptMaterial(
    "white",
    {"id": "white", "name": "white", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f2f2f2", "color": "#f2f2f2", "albedo": {"dominant": "#f2f2f2", "secondary": ["#cdcdcd", "#ffffff"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#f2f2f2", "#cdcdcd", "#ffffff"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "white-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#ffffff", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "white-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#c1c1c1", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["rubber"] = createSculptMaterial(
    "rubber",
    {"id": "rubber", "name": "rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#222222", "color": "#222222", "albedo": {"dominant": "#222222", "secondary": ["#1c1c1c", "#252525"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#222222", "#1c1c1c", "#252525"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "rubber-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#242424", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "rubber-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#1b1b1b", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["hub"] = createSculptMaterial(
    "hub",
    {"id": "hub", "name": "hub", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#d8d8d8", "color": "#d8d8d8", "albedo": {"dominant": "#d8d8d8", "secondary": ["#b7b7b7", "#ededed"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#d8d8d8", "#b7b7b7", "#ededed"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "hub-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#e9e9e9", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "hub-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#acacac", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "satin plastic coat", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#f4b49a", "secondary": ["#cf9982", "#ffc6a9"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#f4b49a", "#cf9982", "#ffc6a9"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.2, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}, "clearcoat": 0.6},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Toy Propeller Plane__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Propeller Plane", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["body"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Toy Propeller Plane";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Propeller Plane", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_fuselage_1 = makeAttachmentEndpoint(null);
  const node_fuselage_1 = new THREE.Group();
  node_fuselage_1.name = "fuselage__pivot";
  node_fuselage_1.scale.set(1, 1, 1);
  if (endpoint_fuselage_1) {
    node_fuselage_1.position.copy(endpoint_fuselage_1.start);
    node_fuselage_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fuselage_1.position.set(0.0, 1.6, 0.0);
    node_fuselage_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_fuselage_1.userData.sculptComponent = {"id": "fuselage", "name": "fuselage", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fuselage form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 0], "localEnd": [0, 1.6, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.3, "height": 1.25, "depth": 6.2, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 0], "rotation": [0, 0, 0], "scale": [1.3, 1.25, 6.2]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fuselage_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fuselage_1);
  nodes["fuselage"] = node_fuselage_1;
  const mesh_fuselage_1Geometry = endpoint_fuselage_1
    ? new THREE.CylinderGeometry(endpoint_fuselage_1.endRadius, endpoint_fuselage_1.baseRadius, endpoint_fuselage_1.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_fuselage_1) {
    mesh_fuselage_1Geometry.scale(1.3, 1.25, 6.2);
  }
  const mesh_fuselage_1 = new THREE.Mesh(
    mesh_fuselage_1Geometry,
    materialMap["body"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fuselage_1.name = "fuselage";
  if (endpoint_fuselage_1) {
    mesh_fuselage_1.position.copy(endpoint_fuselage_1.midpoint);
    mesh_fuselage_1.quaternion.copy(endpoint_fuselage_1.quaternion);
  }
  mesh_fuselage_1.castShadow = options.castShadow ?? true;
  mesh_fuselage_1.receiveShadow = options.receiveShadow ?? true;
  mesh_fuselage_1.userData.sculptComponent = {"id": "fuselage", "name": "fuselage", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fuselage form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 0], "localEnd": [0, 1.6, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.3, "height": 1.25, "depth": 6.2, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 0], "rotation": [0, 0, 0], "scale": [1.3, 1.25, 6.2]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fuselage_1.add(mesh_fuselage_1);
  meshes["fuselage"] = mesh_fuselage_1;
  colliders["fuselage"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fuselage_1);

  const attachment_nose_2 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.0], "localEnd": [0, 1.6, 3.0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_nose_2 = makeAttachmentEndpoint(attachment_nose_2);
  const node_nose_2 = new THREE.Group();
  node_nose_2.name = "nose__pivot";
  node_nose_2.scale.set(1, 1, 1);
  if (endpoint_nose_2) {
    node_nose_2.position.copy(endpoint_nose_2.start);
    node_nose_2.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_nose_2.position.set(0.0, 1.6, 3.0);
    node_nose_2.rotation.set(1.5708, 0.0, 0.0);
  }
  node_nose_2.userData.sculptComponent = {"id": "nose", "name": "nose", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the nose form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.0], "localEnd": [0, 1.6, 3.0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 0.4, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.0], "rotation": [1.5708, 0, 0], "scale": [1.0, 0.4, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "white", "materialLayers": ["white", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nose-form", "kind": "detail", "description": "white nose ring", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(205, 205, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_nose_2.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_nose_2);
  nodes["nose"] = node_nose_2;
  const mesh_nose_2Geometry = endpoint_nose_2
    ? new THREE.CylinderGeometry(endpoint_nose_2.endRadius, endpoint_nose_2.baseRadius, endpoint_nose_2.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_nose_2) {
    mesh_nose_2Geometry.scale(1.0, 0.4, 1.0);
  }
  const mesh_nose_2 = new THREE.Mesh(
    mesh_nose_2Geometry,
    materialMap["white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_2.name = "nose";
  if (endpoint_nose_2) {
    mesh_nose_2.position.copy(endpoint_nose_2.midpoint);
    mesh_nose_2.quaternion.copy(endpoint_nose_2.quaternion);
  }
  mesh_nose_2.castShadow = options.castShadow ?? true;
  mesh_nose_2.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_2.userData.sculptComponent = {"id": "nose", "name": "nose", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the nose form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.0], "localEnd": [0, 1.6, 3.0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 0.4, "depth": 1.0, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.0], "rotation": [1.5708, 0, 0], "scale": [1.0, 0.4, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "white", "materialLayers": ["white", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nose-form", "kind": "detail", "description": "white nose ring", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(205, 205, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_nose_2.add(mesh_nose_2);
  meshes["nose"] = mesh_nose_2;
  colliders["nose"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_nose_2);

  const attachment_spinner_3 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.4], "localEnd": [0, 1.6, 3.4], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_spinner_3 = makeAttachmentEndpoint(attachment_spinner_3);
  const node_spinner_3 = new THREE.Group();
  node_spinner_3.name = "spinner__pivot";
  node_spinner_3.scale.set(1, 1, 1);
  if (endpoint_spinner_3) {
    node_spinner_3.position.copy(endpoint_spinner_3.start);
    node_spinner_3.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_spinner_3.position.set(0.0, 1.6, 3.4);
    node_spinner_3.rotation.set(1.5708, 0.0, 0.0);
  }
  node_spinner_3.userData.sculptComponent = {"id": "spinner", "name": "spinner", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the spinner form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.4], "localEnd": [0, 1.6, 3.4], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.5, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.4], "rotation": [1.5708, 0, 0], "scale": [0.4, 0.5, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "white", "materialLayers": ["white", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "spinner-form", "kind": "form", "description": "spinner shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(205, 205, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_spinner_3.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_spinner_3);
  nodes["spinner"] = node_spinner_3;
  const mesh_spinner_3Geometry = endpoint_spinner_3
    ? new THREE.CylinderGeometry(endpoint_spinner_3.endRadius, endpoint_spinner_3.baseRadius, endpoint_spinner_3.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 1);
  if (!endpoint_spinner_3) {
    mesh_spinner_3Geometry.scale(0.4, 0.5, 0.4);
  }
  const mesh_spinner_3 = new THREE.Mesh(
    mesh_spinner_3Geometry,
    materialMap["white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_spinner_3.name = "spinner";
  if (endpoint_spinner_3) {
    mesh_spinner_3.position.copy(endpoint_spinner_3.midpoint);
    mesh_spinner_3.quaternion.copy(endpoint_spinner_3.quaternion);
  }
  mesh_spinner_3.castShadow = options.castShadow ?? true;
  mesh_spinner_3.receiveShadow = options.receiveShadow ?? true;
  mesh_spinner_3.userData.sculptComponent = {"id": "spinner", "name": "spinner", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the spinner form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.4], "localEnd": [0, 1.6, 3.4], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.5, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.4], "rotation": [1.5708, 0, 0], "scale": [0.4, 0.5, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "white", "materialLayers": ["white", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "spinner-form", "kind": "form", "description": "spinner shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(205, 205, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_spinner_3.add(mesh_spinner_3);
  meshes["spinner"] = mesh_spinner_3;
  colliders["spinner"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_spinner_3);

  const endpoint_blade_a_4 = makeAttachmentEndpoint(null);
  const node_blade_a_4 = new THREE.Group();
  node_blade_a_4.name = "blade a__pivot";
  node_blade_a_4.scale.set(1, 1, 1);
  if (endpoint_blade_a_4) {
    node_blade_a_4.position.copy(endpoint_blade_a_4.start);
    node_blade_a_4.rotation.set(0.0, 0.0, 0.5);
  } else {
    node_blade_a_4.position.set(0.0, 1.6, 3.25);
    node_blade_a_4.rotation.set(0.0, 0.0, 0.5);
  }
  node_blade_a_4.userData.sculptComponent = {"id": "blade-a", "name": "blade a", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the blade-a form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.25], "localEnd": [0, 1.6, 3.25], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.35, "height": 2.6, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.25], "rotation": [0, 0, 0.5], "scale": [0.35, 2.6, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_blade_a_4.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_blade_a_4);
  nodes["blade-a"] = node_blade_a_4;
  const mesh_blade_a_4Geometry = endpoint_blade_a_4
    ? new THREE.CylinderGeometry(endpoint_blade_a_4.endRadius, endpoint_blade_a_4.baseRadius, endpoint_blade_a_4.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_blade_a_4) {
    mesh_blade_a_4Geometry.scale(0.35, 2.6, 0.08);
  }
  const mesh_blade_a_4 = new THREE.Mesh(
    mesh_blade_a_4Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_blade_a_4.name = "blade a";
  if (endpoint_blade_a_4) {
    mesh_blade_a_4.position.copy(endpoint_blade_a_4.midpoint);
    mesh_blade_a_4.quaternion.copy(endpoint_blade_a_4.quaternion);
  }
  mesh_blade_a_4.castShadow = options.castShadow ?? true;
  mesh_blade_a_4.receiveShadow = options.receiveShadow ?? true;
  mesh_blade_a_4.userData.sculptComponent = {"id": "blade-a", "name": "blade a", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the blade-a form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.25], "localEnd": [0, 1.6, 3.25], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.35, "height": 2.6, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.25], "rotation": [0, 0, 0.5], "scale": [0.35, 2.6, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_blade_a_4.add(mesh_blade_a_4);
  meshes["blade-a"] = mesh_blade_a_4;
  colliders["blade-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_blade_a_4);

  const endpoint_blade_b_5 = makeAttachmentEndpoint(null);
  const node_blade_b_5 = new THREE.Group();
  node_blade_b_5.name = "blade b__pivot";
  node_blade_b_5.scale.set(1, 1, 1);
  if (endpoint_blade_b_5) {
    node_blade_b_5.position.copy(endpoint_blade_b_5.start);
    node_blade_b_5.rotation.set(0.0, 0.0, -1.07);
  } else {
    node_blade_b_5.position.set(0.0, 1.6, 3.25);
    node_blade_b_5.rotation.set(0.0, 0.0, -1.07);
  }
  node_blade_b_5.userData.sculptComponent = {"id": "blade-b", "name": "blade b", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the blade-b form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.25], "localEnd": [0, 1.6, 3.25], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.35, "height": 2.6, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.25], "rotation": [0, 0, -1.07], "scale": [0.35, 2.6, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_blade_b_5.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_blade_b_5);
  nodes["blade-b"] = node_blade_b_5;
  const mesh_blade_b_5Geometry = endpoint_blade_b_5
    ? new THREE.CylinderGeometry(endpoint_blade_b_5.endRadius, endpoint_blade_b_5.baseRadius, endpoint_blade_b_5.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_blade_b_5) {
    mesh_blade_b_5Geometry.scale(0.35, 2.6, 0.08);
  }
  const mesh_blade_b_5 = new THREE.Mesh(
    mesh_blade_b_5Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_blade_b_5.name = "blade b";
  if (endpoint_blade_b_5) {
    mesh_blade_b_5.position.copy(endpoint_blade_b_5.midpoint);
    mesh_blade_b_5.quaternion.copy(endpoint_blade_b_5.quaternion);
  }
  mesh_blade_b_5.castShadow = options.castShadow ?? true;
  mesh_blade_b_5.receiveShadow = options.receiveShadow ?? true;
  mesh_blade_b_5.userData.sculptComponent = {"id": "blade-b", "name": "blade b", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the blade-b form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.6, 3.25], "localEnd": [0, 1.6, 3.25], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.35, "height": 2.6, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.6, 3.25], "rotation": [0, 0, -1.07], "scale": [0.35, 2.6, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_blade_b_5.add(mesh_blade_b_5);
  meshes["blade-b"] = mesh_blade_b_5;
  colliders["blade-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_blade_b_5);

  const endpoint_wing_l_6 = makeAttachmentEndpoint(null);
  const node_wing_l_6 = new THREE.Group();
  node_wing_l_6.name = "wing l__pivot";
  node_wing_l_6.scale.set(1, 1, 1);
  if (endpoint_wing_l_6) {
    node_wing_l_6.position.copy(endpoint_wing_l_6.start);
    node_wing_l_6.rotation.set(0.0, 0.0, -0.06);
  } else {
    node_wing_l_6.position.set(1.8, 1.3, 0.6);
    node_wing_l_6.rotation.set(0.0, 0.0, -0.06);
  }
  node_wing_l_6.userData.sculptComponent = {"id": "wing-l", "name": "wing l", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the wing-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.8, 1.3, 0.6], "localEnd": [1.8, 1.3, 0.6], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.6, "height": 0.18, "depth": 1.3, "units": "m", "confidence": 0.7}, "transform": {"position": [1.8, 1.3, 0.6], "rotation": [0, 0, -0.06], "scale": [3.6, 0.18, 1.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_wing_l_6.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wing_l_6);
  nodes["wing-l"] = node_wing_l_6;
  const mesh_wing_l_6Geometry = endpoint_wing_l_6
    ? new THREE.CylinderGeometry(endpoint_wing_l_6.endRadius, endpoint_wing_l_6.baseRadius, endpoint_wing_l_6.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_wing_l_6) {
    mesh_wing_l_6Geometry.scale(3.6, 0.18, 1.3);
  }
  const mesh_wing_l_6 = new THREE.Mesh(
    mesh_wing_l_6Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_l_6.name = "wing l";
  if (endpoint_wing_l_6) {
    mesh_wing_l_6.position.copy(endpoint_wing_l_6.midpoint);
    mesh_wing_l_6.quaternion.copy(endpoint_wing_l_6.quaternion);
  }
  mesh_wing_l_6.castShadow = options.castShadow ?? true;
  mesh_wing_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_l_6.userData.sculptComponent = {"id": "wing-l", "name": "wing l", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the wing-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.8, 1.3, 0.6], "localEnd": [1.8, 1.3, 0.6], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.6, "height": 0.18, "depth": 1.3, "units": "m", "confidence": 0.7}, "transform": {"position": [1.8, 1.3, 0.6], "rotation": [0, 0, -0.06], "scale": [3.6, 0.18, 1.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_wing_l_6.add(mesh_wing_l_6);
  meshes["wing-l"] = mesh_wing_l_6;
  colliders["wing-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wing_l_6);

  const endpoint_wing_r_7 = makeAttachmentEndpoint(null);
  const node_wing_r_7 = new THREE.Group();
  node_wing_r_7.name = "wing r__pivot";
  node_wing_r_7.scale.set(1, 1, 1);
  if (endpoint_wing_r_7) {
    node_wing_r_7.position.copy(endpoint_wing_r_7.start);
    node_wing_r_7.rotation.set(0.0, 0.0, 0.06);
  } else {
    node_wing_r_7.position.set(-1.8, 1.3, 0.6);
    node_wing_r_7.rotation.set(0.0, 0.0, 0.06);
  }
  node_wing_r_7.userData.sculptComponent = {"id": "wing-r", "name": "wing r", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the wing-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.8, 1.3, 0.6], "localEnd": [-1.8, 1.3, 0.6], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.6, "height": 0.18, "depth": 1.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.8, 1.3, 0.6], "rotation": [0, 0, 0.06], "scale": [3.6, 0.18, 1.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_wing_r_7.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wing_r_7);
  nodes["wing-r"] = node_wing_r_7;
  const mesh_wing_r_7Geometry = endpoint_wing_r_7
    ? new THREE.CylinderGeometry(endpoint_wing_r_7.endRadius, endpoint_wing_r_7.baseRadius, endpoint_wing_r_7.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_wing_r_7) {
    mesh_wing_r_7Geometry.scale(3.6, 0.18, 1.3);
  }
  const mesh_wing_r_7 = new THREE.Mesh(
    mesh_wing_r_7Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_r_7.name = "wing r";
  if (endpoint_wing_r_7) {
    mesh_wing_r_7.position.copy(endpoint_wing_r_7.midpoint);
    mesh_wing_r_7.quaternion.copy(endpoint_wing_r_7.quaternion);
  }
  mesh_wing_r_7.castShadow = options.castShadow ?? true;
  mesh_wing_r_7.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_r_7.userData.sculptComponent = {"id": "wing-r", "name": "wing r", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the wing-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.8, 1.3, 0.6], "localEnd": [-1.8, 1.3, 0.6], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 3.6, "height": 0.18, "depth": 1.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.8, 1.3, 0.6], "rotation": [0, 0, 0.06], "scale": [3.6, 0.18, 1.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_wing_r_7.add(mesh_wing_r_7);
  meshes["wing-r"] = mesh_wing_r_7;
  colliders["wing-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wing_r_7);

  const endpoint_stab_l_8 = makeAttachmentEndpoint(null);
  const node_stab_l_8 = new THREE.Group();
  node_stab_l_8.name = "stab l__pivot";
  node_stab_l_8.scale.set(1, 1, 1);
  if (endpoint_stab_l_8) {
    node_stab_l_8.position.copy(endpoint_stab_l_8.start);
    node_stab_l_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stab_l_8.position.set(0.65, 1.85, -2.7);
    node_stab_l_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_stab_l_8.userData.sculptComponent = {"id": "stab-l", "name": "stab l", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the stab-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.65, 1.85, -2.7], "localEnd": [0.65, 1.85, -2.7], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.4, "height": 0.12, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0.65, 1.85, -2.7], "rotation": [0, 0, 0], "scale": [1.4, 0.12, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stab-l-form", "kind": "detail", "description": "tail wings", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stab_l_8.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stab_l_8);
  nodes["stab-l"] = node_stab_l_8;
  const mesh_stab_l_8Geometry = endpoint_stab_l_8
    ? new THREE.CylinderGeometry(endpoint_stab_l_8.endRadius, endpoint_stab_l_8.baseRadius, endpoint_stab_l_8.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_stab_l_8) {
    mesh_stab_l_8Geometry.scale(1.4, 0.12, 0.6);
  }
  const mesh_stab_l_8 = new THREE.Mesh(
    mesh_stab_l_8Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stab_l_8.name = "stab l";
  if (endpoint_stab_l_8) {
    mesh_stab_l_8.position.copy(endpoint_stab_l_8.midpoint);
    mesh_stab_l_8.quaternion.copy(endpoint_stab_l_8.quaternion);
  }
  mesh_stab_l_8.castShadow = options.castShadow ?? true;
  mesh_stab_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_stab_l_8.userData.sculptComponent = {"id": "stab-l", "name": "stab l", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the stab-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.65, 1.85, -2.7], "localEnd": [0.65, 1.85, -2.7], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.4, "height": 0.12, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0.65, 1.85, -2.7], "rotation": [0, 0, 0], "scale": [1.4, 0.12, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stab-l-form", "kind": "detail", "description": "tail wings", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stab_l_8.add(mesh_stab_l_8);
  meshes["stab-l"] = mesh_stab_l_8;
  colliders["stab-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_stab_l_8);

  const endpoint_stab_r_9 = makeAttachmentEndpoint(null);
  const node_stab_r_9 = new THREE.Group();
  node_stab_r_9.name = "stab r__pivot";
  node_stab_r_9.scale.set(1, 1, 1);
  if (endpoint_stab_r_9) {
    node_stab_r_9.position.copy(endpoint_stab_r_9.start);
    node_stab_r_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stab_r_9.position.set(-0.65, 1.85, -2.7);
    node_stab_r_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_stab_r_9.userData.sculptComponent = {"id": "stab-r", "name": "stab r", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the stab-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.65, 1.85, -2.7], "localEnd": [-0.65, 1.85, -2.7], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.4, "height": 0.12, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.65, 1.85, -2.7], "rotation": [0, 0, 0], "scale": [1.4, 0.12, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stab_r_9.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_stab_r_9);
  nodes["stab-r"] = node_stab_r_9;
  const mesh_stab_r_9Geometry = endpoint_stab_r_9
    ? new THREE.CylinderGeometry(endpoint_stab_r_9.endRadius, endpoint_stab_r_9.baseRadius, endpoint_stab_r_9.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_stab_r_9) {
    mesh_stab_r_9Geometry.scale(1.4, 0.12, 0.6);
  }
  const mesh_stab_r_9 = new THREE.Mesh(
    mesh_stab_r_9Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stab_r_9.name = "stab r";
  if (endpoint_stab_r_9) {
    mesh_stab_r_9.position.copy(endpoint_stab_r_9.midpoint);
    mesh_stab_r_9.quaternion.copy(endpoint_stab_r_9.quaternion);
  }
  mesh_stab_r_9.castShadow = options.castShadow ?? true;
  mesh_stab_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_stab_r_9.userData.sculptComponent = {"id": "stab-r", "name": "stab r", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the stab-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.65, 1.85, -2.7], "localEnd": [-0.65, 1.85, -2.7], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.4, "height": 0.12, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.65, 1.85, -2.7], "rotation": [0, 0, 0], "scale": [1.4, 0.12, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stab_r_9.add(mesh_stab_r_9);
  meshes["stab-r"] = mesh_stab_r_9;
  colliders["stab-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_stab_r_9);

  const endpoint_fin_10 = makeAttachmentEndpoint(null);
  const node_fin_10 = new THREE.Group();
  node_fin_10.name = "fin__pivot";
  node_fin_10.scale.set(1, 1, 1);
  if (endpoint_fin_10) {
    node_fin_10.position.copy(endpoint_fin_10.start);
    node_fin_10.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_fin_10.position.set(0.05, 1.9, -3.1);
    node_fin_10.rotation.set(0.0, 1.5708, 0.0);
  }
  node_fin_10.userData.sculptComponent = {"id": "fin", "name": "fin", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "extrude matches the fin form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0, 0], [1.1, 0], [0.1, 1.2]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.05, 1.9, -3.1], "localEnd": [0.05, 1.9, -3.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.05, 1.9, -3.1], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fin-form", "kind": "detail", "description": "tail fin", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fin_10.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fin_10);
  nodes["fin"] = node_fin_10;
  const mesh_fin_10Geometry = endpoint_fin_10
    ? new THREE.CylinderGeometry(endpoint_fin_10.endRadius, endpoint_fin_10.baseRadius, endpoint_fin_10.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0, 0], [1.1, 0], [0.1, 1.2]], "depth": 0.1});
  if (!endpoint_fin_10) {
    mesh_fin_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fin_10 = new THREE.Mesh(
    mesh_fin_10Geometry,
    materialMap["body"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fin_10.name = "fin";
  if (endpoint_fin_10) {
    mesh_fin_10.position.copy(endpoint_fin_10.midpoint);
    mesh_fin_10.quaternion.copy(endpoint_fin_10.quaternion);
  }
  mesh_fin_10.castShadow = options.castShadow ?? true;
  mesh_fin_10.receiveShadow = options.receiveShadow ?? true;
  mesh_fin_10.userData.sculptComponent = {"id": "fin", "name": "fin", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "extrude matches the fin form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0, 0], [1.1, 0], [0.1, 1.2]], "depth": 0.1}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.05, 1.9, -3.1], "localEnd": [0.05, 1.9, -3.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.05, 1.9, -3.1], "rotation": [0, 1.5708, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body", "materialLayers": ["body", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fin-form", "kind": "detail", "description": "tail fin", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 180, 154, 1.0)", "secondaryAlbedo": "rgba(207, 153, 130, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fin_10.add(mesh_fin_10);
  meshes["fin"] = mesh_fin_10;
  colliders["fin"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fin_10);

  const endpoint_cockpit_11 = makeAttachmentEndpoint(null);
  const node_cockpit_11 = new THREE.Group();
  node_cockpit_11.name = "cockpit__pivot";
  node_cockpit_11.scale.set(1, 1, 1);
  if (endpoint_cockpit_11) {
    node_cockpit_11.position.copy(endpoint_cockpit_11.start);
    node_cockpit_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cockpit_11.position.set(0.0, 2.15, 1.3);
    node_cockpit_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_cockpit_11.userData.sculptComponent = {"id": "cockpit", "name": "cockpit", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the cockpit form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 2.15, 1.3], "localEnd": [0, 2.15, 1.3], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.8, "height": 0.55, "depth": 1.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.15, 1.3], "rotation": [0, 0, 0], "scale": [0.8, 0.55, 1.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cockpit-form", "kind": "detail", "description": "shiny cockpit glass", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(156, 198, 232, 1.0)", "secondaryAlbedo": "rgba(132, 168, 197, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_cockpit_11.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_cockpit_11);
  nodes["cockpit"] = node_cockpit_11;
  const mesh_cockpit_11Geometry = endpoint_cockpit_11
    ? new THREE.CylinderGeometry(endpoint_cockpit_11.endRadius, endpoint_cockpit_11.baseRadius, endpoint_cockpit_11.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_cockpit_11) {
    mesh_cockpit_11Geometry.scale(0.8, 0.55, 1.1);
  }
  const mesh_cockpit_11 = new THREE.Mesh(
    mesh_cockpit_11Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cockpit_11.name = "cockpit";
  if (endpoint_cockpit_11) {
    mesh_cockpit_11.position.copy(endpoint_cockpit_11.midpoint);
    mesh_cockpit_11.quaternion.copy(endpoint_cockpit_11.quaternion);
  }
  mesh_cockpit_11.castShadow = options.castShadow ?? true;
  mesh_cockpit_11.receiveShadow = options.receiveShadow ?? true;
  mesh_cockpit_11.userData.sculptComponent = {"id": "cockpit", "name": "cockpit", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the cockpit form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 2.15, 1.3], "localEnd": [0, 2.15, 1.3], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.8, "height": 0.55, "depth": 1.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 2.15, 1.3], "rotation": [0, 0, 0], "scale": [0.8, 0.55, 1.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cockpit-form", "kind": "detail", "description": "shiny cockpit glass", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(156, 198, 232, 1.0)", "secondaryAlbedo": "rgba(132, 168, 197, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_cockpit_11.add(mesh_cockpit_11);
  meshes["cockpit"] = mesh_cockpit_11;
  colliders["cockpit"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_cockpit_11);

  const attachment_strut_l_12 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.45, 0.85, 1.2], "localEnd": [0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_strut_l_12 = makeAttachmentEndpoint(attachment_strut_l_12);
  const node_strut_l_12 = new THREE.Group();
  node_strut_l_12.name = "strut l__pivot";
  node_strut_l_12.scale.set(1, 1, 1);
  if (endpoint_strut_l_12) {
    node_strut_l_12.position.copy(endpoint_strut_l_12.start);
    node_strut_l_12.rotation.set(0.0, 0.0, -0.3);
  } else {
    node_strut_l_12.position.set(0.45, 0.85, 1.2);
    node_strut_l_12.rotation.set(0.0, 0.0, -0.3);
  }
  node_strut_l_12.userData.sculptComponent = {"id": "strut-l", "name": "strut l", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the strut-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.45, 0.85, 1.2], "localEnd": [0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.06, "height": 0.8, "depth": 0.06, "units": "m", "confidence": 0.7}, "transform": {"position": [0.45, 0.85, 1.2], "rotation": [0, 0, -0.3], "scale": [0.06, 0.8, 0.06]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strut-l-form", "kind": "form", "description": "strut-l shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_strut_l_12.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_strut_l_12);
  nodes["strut-l"] = node_strut_l_12;
  const mesh_strut_l_12Geometry = endpoint_strut_l_12
    ? new THREE.CylinderGeometry(endpoint_strut_l_12.endRadius, endpoint_strut_l_12.baseRadius, endpoint_strut_l_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_strut_l_12) {
    mesh_strut_l_12Geometry.scale(0.06, 0.8, 0.06);
  }
  const mesh_strut_l_12 = new THREE.Mesh(
    mesh_strut_l_12Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_strut_l_12.name = "strut l";
  if (endpoint_strut_l_12) {
    mesh_strut_l_12.position.copy(endpoint_strut_l_12.midpoint);
    mesh_strut_l_12.quaternion.copy(endpoint_strut_l_12.quaternion);
  }
  mesh_strut_l_12.castShadow = options.castShadow ?? true;
  mesh_strut_l_12.receiveShadow = options.receiveShadow ?? true;
  mesh_strut_l_12.userData.sculptComponent = {"id": "strut-l", "name": "strut l", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the strut-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.45, 0.85, 1.2], "localEnd": [0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.06, "height": 0.8, "depth": 0.06, "units": "m", "confidence": 0.7}, "transform": {"position": [0.45, 0.85, 1.2], "rotation": [0, 0, -0.3], "scale": [0.06, 0.8, 0.06]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strut-l-form", "kind": "form", "description": "strut-l shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_strut_l_12.add(mesh_strut_l_12);
  meshes["strut-l"] = mesh_strut_l_12;
  colliders["strut-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_strut_l_12);

  const attachment_strut_r_13 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.45, 0.85, 1.2], "localEnd": [-0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_strut_r_13 = makeAttachmentEndpoint(attachment_strut_r_13);
  const node_strut_r_13 = new THREE.Group();
  node_strut_r_13.name = "strut r__pivot";
  node_strut_r_13.scale.set(1, 1, 1);
  if (endpoint_strut_r_13) {
    node_strut_r_13.position.copy(endpoint_strut_r_13.start);
    node_strut_r_13.rotation.set(0.0, 0.0, 0.3);
  } else {
    node_strut_r_13.position.set(-0.45, 0.85, 1.2);
    node_strut_r_13.rotation.set(0.0, 0.0, 0.3);
  }
  node_strut_r_13.userData.sculptComponent = {"id": "strut-r", "name": "strut r", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the strut-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.45, 0.85, 1.2], "localEnd": [-0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.06, "height": 0.8, "depth": 0.06, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.45, 0.85, 1.2], "rotation": [0, 0, 0.3], "scale": [0.06, 0.8, 0.06]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strut-r-form", "kind": "form", "description": "strut-r shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_strut_r_13.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_strut_r_13);
  nodes["strut-r"] = node_strut_r_13;
  const mesh_strut_r_13Geometry = endpoint_strut_r_13
    ? new THREE.CylinderGeometry(endpoint_strut_r_13.endRadius, endpoint_strut_r_13.baseRadius, endpoint_strut_r_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_strut_r_13) {
    mesh_strut_r_13Geometry.scale(0.06, 0.8, 0.06);
  }
  const mesh_strut_r_13 = new THREE.Mesh(
    mesh_strut_r_13Geometry,
    materialMap["wing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_strut_r_13.name = "strut r";
  if (endpoint_strut_r_13) {
    mesh_strut_r_13.position.copy(endpoint_strut_r_13.midpoint);
    mesh_strut_r_13.quaternion.copy(endpoint_strut_r_13.quaternion);
  }
  mesh_strut_r_13.castShadow = options.castShadow ?? true;
  mesh_strut_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_strut_r_13.userData.sculptComponent = {"id": "strut-r", "name": "strut r", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the strut-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.45, 0.85, 1.2], "localEnd": [-0.45, 0.85, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.06, "height": 0.8, "depth": 0.06, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.45, 0.85, 1.2], "rotation": [0, 0, 0.3], "scale": [0.06, 0.8, 0.06]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wing", "materialLayers": ["wing", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "strut-r-form", "kind": "form", "description": "strut-r shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 74, 78, 1.0)", "secondaryAlbedo": "rgba(37, 62, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_strut_r_13.add(mesh_strut_r_13);
  meshes["strut-r"] = mesh_strut_r_13;
  colliders["strut-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_strut_r_13);

  const attachment_wheel_0_14 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.65, 0.35, 1.2], "localEnd": [0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_0_14 = makeAttachmentEndpoint(attachment_wheel_0_14);
  const node_wheel_0_14 = new THREE.Group();
  node_wheel_0_14.name = "wheel 0__pivot";
  node_wheel_0_14.scale.set(1, 1, 1);
  if (endpoint_wheel_0_14) {
    node_wheel_0_14.position.copy(endpoint_wheel_0_14.start);
    node_wheel_0_14.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_wheel_0_14.position.set(0.65, 0.35, 1.2);
    node_wheel_0_14.rotation.set(0.0, 0.0, 1.5708);
  }
  node_wheel_0_14.userData.sculptComponent = {"id": "wheel-0", "name": "wheel 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.65, 0.35, 1.2], "localEnd": [0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.18, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0.65, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.18, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 34, 34, 1.0)", "secondaryAlbedo": "rgba(28, 28, 28, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_0_14.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wheel_0_14);
  nodes["wheel-0"] = node_wheel_0_14;
  const mesh_wheel_0_14Geometry = endpoint_wheel_0_14
    ? new THREE.CylinderGeometry(endpoint_wheel_0_14.endRadius, endpoint_wheel_0_14.baseRadius, endpoint_wheel_0_14.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_wheel_0_14) {
    mesh_wheel_0_14Geometry.scale(0.7, 0.18, 0.7);
  }
  const mesh_wheel_0_14 = new THREE.Mesh(
    mesh_wheel_0_14Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_0_14.name = "wheel 0";
  if (endpoint_wheel_0_14) {
    mesh_wheel_0_14.position.copy(endpoint_wheel_0_14.midpoint);
    mesh_wheel_0_14.quaternion.copy(endpoint_wheel_0_14.quaternion);
  }
  mesh_wheel_0_14.castShadow = options.castShadow ?? true;
  mesh_wheel_0_14.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_0_14.userData.sculptComponent = {"id": "wheel-0", "name": "wheel 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.65, 0.35, 1.2], "localEnd": [0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.18, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0.65, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.18, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 34, 34, 1.0)", "secondaryAlbedo": "rgba(28, 28, 28, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_0_14.add(mesh_wheel_0_14);
  meshes["wheel-0"] = mesh_wheel_0_14;
  colliders["wheel-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_0_14);

  const attachment_hub_0_15 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.66, 0.35, 1.2], "localEnd": [0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_hub_0_15 = makeAttachmentEndpoint(attachment_hub_0_15);
  const node_hub_0_15 = new THREE.Group();
  node_hub_0_15.name = "hub 0__pivot";
  node_hub_0_15.scale.set(1, 1, 1);
  if (endpoint_hub_0_15) {
    node_hub_0_15.position.copy(endpoint_hub_0_15.start);
    node_hub_0_15.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_hub_0_15.position.set(0.66, 0.35, 1.2);
    node_hub_0_15.rotation.set(0.0, 0.0, 1.5708);
  }
  node_hub_0_15.userData.sculptComponent = {"id": "hub-0", "name": "hub 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.66, 0.35, 1.2], "localEnd": [0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.385, "height": 0.19999999999999998, "depth": 0.385, "units": "m", "confidence": 0.7}, "transform": {"position": [0.66, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.385, 0.19999999999999998, 0.385]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-0-form", "kind": "form", "description": "hub-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 216, 216, 1.0)", "secondaryAlbedo": "rgba(183, 183, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_0_15.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_hub_0_15);
  nodes["hub-0"] = node_hub_0_15;
  const mesh_hub_0_15Geometry = endpoint_hub_0_15
    ? new THREE.CylinderGeometry(endpoint_hub_0_15.endRadius, endpoint_hub_0_15.baseRadius, endpoint_hub_0_15.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_hub_0_15) {
    mesh_hub_0_15Geometry.scale(0.385, 0.19999999999999998, 0.385);
  }
  const mesh_hub_0_15 = new THREE.Mesh(
    mesh_hub_0_15Geometry,
    materialMap["hub"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_0_15.name = "hub 0";
  if (endpoint_hub_0_15) {
    mesh_hub_0_15.position.copy(endpoint_hub_0_15.midpoint);
    mesh_hub_0_15.quaternion.copy(endpoint_hub_0_15.quaternion);
  }
  mesh_hub_0_15.castShadow = options.castShadow ?? true;
  mesh_hub_0_15.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_0_15.userData.sculptComponent = {"id": "hub-0", "name": "hub 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.66, 0.35, 1.2], "localEnd": [0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.385, "height": 0.19999999999999998, "depth": 0.385, "units": "m", "confidence": 0.7}, "transform": {"position": [0.66, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.385, 0.19999999999999998, 0.385]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-0-form", "kind": "form", "description": "hub-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 216, 216, 1.0)", "secondaryAlbedo": "rgba(183, 183, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_0_15.add(mesh_hub_0_15);
  meshes["hub-0"] = mesh_hub_0_15;
  colliders["hub-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hub_0_15);

  const attachment_wheel_1_16 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.65, 0.35, 1.2], "localEnd": [-0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_1_16 = makeAttachmentEndpoint(attachment_wheel_1_16);
  const node_wheel_1_16 = new THREE.Group();
  node_wheel_1_16.name = "wheel 1__pivot";
  node_wheel_1_16.scale.set(1, 1, 1);
  if (endpoint_wheel_1_16) {
    node_wheel_1_16.position.copy(endpoint_wheel_1_16.start);
    node_wheel_1_16.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_wheel_1_16.position.set(-0.65, 0.35, 1.2);
    node_wheel_1_16.rotation.set(0.0, 0.0, 1.5708);
  }
  node_wheel_1_16.userData.sculptComponent = {"id": "wheel-1", "name": "wheel 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.65, 0.35, 1.2], "localEnd": [-0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.18, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.65, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.18, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 34, 34, 1.0)", "secondaryAlbedo": "rgba(28, 28, 28, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_1_16.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wheel_1_16);
  nodes["wheel-1"] = node_wheel_1_16;
  const mesh_wheel_1_16Geometry = endpoint_wheel_1_16
    ? new THREE.CylinderGeometry(endpoint_wheel_1_16.endRadius, endpoint_wheel_1_16.baseRadius, endpoint_wheel_1_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_wheel_1_16) {
    mesh_wheel_1_16Geometry.scale(0.7, 0.18, 0.7);
  }
  const mesh_wheel_1_16 = new THREE.Mesh(
    mesh_wheel_1_16Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_1_16.name = "wheel 1";
  if (endpoint_wheel_1_16) {
    mesh_wheel_1_16.position.copy(endpoint_wheel_1_16.midpoint);
    mesh_wheel_1_16.quaternion.copy(endpoint_wheel_1_16.quaternion);
  }
  mesh_wheel_1_16.castShadow = options.castShadow ?? true;
  mesh_wheel_1_16.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_1_16.userData.sculptComponent = {"id": "wheel-1", "name": "wheel 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.65, 0.35, 1.2], "localEnd": [-0.65, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.18, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.65, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.18, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 34, 34, 1.0)", "secondaryAlbedo": "rgba(28, 28, 28, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_1_16.add(mesh_wheel_1_16);
  meshes["wheel-1"] = mesh_wheel_1_16;
  colliders["wheel-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_1_16);

  const attachment_hub_1_17 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.66, 0.35, 1.2], "localEnd": [-0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_hub_1_17 = makeAttachmentEndpoint(attachment_hub_1_17);
  const node_hub_1_17 = new THREE.Group();
  node_hub_1_17.name = "hub 1__pivot";
  node_hub_1_17.scale.set(1, 1, 1);
  if (endpoint_hub_1_17) {
    node_hub_1_17.position.copy(endpoint_hub_1_17.start);
    node_hub_1_17.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_hub_1_17.position.set(-0.66, 0.35, 1.2);
    node_hub_1_17.rotation.set(0.0, 0.0, 1.5708);
  }
  node_hub_1_17.userData.sculptComponent = {"id": "hub-1", "name": "hub 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.66, 0.35, 1.2], "localEnd": [-0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.385, "height": 0.19999999999999998, "depth": 0.385, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.66, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.385, 0.19999999999999998, 0.385]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-1-form", "kind": "form", "description": "hub-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 216, 216, 1.0)", "secondaryAlbedo": "rgba(183, 183, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_1_17.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_hub_1_17);
  nodes["hub-1"] = node_hub_1_17;
  const mesh_hub_1_17Geometry = endpoint_hub_1_17
    ? new THREE.CylinderGeometry(endpoint_hub_1_17.endRadius, endpoint_hub_1_17.baseRadius, endpoint_hub_1_17.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_hub_1_17) {
    mesh_hub_1_17Geometry.scale(0.385, 0.19999999999999998, 0.385);
  }
  const mesh_hub_1_17 = new THREE.Mesh(
    mesh_hub_1_17Geometry,
    materialMap["hub"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_1_17.name = "hub 1";
  if (endpoint_hub_1_17) {
    mesh_hub_1_17.position.copy(endpoint_hub_1_17.midpoint);
    mesh_hub_1_17.quaternion.copy(endpoint_hub_1_17.quaternion);
  }
  mesh_hub_1_17.castShadow = options.castShadow ?? true;
  mesh_hub_1_17.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_1_17.userData.sculptComponent = {"id": "hub-1", "name": "hub 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.66, 0.35, 1.2], "localEnd": [-0.66, 0.35, 1.2], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.385, "height": 0.19999999999999998, "depth": 0.385, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.66, 0.35, 1.2], "rotation": [0, 0, 1.5708], "scale": [0.385, 0.19999999999999998, 0.385]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-1-form", "kind": "form", "description": "hub-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 216, 216, 1.0)", "secondaryAlbedo": "rgba(183, 183, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_1_17.add(mesh_hub_1_17);
  meshes["hub-1"] = mesh_hub_1_17;
  colliders["hub-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hub_1_17);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createToyPropellerPlaneLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Toy Propeller Plane look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key", "type": "directional", "direction": [4, 8, 6], "color": "#fff6e8", "intensity": 1.7, "notes": "soft studio key light from upper front right, soft PCF shadows"}, {"role": "fill", "type": "hemisphere", "skyColor": "#fff6e8", "groundColor": "#9a7a60", "intensity": 1.25, "notes": "warm sky fill"}, {"role": "rim", "type": "directional", "direction": [-5, 4, -6], "color": "#dfe9ff", "intensity": 0.9, "notes": "cool rim light from behind for round edges"}, {"role": "exposure", "notes": "exposure 1.0, ACES filmic tone mapping, light grey background #dde6ec, contact shadow on the ground plane"}];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createToyPropellerPlaneEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameToyPropellerPlaneCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createToyPropellerPlanePresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureToyPropellerPlaneRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createToyPropellerPlaneInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
