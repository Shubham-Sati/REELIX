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

// Generated from ObjectSculptSpec target: Toy Bird Nest
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createToyBirdNestModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Toy Bird Nest";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["twig"] = createSculptMaterial(
    "twig",
    {"id": "twig", "name": "twig", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8a5a32", "color": "#8a5a32", "albedo": {"dominant": "#8a5a32", "secondary": ["#754c2a", "#976337"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#8a5a32", "#754c2a", "#976337"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "twig-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#956136", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "twig-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#6e4828", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["twig2"] = createSculptMaterial(
    "twig2",
    {"id": "twig2", "name": "twig2", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a06c3e", "color": "#a06c3e", "albedo": {"dominant": "#a06c3e", "secondary": ["#885b34", "#b07644"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#a06c3e", "#885b34", "#b07644"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "twig2-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#ac7442", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "twig2-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#805631", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["egg"] = createSculptMaterial(
    "egg",
    {"id": "egg", "name": "egg", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2f7fd8", "color": "#2f7fd8", "albedo": {"dominant": "#2f7fd8", "secondary": ["#276bb7", "#338bed"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#2f7fd8", "#276bb7", "#338bed"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "egg-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#3289e9", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "egg-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#2565ac", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "satin plastic coat", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#8a5a32", "secondary": ["#754c2a", "#976337"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#8a5a32", "#754c2a", "#976337"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.2, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}, "clearcoat": 0.6},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Toy Bird Nest__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Bird Nest", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
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
    materialMap["twig"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Toy Bird Nest";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Bird Nest", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_rim_1 = makeAttachmentEndpoint(null);
  const node_rim_1 = new THREE.Group();
  node_rim_1.name = "rim__pivot";
  node_rim_1.scale.set(1, 1, 1);
  if (endpoint_rim_1) {
    node_rim_1.position.copy(endpoint_rim_1.start);
    node_rim_1.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_rim_1.position.set(0.0, 0.1, 0.0);
    node_rim_1.rotation.set(1.5708, 0.0, 0.0);
  }
  node_rim_1.userData.sculptComponent = {"id": "rim", "name": "rim", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the rim form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.22}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.1, 0], "localEnd": [0, 0.1, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.48, "depth": 0.48, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.1, 0], "rotation": [1.5708, 0, 0], "scale": [0.48, 0.48, 0.48]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-form", "kind": "detail", "description": "rounded rim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_rim_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_rim_1);
  nodes["rim"] = node_rim_1;
  const mesh_rim_1Geometry = endpoint_rim_1
    ? new THREE.CylinderGeometry(endpoint_rim_1.endRadius, endpoint_rim_1.baseRadius, endpoint_rim_1.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.099, 24, 96);
  if (!endpoint_rim_1) {
    mesh_rim_1Geometry.scale(0.48, 0.48, 0.48);
  }
  const mesh_rim_1 = new THREE.Mesh(
    mesh_rim_1Geometry,
    materialMap["twig"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_1.name = "rim";
  if (endpoint_rim_1) {
    mesh_rim_1.position.copy(endpoint_rim_1.midpoint);
    mesh_rim_1.quaternion.copy(endpoint_rim_1.quaternion);
  }
  mesh_rim_1.castShadow = options.castShadow ?? true;
  mesh_rim_1.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_1.userData.sculptComponent = {"id": "rim", "name": "rim", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the rim form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.22}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.1, 0], "localEnd": [0, 0.1, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.48, "depth": 0.48, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.1, 0], "rotation": [1.5708, 0, 0], "scale": [0.48, 0.48, 0.48]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-form", "kind": "detail", "description": "rounded rim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_rim_1.add(mesh_rim_1);
  meshes["rim"] = mesh_rim_1;
  colliders["rim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_rim_1);

  const endpoint_bowl_2 = makeAttachmentEndpoint(null);
  const node_bowl_2 = new THREE.Group();
  node_bowl_2.name = "bowl__pivot";
  node_bowl_2.scale.set(1, 1, 1);
  if (endpoint_bowl_2) {
    node_bowl_2.position.copy(endpoint_bowl_2.start);
    node_bowl_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bowl_2.position.set(0.0, 0.07, 0.0);
    node_bowl_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_bowl_2.userData.sculptComponent = {"id": "bowl", "name": "bowl", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the bowl form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.07, 0], "localEnd": [0, 0.07, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.16, "depth": 0.42, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.07, 0], "rotation": [0, 0, 0], "scale": [0.42, 0.16, 0.42]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_bowl_2.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_bowl_2);
  nodes["bowl"] = node_bowl_2;
  const mesh_bowl_2Geometry = endpoint_bowl_2
    ? new THREE.CylinderGeometry(endpoint_bowl_2.endRadius, endpoint_bowl_2.baseRadius, endpoint_bowl_2.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_bowl_2) {
    mesh_bowl_2Geometry.scale(0.42, 0.16, 0.42);
  }
  const mesh_bowl_2 = new THREE.Mesh(
    mesh_bowl_2Geometry,
    materialMap["twig2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bowl_2.name = "bowl";
  if (endpoint_bowl_2) {
    mesh_bowl_2.position.copy(endpoint_bowl_2.midpoint);
    mesh_bowl_2.quaternion.copy(endpoint_bowl_2.quaternion);
  }
  mesh_bowl_2.castShadow = options.castShadow ?? true;
  mesh_bowl_2.receiveShadow = options.receiveShadow ?? true;
  mesh_bowl_2.userData.sculptComponent = {"id": "bowl", "name": "bowl", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the bowl form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.07, 0], "localEnd": [0, 0.07, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.16, "depth": 0.42, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.07, 0], "rotation": [0, 0, 0], "scale": [0.42, 0.16, 0.42]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_bowl_2.add(mesh_bowl_2);
  meshes["bowl"] = mesh_bowl_2;
  colliders["bowl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_bowl_2);

  const endpoint_twig_0_3 = makeAttachmentEndpoint(null);
  const node_twig_0_3 = new THREE.Group();
  node_twig_0_3.name = "twig 0__pivot";
  node_twig_0_3.scale.set(1, 1, 1);
  if (endpoint_twig_0_3) {
    node_twig_0_3.position.copy(endpoint_twig_0_3.start);
    node_twig_0_3.rotation.set(1.3708, 0.0, 0.0);
  } else {
    node_twig_0_3.position.set(0.0, 0.08, 0.0);
    node_twig_0_3.rotation.set(1.3708, 0.0, 0.0);
  }
  node_twig_0_3.userData.sculptComponent = {"id": "twig-0", "name": "twig 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.08, 0], "localEnd": [0, 0.08, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.3708, 0.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twig-0-form", "kind": "detail", "description": "twig strands round the rim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_0_3.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_0_3);
  nodes["twig-0"] = node_twig_0_3;
  const mesh_twig_0_3Geometry = endpoint_twig_0_3
    ? new THREE.CylinderGeometry(endpoint_twig_0_3.endRadius, endpoint_twig_0_3.baseRadius, endpoint_twig_0_3.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_0_3) {
    mesh_twig_0_3Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_0_3 = new THREE.Mesh(
    mesh_twig_0_3Geometry,
    materialMap["twig2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_0_3.name = "twig 0";
  if (endpoint_twig_0_3) {
    mesh_twig_0_3.position.copy(endpoint_twig_0_3.midpoint);
    mesh_twig_0_3.quaternion.copy(endpoint_twig_0_3.quaternion);
  }
  mesh_twig_0_3.castShadow = options.castShadow ?? true;
  mesh_twig_0_3.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_0_3.userData.sculptComponent = {"id": "twig-0", "name": "twig 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.08, 0], "localEnd": [0, 0.08, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.3708, 0.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twig-0-form", "kind": "detail", "description": "twig strands round the rim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_0_3.add(mesh_twig_0_3);
  meshes["twig-0"] = mesh_twig_0_3;
  colliders["twig-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_0_3);

  const endpoint_twig_1_4 = makeAttachmentEndpoint(null);
  const node_twig_1_4 = new THREE.Group();
  node_twig_1_4.name = "twig 1__pivot";
  node_twig_1_4.scale.set(1, 1, 1);
  if (endpoint_twig_1_4) {
    node_twig_1_4.position.copy(endpoint_twig_1_4.start);
    node_twig_1_4.rotation.set(1.4508, 0.5, 0.0);
  } else {
    node_twig_1_4.position.set(0.0, 0.10500000000000001, 0.0);
    node_twig_1_4.rotation.set(1.4508, 0.5, 0.0);
  }
  node_twig_1_4.userData.sculptComponent = {"id": "twig-1", "name": "twig 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.10500000000000001, 0], "localEnd": [0, 0.10500000000000001, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.10500000000000001, 0], "rotation": [1.4508, 0.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_1_4.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_1_4);
  nodes["twig-1"] = node_twig_1_4;
  const mesh_twig_1_4Geometry = endpoint_twig_1_4
    ? new THREE.CylinderGeometry(endpoint_twig_1_4.endRadius, endpoint_twig_1_4.baseRadius, endpoint_twig_1_4.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_1_4) {
    mesh_twig_1_4Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_1_4 = new THREE.Mesh(
    mesh_twig_1_4Geometry,
    materialMap["twig"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_1_4.name = "twig 1";
  if (endpoint_twig_1_4) {
    mesh_twig_1_4.position.copy(endpoint_twig_1_4.midpoint);
    mesh_twig_1_4.quaternion.copy(endpoint_twig_1_4.quaternion);
  }
  mesh_twig_1_4.castShadow = options.castShadow ?? true;
  mesh_twig_1_4.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_1_4.userData.sculptComponent = {"id": "twig-1", "name": "twig 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.10500000000000001, 0], "localEnd": [0, 0.10500000000000001, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.10500000000000001, 0], "rotation": [1.4508, 0.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_1_4.add(mesh_twig_1_4);
  meshes["twig-1"] = mesh_twig_1_4;
  colliders["twig-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_1_4);

  const endpoint_twig_2_5 = makeAttachmentEndpoint(null);
  const node_twig_2_5 = new THREE.Group();
  node_twig_2_5.name = "twig 2__pivot";
  node_twig_2_5.scale.set(1, 1, 1);
  if (endpoint_twig_2_5) {
    node_twig_2_5.position.copy(endpoint_twig_2_5.start);
    node_twig_2_5.rotation.set(1.5308, 1.0, 0.0);
  } else {
    node_twig_2_5.position.set(0.0, 0.13, 0.0);
    node_twig_2_5.rotation.set(1.5308, 1.0, 0.0);
  }
  node_twig_2_5.userData.sculptComponent = {"id": "twig-2", "name": "twig 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.13, 0], "localEnd": [0, 0.13, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.13, 0], "rotation": [1.5308, 1.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_2_5.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_2_5);
  nodes["twig-2"] = node_twig_2_5;
  const mesh_twig_2_5Geometry = endpoint_twig_2_5
    ? new THREE.CylinderGeometry(endpoint_twig_2_5.endRadius, endpoint_twig_2_5.baseRadius, endpoint_twig_2_5.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_2_5) {
    mesh_twig_2_5Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_2_5 = new THREE.Mesh(
    mesh_twig_2_5Geometry,
    materialMap["twig2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_2_5.name = "twig 2";
  if (endpoint_twig_2_5) {
    mesh_twig_2_5.position.copy(endpoint_twig_2_5.midpoint);
    mesh_twig_2_5.quaternion.copy(endpoint_twig_2_5.quaternion);
  }
  mesh_twig_2_5.castShadow = options.castShadow ?? true;
  mesh_twig_2_5.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_2_5.userData.sculptComponent = {"id": "twig-2", "name": "twig 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.13, 0], "localEnd": [0, 0.13, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.13, 0], "rotation": [1.5308, 1.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_2_5.add(mesh_twig_2_5);
  meshes["twig-2"] = mesh_twig_2_5;
  colliders["twig-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_2_5);

  const endpoint_twig_3_6 = makeAttachmentEndpoint(null);
  const node_twig_3_6 = new THREE.Group();
  node_twig_3_6.name = "twig 3__pivot";
  node_twig_3_6.scale.set(1, 1, 1);
  if (endpoint_twig_3_6) {
    node_twig_3_6.position.copy(endpoint_twig_3_6.start);
    node_twig_3_6.rotation.set(1.6108, 1.5, 0.0);
  } else {
    node_twig_3_6.position.set(0.0, 0.08, 0.0);
    node_twig_3_6.rotation.set(1.6108, 1.5, 0.0);
  }
  node_twig_3_6.userData.sculptComponent = {"id": "twig-3", "name": "twig 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.08, 0], "localEnd": [0, 0.08, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.6108, 1.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twig-3-form", "kind": "detail", "description": "crossing twigs", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_3_6.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_3_6);
  nodes["twig-3"] = node_twig_3_6;
  const mesh_twig_3_6Geometry = endpoint_twig_3_6
    ? new THREE.CylinderGeometry(endpoint_twig_3_6.endRadius, endpoint_twig_3_6.baseRadius, endpoint_twig_3_6.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_3_6) {
    mesh_twig_3_6Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_3_6 = new THREE.Mesh(
    mesh_twig_3_6Geometry,
    materialMap["twig"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_3_6.name = "twig 3";
  if (endpoint_twig_3_6) {
    mesh_twig_3_6.position.copy(endpoint_twig_3_6.midpoint);
    mesh_twig_3_6.quaternion.copy(endpoint_twig_3_6.quaternion);
  }
  mesh_twig_3_6.castShadow = options.castShadow ?? true;
  mesh_twig_3_6.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_3_6.userData.sculptComponent = {"id": "twig-3", "name": "twig 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.08, 0], "localEnd": [0, 0.08, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.6108, 1.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "twig-3-form", "kind": "detail", "description": "crossing twigs", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_3_6.add(mesh_twig_3_6);
  meshes["twig-3"] = mesh_twig_3_6;
  colliders["twig-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_3_6);

  const endpoint_twig_4_7 = makeAttachmentEndpoint(null);
  const node_twig_4_7 = new THREE.Group();
  node_twig_4_7.name = "twig 4__pivot";
  node_twig_4_7.scale.set(1, 1, 1);
  if (endpoint_twig_4_7) {
    node_twig_4_7.position.copy(endpoint_twig_4_7.start);
    node_twig_4_7.rotation.set(1.6907999999999999, 2.0, 0.0);
  } else {
    node_twig_4_7.position.set(0.0, 0.10500000000000001, 0.0);
    node_twig_4_7.rotation.set(1.6907999999999999, 2.0, 0.0);
  }
  node_twig_4_7.userData.sculptComponent = {"id": "twig-4", "name": "twig 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.10500000000000001, 0], "localEnd": [0, 0.10500000000000001, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.10500000000000001, 0], "rotation": [1.6907999999999999, 2.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_4_7.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_4_7);
  nodes["twig-4"] = node_twig_4_7;
  const mesh_twig_4_7Geometry = endpoint_twig_4_7
    ? new THREE.CylinderGeometry(endpoint_twig_4_7.endRadius, endpoint_twig_4_7.baseRadius, endpoint_twig_4_7.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_4_7) {
    mesh_twig_4_7Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_4_7 = new THREE.Mesh(
    mesh_twig_4_7Geometry,
    materialMap["twig2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_4_7.name = "twig 4";
  if (endpoint_twig_4_7) {
    mesh_twig_4_7.position.copy(endpoint_twig_4_7.midpoint);
    mesh_twig_4_7.quaternion.copy(endpoint_twig_4_7.quaternion);
  }
  mesh_twig_4_7.castShadow = options.castShadow ?? true;
  mesh_twig_4_7.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_4_7.userData.sculptComponent = {"id": "twig-4", "name": "twig 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.10500000000000001, 0], "localEnd": [0, 0.10500000000000001, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.10500000000000001, 0], "rotation": [1.6907999999999999, 2.0, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig2", "materialLayers": ["twig2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 108, 62, 1.0)", "secondaryAlbedo": "rgba(136, 91, 52, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_4_7.add(mesh_twig_4_7);
  meshes["twig-4"] = mesh_twig_4_7;
  colliders["twig-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_4_7);

  const endpoint_twig_5_8 = makeAttachmentEndpoint(null);
  const node_twig_5_8 = new THREE.Group();
  node_twig_5_8.name = "twig 5__pivot";
  node_twig_5_8.scale.set(1, 1, 1);
  if (endpoint_twig_5_8) {
    node_twig_5_8.position.copy(endpoint_twig_5_8.start);
    node_twig_5_8.rotation.set(1.7708, 2.5, 0.0);
  } else {
    node_twig_5_8.position.set(0.0, 0.13, 0.0);
    node_twig_5_8.rotation.set(1.7708, 2.5, 0.0);
  }
  node_twig_5_8.userData.sculptComponent = {"id": "twig-5", "name": "twig 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.13, 0], "localEnd": [0, 0.13, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.13, 0], "rotation": [1.7708, 2.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_5_8.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_twig_5_8);
  nodes["twig-5"] = node_twig_5_8;
  const mesh_twig_5_8Geometry = endpoint_twig_5_8
    ? new THREE.CylinderGeometry(endpoint_twig_5_8.endRadius, endpoint_twig_5_8.baseRadius, endpoint_twig_5_8.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0225, 24, 96);
  if (!endpoint_twig_5_8) {
    mesh_twig_5_8Geometry.scale(0.5, 0.5, 0.5);
  }
  const mesh_twig_5_8 = new THREE.Mesh(
    mesh_twig_5_8Geometry,
    materialMap["twig"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_twig_5_8.name = "twig 5";
  if (endpoint_twig_5_8) {
    mesh_twig_5_8.position.copy(endpoint_twig_5_8.midpoint);
    mesh_twig_5_8.quaternion.copy(endpoint_twig_5_8.quaternion);
  }
  mesh_twig_5_8.castShadow = options.castShadow ?? true;
  mesh_twig_5_8.receiveShadow = options.receiveShadow ?? true;
  mesh_twig_5_8.userData.sculptComponent = {"id": "twig-5", "name": "twig 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "torus matches the twig-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.05}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.13, 0], "localEnd": [0, 0.13, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.13, 0], "rotation": [1.7708, 2.5, 0], "scale": [0.5, 0.5, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "twig", "materialLayers": ["twig", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 90, 50, 1.0)", "secondaryAlbedo": "rgba(117, 76, 42, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_twig_5_8.add(mesh_twig_5_8);
  meshes["twig-5"] = mesh_twig_5_8;
  colliders["twig-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_twig_5_8);

  const endpoint_egg_0_9 = makeAttachmentEndpoint(null);
  const node_egg_0_9 = new THREE.Group();
  node_egg_0_9.name = "egg 0__pivot";
  node_egg_0_9.scale.set(1, 1, 1);
  if (endpoint_egg_0_9) {
    node_egg_0_9.position.copy(endpoint_egg_0_9.start);
    node_egg_0_9.rotation.set(-0.6000000000000001, 0.0, 0.3);
  } else {
    node_egg_0_9.position.set(-0.07, 0.22, -0.06);
    node_egg_0_9.rotation.set(-0.6000000000000001, 0.0, 0.3);
  }
  node_egg_0_9.userData.sculptComponent = {"id": "egg-0", "name": "egg 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.07, 0.22, -0.06], "localEnd": [-0.07, 0.22, -0.06], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.07, 0.22, -0.06], "rotation": [-0.6000000000000001, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-0-form", "kind": "detail", "description": "shiny eggs", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_0_9.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_egg_0_9);
  nodes["egg-0"] = node_egg_0_9;
  const mesh_egg_0_9Geometry = endpoint_egg_0_9
    ? new THREE.CylinderGeometry(endpoint_egg_0_9.endRadius, endpoint_egg_0_9.baseRadius, endpoint_egg_0_9.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_egg_0_9) {
    mesh_egg_0_9Geometry.scale(0.12, 0.15, 0.12);
  }
  const mesh_egg_0_9 = new THREE.Mesh(
    mesh_egg_0_9Geometry,
    materialMap["egg"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_egg_0_9.name = "egg 0";
  if (endpoint_egg_0_9) {
    mesh_egg_0_9.position.copy(endpoint_egg_0_9.midpoint);
    mesh_egg_0_9.quaternion.copy(endpoint_egg_0_9.quaternion);
  }
  mesh_egg_0_9.castShadow = options.castShadow ?? true;
  mesh_egg_0_9.receiveShadow = options.receiveShadow ?? true;
  mesh_egg_0_9.userData.sculptComponent = {"id": "egg-0", "name": "egg 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.07, 0.22, -0.06], "localEnd": [-0.07, 0.22, -0.06], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.07, 0.22, -0.06], "rotation": [-0.6000000000000001, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-0-form", "kind": "detail", "description": "shiny eggs", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_0_9.add(mesh_egg_0_9);
  meshes["egg-0"] = mesh_egg_0_9;
  colliders["egg-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_egg_0_9);

  const endpoint_egg_1_10 = makeAttachmentEndpoint(null);
  const node_egg_1_10 = new THREE.Group();
  node_egg_1_10.name = "egg 1__pivot";
  node_egg_1_10.scale.set(1, 1, 1);
  if (endpoint_egg_1_10) {
    node_egg_1_10.position.copy(endpoint_egg_1_10.start);
    node_egg_1_10.rotation.set(-0.2, 0.0, 0.3);
  } else {
    node_egg_1_10.position.set(0.08, 0.22, -0.05);
    node_egg_1_10.rotation.set(-0.2, 0.0, 0.3);
  }
  node_egg_1_10.userData.sculptComponent = {"id": "egg-1", "name": "egg 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.08, 0.22, -0.05], "localEnd": [0.08, 0.22, -0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0.08, 0.22, -0.05], "rotation": [-0.2, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_1_10.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_egg_1_10);
  nodes["egg-1"] = node_egg_1_10;
  const mesh_egg_1_10Geometry = endpoint_egg_1_10
    ? new THREE.CylinderGeometry(endpoint_egg_1_10.endRadius, endpoint_egg_1_10.baseRadius, endpoint_egg_1_10.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_egg_1_10) {
    mesh_egg_1_10Geometry.scale(0.12, 0.15, 0.12);
  }
  const mesh_egg_1_10 = new THREE.Mesh(
    mesh_egg_1_10Geometry,
    materialMap["egg"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_egg_1_10.name = "egg 1";
  if (endpoint_egg_1_10) {
    mesh_egg_1_10.position.copy(endpoint_egg_1_10.midpoint);
    mesh_egg_1_10.quaternion.copy(endpoint_egg_1_10.quaternion);
  }
  mesh_egg_1_10.castShadow = options.castShadow ?? true;
  mesh_egg_1_10.receiveShadow = options.receiveShadow ?? true;
  mesh_egg_1_10.userData.sculptComponent = {"id": "egg-1", "name": "egg 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.08, 0.22, -0.05], "localEnd": [0.08, 0.22, -0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0.08, 0.22, -0.05], "rotation": [-0.2, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_1_10.add(mesh_egg_1_10);
  meshes["egg-1"] = mesh_egg_1_10;
  colliders["egg-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_egg_1_10);

  const endpoint_egg_2_11 = makeAttachmentEndpoint(null);
  const node_egg_2_11 = new THREE.Group();
  node_egg_2_11.name = "egg 2__pivot";
  node_egg_2_11.scale.set(1, 1, 1);
  if (endpoint_egg_2_11) {
    node_egg_2_11.position.copy(endpoint_egg_2_11.start);
    node_egg_2_11.rotation.set(0.2, 0.0, 0.3);
  } else {
    node_egg_2_11.position.set(0.0, 0.22, 0.08);
    node_egg_2_11.rotation.set(0.2, 0.0, 0.3);
  }
  node_egg_2_11.userData.sculptComponent = {"id": "egg-2", "name": "egg 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.22, 0.08], "localEnd": [0, 0.22, 0.08], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.22, 0.08], "rotation": [0.2, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-2-form", "kind": "form", "description": "egg-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_2_11.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_egg_2_11);
  nodes["egg-2"] = node_egg_2_11;
  const mesh_egg_2_11Geometry = endpoint_egg_2_11
    ? new THREE.CylinderGeometry(endpoint_egg_2_11.endRadius, endpoint_egg_2_11.baseRadius, endpoint_egg_2_11.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_egg_2_11) {
    mesh_egg_2_11Geometry.scale(0.12, 0.15, 0.12);
  }
  const mesh_egg_2_11 = new THREE.Mesh(
    mesh_egg_2_11Geometry,
    materialMap["egg"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_egg_2_11.name = "egg 2";
  if (endpoint_egg_2_11) {
    mesh_egg_2_11.position.copy(endpoint_egg_2_11.midpoint);
    mesh_egg_2_11.quaternion.copy(endpoint_egg_2_11.quaternion);
  }
  mesh_egg_2_11.castShadow = options.castShadow ?? true;
  mesh_egg_2_11.receiveShadow = options.receiveShadow ?? true;
  mesh_egg_2_11.userData.sculptComponent = {"id": "egg-2", "name": "egg 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.22, 0.08], "localEnd": [0, 0.22, 0.08], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.22, 0.08], "rotation": [0.2, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-2-form", "kind": "form", "description": "egg-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_2_11.add(mesh_egg_2_11);
  meshes["egg-2"] = mesh_egg_2_11;
  colliders["egg-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_egg_2_11);

  const endpoint_egg_3_12 = makeAttachmentEndpoint(null);
  const node_egg_3_12 = new THREE.Group();
  node_egg_3_12.name = "egg 3__pivot";
  node_egg_3_12.scale.set(1, 1, 1);
  if (endpoint_egg_3_12) {
    node_egg_3_12.position.copy(endpoint_egg_3_12.start);
    node_egg_3_12.rotation.set(0.6000000000000001, 0.0, 0.3);
  } else {
    node_egg_3_12.position.set(0.02, 0.24, -0.12);
    node_egg_3_12.rotation.set(0.6000000000000001, 0.0, 0.3);
  }
  node_egg_3_12.userData.sculptComponent = {"id": "egg-3", "name": "egg 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.02, 0.24, -0.12], "localEnd": [0.02, 0.24, -0.12], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0.02, 0.24, -0.12], "rotation": [0.6000000000000001, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-3-form", "kind": "form", "description": "egg-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_3_12.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_egg_3_12);
  nodes["egg-3"] = node_egg_3_12;
  const mesh_egg_3_12Geometry = endpoint_egg_3_12
    ? new THREE.CylinderGeometry(endpoint_egg_3_12.endRadius, endpoint_egg_3_12.baseRadius, endpoint_egg_3_12.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_egg_3_12) {
    mesh_egg_3_12Geometry.scale(0.12, 0.15, 0.12);
  }
  const mesh_egg_3_12 = new THREE.Mesh(
    mesh_egg_3_12Geometry,
    materialMap["egg"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_egg_3_12.name = "egg 3";
  if (endpoint_egg_3_12) {
    mesh_egg_3_12.position.copy(endpoint_egg_3_12.midpoint);
    mesh_egg_3_12.quaternion.copy(endpoint_egg_3_12.quaternion);
  }
  mesh_egg_3_12.castShadow = options.castShadow ?? true;
  mesh_egg_3_12.receiveShadow = options.receiveShadow ?? true;
  mesh_egg_3_12.userData.sculptComponent = {"id": "egg-3", "name": "egg 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the egg-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.02, 0.24, -0.12], "localEnd": [0.02, 0.24, -0.12], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.12, "height": 0.15, "depth": 0.12, "units": "m", "confidence": 0.7}, "transform": {"position": [0.02, 0.24, -0.12], "rotation": [0.6000000000000001, 0, 0.3], "scale": [0.12, 0.15, 0.12]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "egg", "materialLayers": ["egg", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "egg-3-form", "kind": "form", "description": "egg-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(47, 127, 216, 1.0)", "secondaryAlbedo": "rgba(39, 107, 183, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_egg_3_12.add(mesh_egg_3_12);
  meshes["egg-3"] = mesh_egg_3_12;
  colliders["egg-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_egg_3_12);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createToyBirdNestLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Toy Bird Nest look-dev lights";
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
export function createToyBirdNestEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameToyBirdNestCamera(
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
export function createToyBirdNestPresentationComposer(
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

export function configureToyBirdNestRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createToyBirdNestInspectControls(
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
