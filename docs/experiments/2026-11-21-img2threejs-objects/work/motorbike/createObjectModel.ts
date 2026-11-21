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

// Generated from ObjectSculptSpec target: Toy Sport Motorbike
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createToySportMotorbikeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Toy Sport Motorbike";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["paint"] = createSculptMaterial(
    "paint",
    {"id": "paint", "name": "paint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#d6232a", "color": "#d6232a", "albedo": {"dominant": "#d6232a", "secondary": ["#b51d23", "#eb262e"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#d6232a", "#b51d23", "#eb262e"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "paint-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#e7252d", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "paint-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#ab1c21", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["dark"] = createSculptMaterial(
    "dark",
    {"id": "dark", "name": "dark", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2a2a2a", "color": "#2a2a2a", "albedo": {"dominant": "#2a2a2a", "secondary": ["#232323", "#2e2e2e"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#2a2a2a", "#232323", "#2e2e2e"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "dark-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#2d2d2d", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "dark-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#212121", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["rubber"] = createSculptMaterial(
    "rubber",
    {"id": "rubber", "name": "rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1f1f1f", "color": "#1f1f1f", "albedo": {"dominant": "#1f1f1f", "secondary": ["#1a1a1a", "#222222"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#1f1f1f", "#1a1a1a", "#222222"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "rubber-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#212121", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "rubber-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#181818", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["hub"] = createSculptMaterial(
    "hub",
    {"id": "hub", "name": "hub", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#c9232a", "color": "#c9232a", "albedo": {"dominant": "#c9232a", "secondary": ["#aa1d23", "#dd262e"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#c9232a", "#aa1d23", "#dd262e"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "hub-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#d9252d", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "hub-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#a01c21", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b8bcc2", "color": "#b8bcc2", "albedo": {"dominant": "#b8bcc2", "secondary": ["#9c9fa4", "#caced5"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#b8bcc2", "#9c9fa4", "#caced5"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.6, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "metal-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#c6cbd1", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "metal-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#93969b", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9cc6e8", "color": "#9cc6e8", "albedo": {"dominant": "#9cc6e8", "secondary": ["#84a8c5", "#abd9ff"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#9cc6e8", "#84a8c5", "#abd9ff"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.08, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#a8d5fa", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "glass-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#7c9eb9", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "satin plastic coat", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#d6232a", "secondary": ["#b51d23", "#eb262e"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#d6232a", "#b51d23", "#eb262e"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.2, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}, "clearcoat": 0.6},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Toy Sport Motorbike__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Sport Motorbike", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
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
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Toy Sport Motorbike";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Sport Motorbike", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_wheel_0_1 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, 0.72], "localEnd": [0, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_0_1 = makeAttachmentEndpoint(attachment_wheel_0_1);
  const node_wheel_0_1 = new THREE.Group();
  node_wheel_0_1.name = "wheel 0__pivot";
  node_wheel_0_1.scale.set(1, 1, 1);
  if (endpoint_wheel_0_1) {
    node_wheel_0_1.position.copy(endpoint_wheel_0_1.start);
    node_wheel_0_1.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_wheel_0_1.position.set(0.0, 0.34, 0.72);
    node_wheel_0_1.rotation.set(0.0, 0.0, 1.5708);
  }
  node_wheel_0_1.userData.sculptComponent = {"id": "wheel-0", "name": "wheel 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, 0.72], "localEnd": [0, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.13, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.34, 0.72], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.13, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 31, 31, 1.0)", "secondaryAlbedo": "rgba(26, 26, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_0_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wheel_0_1);
  nodes["wheel-0"] = node_wheel_0_1;
  const mesh_wheel_0_1Geometry = endpoint_wheel_0_1
    ? new THREE.CylinderGeometry(endpoint_wheel_0_1.endRadius, endpoint_wheel_0_1.baseRadius, endpoint_wheel_0_1.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_wheel_0_1) {
    mesh_wheel_0_1Geometry.scale(0.7, 0.13, 0.7);
  }
  const mesh_wheel_0_1 = new THREE.Mesh(
    mesh_wheel_0_1Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_0_1.name = "wheel 0";
  if (endpoint_wheel_0_1) {
    mesh_wheel_0_1.position.copy(endpoint_wheel_0_1.midpoint);
    mesh_wheel_0_1.quaternion.copy(endpoint_wheel_0_1.quaternion);
  }
  mesh_wheel_0_1.castShadow = options.castShadow ?? true;
  mesh_wheel_0_1.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_0_1.userData.sculptComponent = {"id": "wheel-0", "name": "wheel 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, 0.72], "localEnd": [0, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.13, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.34, 0.72], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.13, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 31, 31, 1.0)", "secondaryAlbedo": "rgba(26, 26, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_0_1.add(mesh_wheel_0_1);
  meshes["wheel-0"] = mesh_wheel_0_1;
  colliders["wheel-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_0_1);

  const attachment_hub_0_2 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, 0.72], "localEnd": [-0.01, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_hub_0_2 = makeAttachmentEndpoint(attachment_hub_0_2);
  const node_hub_0_2 = new THREE.Group();
  node_hub_0_2.name = "hub 0__pivot";
  node_hub_0_2.scale.set(1, 1, 1);
  if (endpoint_hub_0_2) {
    node_hub_0_2.position.copy(endpoint_hub_0_2.start);
    node_hub_0_2.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_hub_0_2.position.set(-0.01, 0.34, 0.72);
    node_hub_0_2.rotation.set(0.0, 0.0, 1.5708);
  }
  node_hub_0_2.userData.sculptComponent = {"id": "hub-0", "name": "hub 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, 0.72], "localEnd": [-0.01, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.2, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.01, 0.34, 0.72], "rotation": [0, 0, 1.5708], "scale": [0.5, 0.2, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-0-form", "kind": "form", "description": "hub-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 35, 42, 1.0)", "secondaryAlbedo": "rgba(170, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_0_2.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_hub_0_2);
  nodes["hub-0"] = node_hub_0_2;
  const mesh_hub_0_2Geometry = endpoint_hub_0_2
    ? new THREE.CylinderGeometry(endpoint_hub_0_2.endRadius, endpoint_hub_0_2.baseRadius, endpoint_hub_0_2.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_hub_0_2) {
    mesh_hub_0_2Geometry.scale(0.5, 0.2, 0.5);
  }
  const mesh_hub_0_2 = new THREE.Mesh(
    mesh_hub_0_2Geometry,
    materialMap["hub"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_0_2.name = "hub 0";
  if (endpoint_hub_0_2) {
    mesh_hub_0_2.position.copy(endpoint_hub_0_2.midpoint);
    mesh_hub_0_2.quaternion.copy(endpoint_hub_0_2.quaternion);
  }
  mesh_hub_0_2.castShadow = options.castShadow ?? true;
  mesh_hub_0_2.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_0_2.userData.sculptComponent = {"id": "hub-0", "name": "hub 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, 0.72], "localEnd": [-0.01, 0.34, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.2, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.01, 0.34, 0.72], "rotation": [0, 0, 1.5708], "scale": [0.5, 0.2, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-0-form", "kind": "form", "description": "hub-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 35, 42, 1.0)", "secondaryAlbedo": "rgba(170, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_0_2.add(mesh_hub_0_2);
  meshes["hub-0"] = mesh_hub_0_2;
  colliders["hub-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hub_0_2);

  const attachment_wheel_1_3 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, -0.72], "localEnd": [0, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_1_3 = makeAttachmentEndpoint(attachment_wheel_1_3);
  const node_wheel_1_3 = new THREE.Group();
  node_wheel_1_3.name = "wheel 1__pivot";
  node_wheel_1_3.scale.set(1, 1, 1);
  if (endpoint_wheel_1_3) {
    node_wheel_1_3.position.copy(endpoint_wheel_1_3.start);
    node_wheel_1_3.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_wheel_1_3.position.set(0.0, 0.34, -0.72);
    node_wheel_1_3.rotation.set(0.0, 0.0, 1.5708);
  }
  node_wheel_1_3.userData.sculptComponent = {"id": "wheel-1", "name": "wheel 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, -0.72], "localEnd": [0, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.13, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.34, -0.72], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.13, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 31, 31, 1.0)", "secondaryAlbedo": "rgba(26, 26, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_1_3.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_wheel_1_3);
  nodes["wheel-1"] = node_wheel_1_3;
  const mesh_wheel_1_3Geometry = endpoint_wheel_1_3
    ? new THREE.CylinderGeometry(endpoint_wheel_1_3.endRadius, endpoint_wheel_1_3.baseRadius, endpoint_wheel_1_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_wheel_1_3) {
    mesh_wheel_1_3Geometry.scale(0.7, 0.13, 0.7);
  }
  const mesh_wheel_1_3 = new THREE.Mesh(
    mesh_wheel_1_3Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_1_3.name = "wheel 1";
  if (endpoint_wheel_1_3) {
    mesh_wheel_1_3.position.copy(endpoint_wheel_1_3.midpoint);
    mesh_wheel_1_3.quaternion.copy(endpoint_wheel_1_3.quaternion);
  }
  mesh_wheel_1_3.castShadow = options.castShadow ?? true;
  mesh_wheel_1_3.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_1_3.userData.sculptComponent = {"id": "wheel-1", "name": "wheel 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the wheel-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.34, -0.72], "localEnd": [0, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.7, "height": 0.13, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.34, -0.72], "rotation": [0, 0, 1.5708], "scale": [0.7, 0.13, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "rubber", "materialLayers": ["rubber", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(31, 31, 31, 1.0)", "secondaryAlbedo": "rgba(26, 26, 26, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8}};
  node_wheel_1_3.add(mesh_wheel_1_3);
  meshes["wheel-1"] = mesh_wheel_1_3;
  colliders["wheel-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_1_3);

  const attachment_hub_1_4 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, -0.72], "localEnd": [-0.01, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_hub_1_4 = makeAttachmentEndpoint(attachment_hub_1_4);
  const node_hub_1_4 = new THREE.Group();
  node_hub_1_4.name = "hub 1__pivot";
  node_hub_1_4.scale.set(1, 1, 1);
  if (endpoint_hub_1_4) {
    node_hub_1_4.position.copy(endpoint_hub_1_4.start);
    node_hub_1_4.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_hub_1_4.position.set(-0.01, 0.34, -0.72);
    node_hub_1_4.rotation.set(0.0, 0.0, 1.5708);
  }
  node_hub_1_4.userData.sculptComponent = {"id": "hub-1", "name": "hub 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, -0.72], "localEnd": [-0.01, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.2, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.01, 0.34, -0.72], "rotation": [0, 0, 1.5708], "scale": [0.5, 0.2, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-1-form", "kind": "form", "description": "hub-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 35, 42, 1.0)", "secondaryAlbedo": "rgba(170, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_1_4.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_hub_1_4);
  nodes["hub-1"] = node_hub_1_4;
  const mesh_hub_1_4Geometry = endpoint_hub_1_4
    ? new THREE.CylinderGeometry(endpoint_hub_1_4.endRadius, endpoint_hub_1_4.baseRadius, endpoint_hub_1_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_hub_1_4) {
    mesh_hub_1_4Geometry.scale(0.5, 0.2, 0.5);
  }
  const mesh_hub_1_4 = new THREE.Mesh(
    mesh_hub_1_4Geometry,
    materialMap["hub"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_1_4.name = "hub 1";
  if (endpoint_hub_1_4) {
    mesh_hub_1_4.position.copy(endpoint_hub_1_4.midpoint);
    mesh_hub_1_4.quaternion.copy(endpoint_hub_1_4.quaternion);
  }
  mesh_hub_1_4.castShadow = options.castShadow ?? true;
  mesh_hub_1_4.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_1_4.userData.sculptComponent = {"id": "hub-1", "name": "hub 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the hub-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.01, 0.34, -0.72], "localEnd": [-0.01, 0.34, -0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.2, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.01, 0.34, -0.72], "rotation": [0, 0, 1.5708], "scale": [0.5, 0.2, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "hub", "materialLayers": ["hub", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-1-form", "kind": "form", "description": "hub-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 35, 42, 1.0)", "secondaryAlbedo": "rgba(170, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_hub_1_4.add(mesh_hub_1_4);
  meshes["hub-1"] = mesh_hub_1_4;
  colliders["hub-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hub_1_4);

  const endpoint_fairing_5 = makeAttachmentEndpoint(null);
  const node_fairing_5 = new THREE.Group();
  node_fairing_5.name = "fairing__pivot";
  node_fairing_5.scale.set(1, 1, 1);
  if (endpoint_fairing_5) {
    node_fairing_5.position.copy(endpoint_fairing_5.start);
    node_fairing_5.rotation.set(-0.3, 0.0, 0.0);
  } else {
    node_fairing_5.position.set(0.0, 0.8, 0.4);
    node_fairing_5.rotation.set(-0.3, 0.0, 0.0);
  }
  node_fairing_5.userData.sculptComponent = {"id": "fairing", "name": "fairing", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fairing form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.8, 0.4], "localEnd": [0, 0.8, 0.4], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.52, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.8, 0.4], "rotation": [-0.3, 0, 0], "scale": [0.4, 0.52, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fairing_5.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fairing_5);
  nodes["fairing"] = node_fairing_5;
  const mesh_fairing_5Geometry = endpoint_fairing_5
    ? new THREE.CylinderGeometry(endpoint_fairing_5.endRadius, endpoint_fairing_5.baseRadius, endpoint_fairing_5.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_fairing_5) {
    mesh_fairing_5Geometry.scale(0.4, 0.52, 0.95);
  }
  const mesh_fairing_5 = new THREE.Mesh(
    mesh_fairing_5Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fairing_5.name = "fairing";
  if (endpoint_fairing_5) {
    mesh_fairing_5.position.copy(endpoint_fairing_5.midpoint);
    mesh_fairing_5.quaternion.copy(endpoint_fairing_5.quaternion);
  }
  mesh_fairing_5.castShadow = options.castShadow ?? true;
  mesh_fairing_5.receiveShadow = options.receiveShadow ?? true;
  mesh_fairing_5.userData.sculptComponent = {"id": "fairing", "name": "fairing", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fairing form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.8, 0.4], "localEnd": [0, 0.8, 0.4], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.52, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.8, 0.4], "rotation": [-0.3, 0, 0], "scale": [0.4, 0.52, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fairing_5.add(mesh_fairing_5);
  meshes["fairing"] = mesh_fairing_5;
  colliders["fairing"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fairing_5);

  const endpoint_tank_6 = makeAttachmentEndpoint(null);
  const node_tank_6 = new THREE.Group();
  node_tank_6.name = "tank__pivot";
  node_tank_6.scale.set(1, 1, 1);
  if (endpoint_tank_6) {
    node_tank_6.position.copy(endpoint_tank_6.start);
    node_tank_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tank_6.position.set(0.0, 0.98, 0.02);
    node_tank_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_tank_6.userData.sculptComponent = {"id": "tank", "name": "tank", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the tank form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.98, 0.02], "localEnd": [0, 0.98, 0.02], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.32, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.98, 0.02], "rotation": [0, 0, 0], "scale": [0.42, 0.32, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_tank_6.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tank_6);
  nodes["tank"] = node_tank_6;
  const mesh_tank_6Geometry = endpoint_tank_6
    ? new THREE.CylinderGeometry(endpoint_tank_6.endRadius, endpoint_tank_6.baseRadius, endpoint_tank_6.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_tank_6) {
    mesh_tank_6Geometry.scale(0.42, 0.32, 0.6);
  }
  const mesh_tank_6 = new THREE.Mesh(
    mesh_tank_6Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tank_6.name = "tank";
  if (endpoint_tank_6) {
    mesh_tank_6.position.copy(endpoint_tank_6.midpoint);
    mesh_tank_6.quaternion.copy(endpoint_tank_6.quaternion);
  }
  mesh_tank_6.castShadow = options.castShadow ?? true;
  mesh_tank_6.receiveShadow = options.receiveShadow ?? true;
  mesh_tank_6.userData.sculptComponent = {"id": "tank", "name": "tank", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the tank form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.98, 0.02], "localEnd": [0, 0.98, 0.02], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.32, "depth": 0.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.98, 0.02], "rotation": [0, 0, 0], "scale": [0.42, 0.32, 0.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_tank_6.add(mesh_tank_6);
  meshes["tank"] = mesh_tank_6;
  colliders["tank"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_tank_6);

  const endpoint_seat_7 = makeAttachmentEndpoint(null);
  const node_seat_7 = new THREE.Group();
  node_seat_7.name = "seat__pivot";
  node_seat_7.scale.set(1, 1, 1);
  if (endpoint_seat_7) {
    node_seat_7.position.copy(endpoint_seat_7.start);
    node_seat_7.rotation.set(0.1, 0.0, 0.0);
  } else {
    node_seat_7.position.set(0.0, 1.02, -0.36);
    node_seat_7.rotation.set(0.1, 0.0, 0.0);
  }
  node_seat_7.userData.sculptComponent = {"id": "seat", "name": "seat", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the seat form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.02, -0.36], "localEnd": [0, 1.02, -0.36], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.1, "depth": 0.55, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.02, -0.36], "rotation": [0.1, 0, 0], "scale": [0.3, 0.1, 0.55]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_seat_7.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_seat_7);
  nodes["seat"] = node_seat_7;
  const mesh_seat_7Geometry = endpoint_seat_7
    ? new THREE.CylinderGeometry(endpoint_seat_7.endRadius, endpoint_seat_7.baseRadius, endpoint_seat_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_seat_7) {
    mesh_seat_7Geometry.scale(0.3, 0.1, 0.55);
  }
  const mesh_seat_7 = new THREE.Mesh(
    mesh_seat_7Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_seat_7.name = "seat";
  if (endpoint_seat_7) {
    mesh_seat_7.position.copy(endpoint_seat_7.midpoint);
    mesh_seat_7.quaternion.copy(endpoint_seat_7.quaternion);
  }
  mesh_seat_7.castShadow = options.castShadow ?? true;
  mesh_seat_7.receiveShadow = options.receiveShadow ?? true;
  mesh_seat_7.userData.sculptComponent = {"id": "seat", "name": "seat", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the seat form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.02, -0.36], "localEnd": [0, 1.02, -0.36], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.1, "depth": 0.55, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.02, -0.36], "rotation": [0.1, 0, 0], "scale": [0.3, 0.1, 0.55]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_seat_7.add(mesh_seat_7);
  meshes["seat"] = mesh_seat_7;
  colliders["seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_seat_7);

  const endpoint_tail_8 = makeAttachmentEndpoint(null);
  const node_tail_8 = new THREE.Group();
  node_tail_8.name = "tail__pivot";
  node_tail_8.scale.set(1, 1, 1);
  if (endpoint_tail_8) {
    node_tail_8.position.copy(endpoint_tail_8.start);
    node_tail_8.rotation.set(0.35, 0.0, 0.0);
  } else {
    node_tail_8.position.set(0.0, 1.06, -0.66);
    node_tail_8.rotation.set(0.35, 0.0, 0.0);
  }
  node_tail_8.userData.sculptComponent = {"id": "tail", "name": "tail", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the tail form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.06, -0.66], "localEnd": [0, 1.06, -0.66], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.26, "height": 0.22, "depth": 0.65, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.06, -0.66], "rotation": [0.35, 0, 0], "scale": [0.26, 0.22, 0.65]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-form", "kind": "detail", "description": "pointed tail", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_tail_8.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_tail_8);
  nodes["tail"] = node_tail_8;
  const mesh_tail_8Geometry = endpoint_tail_8
    ? new THREE.CylinderGeometry(endpoint_tail_8.endRadius, endpoint_tail_8.baseRadius, endpoint_tail_8.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_tail_8) {
    mesh_tail_8Geometry.scale(0.26, 0.22, 0.65);
  }
  const mesh_tail_8 = new THREE.Mesh(
    mesh_tail_8Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_8.name = "tail";
  if (endpoint_tail_8) {
    mesh_tail_8.position.copy(endpoint_tail_8.midpoint);
    mesh_tail_8.quaternion.copy(endpoint_tail_8.quaternion);
  }
  mesh_tail_8.castShadow = options.castShadow ?? true;
  mesh_tail_8.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_8.userData.sculptComponent = {"id": "tail", "name": "tail", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the tail form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.06, -0.66], "localEnd": [0, 1.06, -0.66], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.26, "height": 0.22, "depth": 0.65, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.06, -0.66], "rotation": [0.35, 0, 0], "scale": [0.26, 0.22, 0.65]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-form", "kind": "detail", "description": "pointed tail", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_tail_8.add(mesh_tail_8);
  meshes["tail"] = mesh_tail_8;
  colliders["tail"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_tail_8);

  const attachment_fork_l_9 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.09, 0.62, 0.62], "localEnd": [0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_fork_l_9 = makeAttachmentEndpoint(attachment_fork_l_9);
  const node_fork_l_9 = new THREE.Group();
  node_fork_l_9.name = "fork l__pivot";
  node_fork_l_9.scale.set(1, 1, 1);
  if (endpoint_fork_l_9) {
    node_fork_l_9.position.copy(endpoint_fork_l_9.start);
    node_fork_l_9.rotation.set(-0.35, 0.0, 0.0);
  } else {
    node_fork_l_9.position.set(0.09, 0.62, 0.62);
    node_fork_l_9.rotation.set(-0.35, 0.0, 0.0);
  }
  node_fork_l_9.userData.sculptComponent = {"id": "fork-l", "name": "fork l", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the fork-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.09, 0.62, 0.62], "localEnd": [0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.7, "depth": 0.05, "units": "m", "confidence": 0.7}, "transform": {"position": [0.09, 0.62, 0.62], "rotation": [-0.35, 0, 0], "scale": [0.05, 0.7, 0.05]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-l-form", "kind": "detail", "description": "front forks", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_fork_l_9.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fork_l_9);
  nodes["fork-l"] = node_fork_l_9;
  const mesh_fork_l_9Geometry = endpoint_fork_l_9
    ? new THREE.CylinderGeometry(endpoint_fork_l_9.endRadius, endpoint_fork_l_9.baseRadius, endpoint_fork_l_9.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_fork_l_9) {
    mesh_fork_l_9Geometry.scale(0.05, 0.7, 0.05);
  }
  const mesh_fork_l_9 = new THREE.Mesh(
    mesh_fork_l_9Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_l_9.name = "fork l";
  if (endpoint_fork_l_9) {
    mesh_fork_l_9.position.copy(endpoint_fork_l_9.midpoint);
    mesh_fork_l_9.quaternion.copy(endpoint_fork_l_9.quaternion);
  }
  mesh_fork_l_9.castShadow = options.castShadow ?? true;
  mesh_fork_l_9.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_l_9.userData.sculptComponent = {"id": "fork-l", "name": "fork l", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the fork-l form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.09, 0.62, 0.62], "localEnd": [0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.7, "depth": 0.05, "units": "m", "confidence": 0.7}, "transform": {"position": [0.09, 0.62, 0.62], "rotation": [-0.35, 0, 0], "scale": [0.05, 0.7, 0.05]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-l-form", "kind": "detail", "description": "front forks", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_fork_l_9.add(mesh_fork_l_9);
  meshes["fork-l"] = mesh_fork_l_9;
  colliders["fork-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fork_l_9);

  const attachment_fork_r_10 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.09, 0.62, 0.62], "localEnd": [-0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_fork_r_10 = makeAttachmentEndpoint(attachment_fork_r_10);
  const node_fork_r_10 = new THREE.Group();
  node_fork_r_10.name = "fork r__pivot";
  node_fork_r_10.scale.set(1, 1, 1);
  if (endpoint_fork_r_10) {
    node_fork_r_10.position.copy(endpoint_fork_r_10.start);
    node_fork_r_10.rotation.set(-0.35, 0.0, 0.0);
  } else {
    node_fork_r_10.position.set(-0.09, 0.62, 0.62);
    node_fork_r_10.rotation.set(-0.35, 0.0, 0.0);
  }
  node_fork_r_10.userData.sculptComponent = {"id": "fork-r", "name": "fork r", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the fork-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.09, 0.62, 0.62], "localEnd": [-0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.7, "depth": 0.05, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.09, 0.62, 0.62], "rotation": [-0.35, 0, 0], "scale": [0.05, 0.7, 0.05]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_fork_r_10.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fork_r_10);
  nodes["fork-r"] = node_fork_r_10;
  const mesh_fork_r_10Geometry = endpoint_fork_r_10
    ? new THREE.CylinderGeometry(endpoint_fork_r_10.endRadius, endpoint_fork_r_10.baseRadius, endpoint_fork_r_10.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_fork_r_10) {
    mesh_fork_r_10Geometry.scale(0.05, 0.7, 0.05);
  }
  const mesh_fork_r_10 = new THREE.Mesh(
    mesh_fork_r_10Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_r_10.name = "fork r";
  if (endpoint_fork_r_10) {
    mesh_fork_r_10.position.copy(endpoint_fork_r_10.midpoint);
    mesh_fork_r_10.quaternion.copy(endpoint_fork_r_10.quaternion);
  }
  mesh_fork_r_10.castShadow = options.castShadow ?? true;
  mesh_fork_r_10.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_r_10.userData.sculptComponent = {"id": "fork-r", "name": "fork r", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the fork-r form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.09, 0.62, 0.62], "localEnd": [-0.09, 0.62, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.05, "height": 0.7, "depth": 0.05, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.09, 0.62, 0.62], "rotation": [-0.35, 0, 0], "scale": [0.05, 0.7, 0.05]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_fork_r_10.add(mesh_fork_r_10);
  meshes["fork-r"] = mesh_fork_r_10;
  colliders["fork-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fork_r_10);

  const attachment_handlebar_11 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.05, 0.42], "localEnd": [0, 1.05, 0.42], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_handlebar_11 = makeAttachmentEndpoint(attachment_handlebar_11);
  const node_handlebar_11 = new THREE.Group();
  node_handlebar_11.name = "handlebar__pivot";
  node_handlebar_11.scale.set(1, 1, 1);
  if (endpoint_handlebar_11) {
    node_handlebar_11.position.copy(endpoint_handlebar_11.start);
    node_handlebar_11.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_handlebar_11.position.set(0.0, 1.05, 0.42);
    node_handlebar_11.rotation.set(0.0, 0.0, 1.5708);
  }
  node_handlebar_11.userData.sculptComponent = {"id": "handlebar", "name": "handlebar", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the handlebar form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.05, 0.42], "localEnd": [0, 1.05, 0.42], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.035, "height": 0.55, "depth": 0.035, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.05, 0.42], "rotation": [0, 0, 1.5708], "scale": [0.035, 0.55, 0.035]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handlebar-form", "kind": "form", "description": "handlebar shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_handlebar_11.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_handlebar_11);
  nodes["handlebar"] = node_handlebar_11;
  const mesh_handlebar_11Geometry = endpoint_handlebar_11
    ? new THREE.CylinderGeometry(endpoint_handlebar_11.endRadius, endpoint_handlebar_11.baseRadius, endpoint_handlebar_11.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_handlebar_11) {
    mesh_handlebar_11Geometry.scale(0.035, 0.55, 0.035);
  }
  const mesh_handlebar_11 = new THREE.Mesh(
    mesh_handlebar_11Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handlebar_11.name = "handlebar";
  if (endpoint_handlebar_11) {
    mesh_handlebar_11.position.copy(endpoint_handlebar_11.midpoint);
    mesh_handlebar_11.quaternion.copy(endpoint_handlebar_11.quaternion);
  }
  mesh_handlebar_11.castShadow = options.castShadow ?? true;
  mesh_handlebar_11.receiveShadow = options.receiveShadow ?? true;
  mesh_handlebar_11.userData.sculptComponent = {"id": "handlebar", "name": "handlebar", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the handlebar form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.05, 0.42], "localEnd": [0, 1.05, 0.42], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.035, "height": 0.55, "depth": 0.035, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.05, 0.42], "rotation": [0, 0, 1.5708], "scale": [0.035, 0.55, 0.035]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handlebar-form", "kind": "form", "description": "handlebar shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_handlebar_11.add(mesh_handlebar_11);
  meshes["handlebar"] = mesh_handlebar_11;
  colliders["handlebar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_handlebar_11);

  const endpoint_screen_12 = makeAttachmentEndpoint(null);
  const node_screen_12 = new THREE.Group();
  node_screen_12.name = "screen__pivot";
  node_screen_12.scale.set(1, 1, 1);
  if (endpoint_screen_12) {
    node_screen_12.position.copy(endpoint_screen_12.start);
    node_screen_12.rotation.set(-0.6, 0.0, 0.0);
  } else {
    node_screen_12.position.set(0.0, 1.08, 0.62);
    node_screen_12.rotation.set(-0.6, 0.0, 0.0);
  }
  node_screen_12.userData.sculptComponent = {"id": "screen", "name": "screen", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the screen form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.08, 0.62], "localEnd": [0, 1.08, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.2, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.08, 0.62], "rotation": [-0.6, 0, 0], "scale": [0.28, 0.2, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-form", "kind": "form", "description": "screen shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(156, 198, 232, 1.0)", "secondaryAlbedo": "rgba(132, 168, 197, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_screen_12.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_screen_12);
  nodes["screen"] = node_screen_12;
  const mesh_screen_12Geometry = endpoint_screen_12
    ? new THREE.CylinderGeometry(endpoint_screen_12.endRadius, endpoint_screen_12.baseRadius, endpoint_screen_12.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_screen_12) {
    mesh_screen_12Geometry.scale(0.28, 0.2, 0.08);
  }
  const mesh_screen_12 = new THREE.Mesh(
    mesh_screen_12Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_screen_12.name = "screen";
  if (endpoint_screen_12) {
    mesh_screen_12.position.copy(endpoint_screen_12.midpoint);
    mesh_screen_12.quaternion.copy(endpoint_screen_12.quaternion);
  }
  mesh_screen_12.castShadow = options.castShadow ?? true;
  mesh_screen_12.receiveShadow = options.receiveShadow ?? true;
  mesh_screen_12.userData.sculptComponent = {"id": "screen", "name": "screen", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the screen form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 1.08, 0.62], "localEnd": [0, 1.08, 0.62], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.2, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 1.08, 0.62], "rotation": [-0.6, 0, 0], "scale": [0.28, 0.2, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screen-form", "kind": "form", "description": "screen shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(156, 198, 232, 1.0)", "secondaryAlbedo": "rgba(132, 168, 197, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_screen_12.add(mesh_screen_12);
  meshes["screen"] = mesh_screen_12;
  colliders["screen"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_screen_12);

  const attachment_exhaust_13 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.18, 0.5, -0.5], "localEnd": [-0.18, 0.5, -0.5], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_exhaust_13 = makeAttachmentEndpoint(attachment_exhaust_13);
  const node_exhaust_13 = new THREE.Group();
  node_exhaust_13.name = "exhaust__pivot";
  node_exhaust_13.scale.set(1, 1, 1);
  if (endpoint_exhaust_13) {
    node_exhaust_13.position.copy(endpoint_exhaust_13.start);
    node_exhaust_13.rotation.set(1.35, 0.0, 0.0);
  } else {
    node_exhaust_13.position.set(-0.18, 0.5, -0.5);
    node_exhaust_13.rotation.set(1.35, 0.0, 0.0);
  }
  node_exhaust_13.userData.sculptComponent = {"id": "exhaust", "name": "exhaust", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the exhaust form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.18, 0.5, -0.5], "localEnd": [-0.18, 0.5, -0.5], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.6, "depth": 0.09, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.18, 0.5, -0.5], "rotation": [1.35, 0, 0], "scale": [0.09, 0.6, 0.09]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "exhaust-form", "kind": "form", "description": "exhaust shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_exhaust_13.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_exhaust_13);
  nodes["exhaust"] = node_exhaust_13;
  const mesh_exhaust_13Geometry = endpoint_exhaust_13
    ? new THREE.CylinderGeometry(endpoint_exhaust_13.endRadius, endpoint_exhaust_13.baseRadius, endpoint_exhaust_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_exhaust_13) {
    mesh_exhaust_13Geometry.scale(0.09, 0.6, 0.09);
  }
  const mesh_exhaust_13 = new THREE.Mesh(
    mesh_exhaust_13Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_exhaust_13.name = "exhaust";
  if (endpoint_exhaust_13) {
    mesh_exhaust_13.position.copy(endpoint_exhaust_13.midpoint);
    mesh_exhaust_13.quaternion.copy(endpoint_exhaust_13.quaternion);
  }
  mesh_exhaust_13.castShadow = options.castShadow ?? true;
  mesh_exhaust_13.receiveShadow = options.receiveShadow ?? true;
  mesh_exhaust_13.userData.sculptComponent = {"id": "exhaust", "name": "exhaust", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the exhaust form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.18, 0.5, -0.5], "localEnd": [-0.18, 0.5, -0.5], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.6, "depth": 0.09, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.18, 0.5, -0.5], "rotation": [1.35, 0, 0], "scale": [0.09, 0.6, 0.09]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "metal", "materialLayers": ["metal", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "exhaust-form", "kind": "form", "description": "exhaust shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 188, 194, 1.0)", "secondaryAlbedo": "rgba(156, 159, 164, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_exhaust_13.add(mesh_exhaust_13);
  meshes["exhaust"] = mesh_exhaust_13;
  colliders["exhaust"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_exhaust_13);

  const endpoint_engine_14 = makeAttachmentEndpoint(null);
  const node_engine_14 = new THREE.Group();
  node_engine_14.name = "engine__pivot";
  node_engine_14.scale.set(1, 1, 1);
  if (endpoint_engine_14) {
    node_engine_14.position.copy(endpoint_engine_14.start);
    node_engine_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_14.position.set(0.0, 0.45, 0.05);
    node_engine_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_14.userData.sculptComponent = {"id": "engine", "name": "engine", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the engine form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.45, 0.05], "localEnd": [0, 0.45, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.32, "height": 0.3, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.45, 0.05], "rotation": [0, 0, 0], "scale": [0.32, 0.3, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "engine-form", "kind": "detail", "description": "dark engine block", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_engine_14.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_engine_14);
  nodes["engine"] = node_engine_14;
  const mesh_engine_14Geometry = endpoint_engine_14
    ? new THREE.CylinderGeometry(endpoint_engine_14.endRadius, endpoint_engine_14.baseRadius, endpoint_engine_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_engine_14) {
    mesh_engine_14Geometry.scale(0.32, 0.3, 0.4);
  }
  const mesh_engine_14 = new THREE.Mesh(
    mesh_engine_14Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_14.name = "engine";
  if (endpoint_engine_14) {
    mesh_engine_14.position.copy(endpoint_engine_14.midpoint);
    mesh_engine_14.quaternion.copy(endpoint_engine_14.quaternion);
  }
  mesh_engine_14.castShadow = options.castShadow ?? true;
  mesh_engine_14.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_14.userData.sculptComponent = {"id": "engine", "name": "engine", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the engine form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.45, 0.05], "localEnd": [0, 0.45, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.32, "height": 0.3, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.45, 0.05], "rotation": [0, 0, 0], "scale": [0.32, 0.3, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "dark", "materialLayers": ["dark", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "engine-form", "kind": "detail", "description": "dark engine block", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 42, 1.0)", "secondaryAlbedo": "rgba(35, 35, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_engine_14.add(mesh_engine_14);
  meshes["engine"] = mesh_engine_14;
  colliders["engine"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_engine_14);

  const endpoint_fender_15 = makeAttachmentEndpoint(null);
  const node_fender_15 = new THREE.Group();
  node_fender_15.name = "fender__pivot";
  node_fender_15.scale.set(1, 1, 1);
  if (endpoint_fender_15) {
    node_fender_15.position.copy(endpoint_fender_15.start);
    node_fender_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fender_15.position.set(0.0, 0.66, 0.72);
    node_fender_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_fender_15.userData.sculptComponent = {"id": "fender", "name": "fender", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fender form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.66, 0.72], "localEnd": [0, 0.66, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.12, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.66, 0.72], "rotation": [0, 0, 0], "scale": [0.16, 0.12, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fender-form", "kind": "form", "description": "fender shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fender_15.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_fender_15);
  nodes["fender"] = node_fender_15;
  const mesh_fender_15Geometry = endpoint_fender_15
    ? new THREE.CylinderGeometry(endpoint_fender_15.endRadius, endpoint_fender_15.baseRadius, endpoint_fender_15.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_fender_15) {
    mesh_fender_15Geometry.scale(0.16, 0.12, 0.4);
  }
  const mesh_fender_15 = new THREE.Mesh(
    mesh_fender_15Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fender_15.name = "fender";
  if (endpoint_fender_15) {
    mesh_fender_15.position.copy(endpoint_fender_15.midpoint);
    mesh_fender_15.quaternion.copy(endpoint_fender_15.quaternion);
  }
  mesh_fender_15.castShadow = options.castShadow ?? true;
  mesh_fender_15.receiveShadow = options.receiveShadow ?? true;
  mesh_fender_15.userData.sculptComponent = {"id": "fender", "name": "fender", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the fender form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.66, 0.72], "localEnd": [0, 0.66, 0.72], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.16, "height": 0.12, "depth": 0.4, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.66, 0.72], "rotation": [0, 0, 0], "scale": [0.16, 0.12, 0.4]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "paint", "materialLayers": ["paint", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fender-form", "kind": "form", "description": "fender shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(214, 35, 42, 1.0)", "secondaryAlbedo": "rgba(181, 29, 35, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_fender_15.add(mesh_fender_15);
  meshes["fender"] = mesh_fender_15;
  colliders["fender"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_fender_15);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createToySportMotorbikeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Toy Sport Motorbike look-dev lights";
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
export function createToySportMotorbikeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameToySportMotorbikeCamera(
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
export function createToySportMotorbikePresentationComposer(
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

export function configureToySportMotorbikeRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createToySportMotorbikeInspectControls(
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
