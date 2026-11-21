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

// Generated from ObjectSculptSpec target: Toy Palm Tree
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createToyPalmTreeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Toy Palm Tree";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["trunk"] = createSculptMaterial(
    "trunk",
    {"id": "trunk", "name": "trunk", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9a6a3c", "color": "#9a6a3c", "albedo": {"dominant": "#9a6a3c", "secondary": ["#825a33", "#a97442"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#9a6a3c", "#825a33", "#a97442"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "trunk-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#a67240", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "trunk-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#7b5430", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["trunk2"] = createSculptMaterial(
    "trunk2",
    {"id": "trunk2", "name": "trunk2", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b07c48", "color": "#b07c48", "albedo": {"dominant": "#b07c48", "secondary": ["#95693d", "#c1884f"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#b07c48", "#95693d", "#c1884f"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.85, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "trunk2-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#be854d", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "trunk2-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#8c6339", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["leaf"] = createSculptMaterial(
    "leaf",
    {"id": "leaf", "name": "leaf", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#43b443", "color": "#43b443", "albedo": {"dominant": "#43b443", "secondary": ["#389938", "#49c649"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#43b443", "#389938", "#49c649"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "leaf-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#48c248", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "leaf-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#359035", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["base"] = createSculptMaterial(
    "base",
    {"id": "base", "name": "base", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#5cc24a", "color": "#5cc24a", "albedo": {"dominant": "#5cc24a", "secondary": ["#4ea43e", "#65d551"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#5cc24a", "#4ea43e", "#65d551"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "base-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#63d14f", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "base-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#499b3b", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["nut"] = createSculptMaterial(
    "nut",
    {"id": "nut", "name": "nut", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6b4628", "color": "#6b4628", "albedo": {"dominant": "#6b4628", "secondary": ["#5a3b22", "#754d2c"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#6b4628", "#5a3b22", "#754d2c"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "nut-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#734b2b", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "nut-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#553820", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "satin plastic coat", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#9a6a3c", "secondary": ["#825a33", "#a97442"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#9a6a3c", "#825a33", "#a97442"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.2, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}, "clearcoat": 0.6},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Toy Palm Tree__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Palm Tree", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
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
    materialMap["trunk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Toy Palm Tree";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Palm Tree", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_base_1 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.35, 0], "localEnd": [0, 0.35, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_base_1 = makeAttachmentEndpoint(attachment_base_1);
  const node_base_1 = new THREE.Group();
  node_base_1.name = "base__pivot";
  node_base_1.scale.set(1, 1, 1);
  if (endpoint_base_1) {
    node_base_1.position.copy(endpoint_base_1.start);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_1.position.set(0.0, 0.35, 0.0);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_1.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the base form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.35, 0], "localEnd": [0, 0.35, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.6, "height": 0.7, "depth": 1.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1.6, 0.7, 1.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "base", "materialLayers": ["base", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-form", "kind": "detail", "description": "rounded base", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 194, 74, 1.0)", "secondaryAlbedo": "rgba(78, 164, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_base_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_base_1);
  nodes["base"] = node_base_1;
  const mesh_base_1Geometry = endpoint_base_1
    ? new THREE.CylinderGeometry(endpoint_base_1.endRadius, endpoint_base_1.baseRadius, endpoint_base_1.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 1);
  if (!endpoint_base_1) {
    mesh_base_1Geometry.scale(1.6, 0.7, 1.6);
  }
  const mesh_base_1 = new THREE.Mesh(
    mesh_base_1Geometry,
    materialMap["base"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_1.name = "base";
  if (endpoint_base_1) {
    mesh_base_1.position.copy(endpoint_base_1.midpoint);
    mesh_base_1.quaternion.copy(endpoint_base_1.quaternion);
  }
  mesh_base_1.castShadow = options.castShadow ?? true;
  mesh_base_1.receiveShadow = options.receiveShadow ?? true;
  mesh_base_1.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the base form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.35, 0], "localEnd": [0, 0.35, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.6, "height": 0.7, "depth": 1.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1.6, 0.7, 1.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "base", "materialLayers": ["base", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-form", "kind": "detail", "description": "rounded base", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 194, 74, 1.0)", "secondaryAlbedo": "rgba(78, 164, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_base_1.add(mesh_base_1);
  meshes["base"] = mesh_base_1;
  colliders["base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_base_1);

  const attachment_trunk_0_2 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.0, 0.75, 0], "localEnd": [-0.0, 0.75, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_0_2 = makeAttachmentEndpoint(attachment_trunk_0_2);
  const node_trunk_0_2 = new THREE.Group();
  node_trunk_0_2.name = "trunk 0__pivot";
  node_trunk_0_2.scale.set(1, 1, 1);
  if (endpoint_trunk_0_2) {
    node_trunk_0_2.position.copy(endpoint_trunk_0_2.start);
    node_trunk_0_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_trunk_0_2.position.set(-0.0, 0.75, 0.0);
    node_trunk_0_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_trunk_0_2.userData.sculptComponent = {"id": "trunk-0", "name": "trunk 0", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.0, 0.75, 0], "localEnd": [-0.0, 0.75, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.6, "depth": 0.42, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.0, 0.75, 0], "rotation": [0, 0, 0.0], "scale": [0.42, 0.6, 0.42]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_0_2.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_0_2);
  nodes["trunk-0"] = node_trunk_0_2;
  const mesh_trunk_0_2Geometry = endpoint_trunk_0_2
    ? new THREE.CylinderGeometry(endpoint_trunk_0_2.endRadius, endpoint_trunk_0_2.baseRadius, endpoint_trunk_0_2.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_0_2) {
    mesh_trunk_0_2Geometry.scale(0.42, 0.6, 0.42);
  }
  const mesh_trunk_0_2 = new THREE.Mesh(
    mesh_trunk_0_2Geometry,
    materialMap["trunk2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_0_2.name = "trunk 0";
  if (endpoint_trunk_0_2) {
    mesh_trunk_0_2.position.copy(endpoint_trunk_0_2.midpoint);
    mesh_trunk_0_2.quaternion.copy(endpoint_trunk_0_2.quaternion);
  }
  mesh_trunk_0_2.castShadow = options.castShadow ?? true;
  mesh_trunk_0_2.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_0_2.userData.sculptComponent = {"id": "trunk-0", "name": "trunk 0", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.0, 0.75, 0], "localEnd": [-0.0, 0.75, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.6, "depth": 0.42, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.0, 0.75, 0], "rotation": [0, 0, 0.0], "scale": [0.42, 0.6, 0.42]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_0_2.add(mesh_trunk_0_2);
  meshes["trunk-0"] = mesh_trunk_0_2;
  colliders["trunk-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_0_2);

  const attachment_trunk_1_3 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.035, 1.3, 0], "localEnd": [-0.035, 1.3, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_1_3 = makeAttachmentEndpoint(attachment_trunk_1_3);
  const node_trunk_1_3 = new THREE.Group();
  node_trunk_1_3.name = "trunk 1__pivot";
  node_trunk_1_3.scale.set(1, 1, 1);
  if (endpoint_trunk_1_3) {
    node_trunk_1_3.position.copy(endpoint_trunk_1_3.start);
    node_trunk_1_3.rotation.set(0.0, 0.0, 0.06);
  } else {
    node_trunk_1_3.position.set(-0.035, 1.3, 0.0);
    node_trunk_1_3.rotation.set(0.0, 0.0, 0.06);
  }
  node_trunk_1_3.userData.sculptComponent = {"id": "trunk-1", "name": "trunk 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.035, 1.3, 0], "localEnd": [-0.035, 1.3, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.408, "height": 0.6, "depth": 0.408, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.035, 1.3, 0], "rotation": [0, 0, 0.06], "scale": [0.408, 0.6, 0.408]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_1_3.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_1_3);
  nodes["trunk-1"] = node_trunk_1_3;
  const mesh_trunk_1_3Geometry = endpoint_trunk_1_3
    ? new THREE.CylinderGeometry(endpoint_trunk_1_3.endRadius, endpoint_trunk_1_3.baseRadius, endpoint_trunk_1_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_1_3) {
    mesh_trunk_1_3Geometry.scale(0.408, 0.6, 0.408);
  }
  const mesh_trunk_1_3 = new THREE.Mesh(
    mesh_trunk_1_3Geometry,
    materialMap["trunk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_1_3.name = "trunk 1";
  if (endpoint_trunk_1_3) {
    mesh_trunk_1_3.position.copy(endpoint_trunk_1_3.midpoint);
    mesh_trunk_1_3.quaternion.copy(endpoint_trunk_1_3.quaternion);
  }
  mesh_trunk_1_3.castShadow = options.castShadow ?? true;
  mesh_trunk_1_3.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_1_3.userData.sculptComponent = {"id": "trunk-1", "name": "trunk 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.035, 1.3, 0], "localEnd": [-0.035, 1.3, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.408, "height": 0.6, "depth": 0.408, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.035, 1.3, 0], "rotation": [0, 0, 0.06], "scale": [0.408, 0.6, 0.408]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_1_3.add(mesh_trunk_1_3);
  meshes["trunk-1"] = mesh_trunk_1_3;
  colliders["trunk-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_1_3);

  const attachment_trunk_2_4 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.14, 1.85, 0], "localEnd": [-0.14, 1.85, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_2_4 = makeAttachmentEndpoint(attachment_trunk_2_4);
  const node_trunk_2_4 = new THREE.Group();
  node_trunk_2_4.name = "trunk 2__pivot";
  node_trunk_2_4.scale.set(1, 1, 1);
  if (endpoint_trunk_2_4) {
    node_trunk_2_4.position.copy(endpoint_trunk_2_4.start);
    node_trunk_2_4.rotation.set(0.0, 0.0, 0.12);
  } else {
    node_trunk_2_4.position.set(-0.14, 1.85, 0.0);
    node_trunk_2_4.rotation.set(0.0, 0.0, 0.12);
  }
  node_trunk_2_4.userData.sculptComponent = {"id": "trunk-2", "name": "trunk 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.14, 1.85, 0], "localEnd": [-0.14, 1.85, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.39599999999999996, "height": 0.6, "depth": 0.39599999999999996, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.14, 1.85, 0], "rotation": [0, 0, 0.12], "scale": [0.39599999999999996, 0.6, 0.39599999999999996]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_2_4.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_2_4);
  nodes["trunk-2"] = node_trunk_2_4;
  const mesh_trunk_2_4Geometry = endpoint_trunk_2_4
    ? new THREE.CylinderGeometry(endpoint_trunk_2_4.endRadius, endpoint_trunk_2_4.baseRadius, endpoint_trunk_2_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_2_4) {
    mesh_trunk_2_4Geometry.scale(0.39599999999999996, 0.6, 0.39599999999999996);
  }
  const mesh_trunk_2_4 = new THREE.Mesh(
    mesh_trunk_2_4Geometry,
    materialMap["trunk2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_2_4.name = "trunk 2";
  if (endpoint_trunk_2_4) {
    mesh_trunk_2_4.position.copy(endpoint_trunk_2_4.midpoint);
    mesh_trunk_2_4.quaternion.copy(endpoint_trunk_2_4.quaternion);
  }
  mesh_trunk_2_4.castShadow = options.castShadow ?? true;
  mesh_trunk_2_4.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_2_4.userData.sculptComponent = {"id": "trunk-2", "name": "trunk 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.14, 1.85, 0], "localEnd": [-0.14, 1.85, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.39599999999999996, "height": 0.6, "depth": 0.39599999999999996, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.14, 1.85, 0], "rotation": [0, 0, 0.12], "scale": [0.39599999999999996, 0.6, 0.39599999999999996]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_2_4.add(mesh_trunk_2_4);
  meshes["trunk-2"] = mesh_trunk_2_4;
  colliders["trunk-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_2_4);

  const attachment_trunk_3_5 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.315, 2.4, 0], "localEnd": [-0.315, 2.4, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_3_5 = makeAttachmentEndpoint(attachment_trunk_3_5);
  const node_trunk_3_5 = new THREE.Group();
  node_trunk_3_5.name = "trunk 3__pivot";
  node_trunk_3_5.scale.set(1, 1, 1);
  if (endpoint_trunk_3_5) {
    node_trunk_3_5.position.copy(endpoint_trunk_3_5.start);
    node_trunk_3_5.rotation.set(0.0, 0.0, 0.18);
  } else {
    node_trunk_3_5.position.set(-0.315, 2.4, 0.0);
    node_trunk_3_5.rotation.set(0.0, 0.0, 0.18);
  }
  node_trunk_3_5.userData.sculptComponent = {"id": "trunk-3", "name": "trunk 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.315, 2.4, 0], "localEnd": [-0.315, 2.4, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.384, "height": 0.6, "depth": 0.384, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.315, 2.4, 0], "rotation": [0, 0, 0.18], "scale": [0.384, 0.6, 0.384]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "trunk-3-form", "kind": "detail", "description": "trunk in stacked rings", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_3_5.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_3_5);
  nodes["trunk-3"] = node_trunk_3_5;
  const mesh_trunk_3_5Geometry = endpoint_trunk_3_5
    ? new THREE.CylinderGeometry(endpoint_trunk_3_5.endRadius, endpoint_trunk_3_5.baseRadius, endpoint_trunk_3_5.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_3_5) {
    mesh_trunk_3_5Geometry.scale(0.384, 0.6, 0.384);
  }
  const mesh_trunk_3_5 = new THREE.Mesh(
    mesh_trunk_3_5Geometry,
    materialMap["trunk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_3_5.name = "trunk 3";
  if (endpoint_trunk_3_5) {
    mesh_trunk_3_5.position.copy(endpoint_trunk_3_5.midpoint);
    mesh_trunk_3_5.quaternion.copy(endpoint_trunk_3_5.quaternion);
  }
  mesh_trunk_3_5.castShadow = options.castShadow ?? true;
  mesh_trunk_3_5.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_3_5.userData.sculptComponent = {"id": "trunk-3", "name": "trunk 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.315, 2.4, 0], "localEnd": [-0.315, 2.4, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.384, "height": 0.6, "depth": 0.384, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.315, 2.4, 0], "rotation": [0, 0, 0.18], "scale": [0.384, 0.6, 0.384]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "trunk-3-form", "kind": "detail", "description": "trunk in stacked rings", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_3_5.add(mesh_trunk_3_5);
  meshes["trunk-3"] = mesh_trunk_3_5;
  colliders["trunk-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_3_5);

  const attachment_trunk_4_6 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.56, 2.95, 0], "localEnd": [-0.56, 2.95, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_4_6 = makeAttachmentEndpoint(attachment_trunk_4_6);
  const node_trunk_4_6 = new THREE.Group();
  node_trunk_4_6.name = "trunk 4__pivot";
  node_trunk_4_6.scale.set(1, 1, 1);
  if (endpoint_trunk_4_6) {
    node_trunk_4_6.position.copy(endpoint_trunk_4_6.start);
    node_trunk_4_6.rotation.set(0.0, 0.0, 0.24);
  } else {
    node_trunk_4_6.position.set(-0.56, 2.95, 0.0);
    node_trunk_4_6.rotation.set(0.0, 0.0, 0.24);
  }
  node_trunk_4_6.userData.sculptComponent = {"id": "trunk-4", "name": "trunk 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.56, 2.95, 0], "localEnd": [-0.56, 2.95, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.372, "height": 0.6, "depth": 0.372, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.56, 2.95, 0], "rotation": [0, 0, 0.24], "scale": [0.372, 0.6, 0.372]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_4_6.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_4_6);
  nodes["trunk-4"] = node_trunk_4_6;
  const mesh_trunk_4_6Geometry = endpoint_trunk_4_6
    ? new THREE.CylinderGeometry(endpoint_trunk_4_6.endRadius, endpoint_trunk_4_6.baseRadius, endpoint_trunk_4_6.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_4_6) {
    mesh_trunk_4_6Geometry.scale(0.372, 0.6, 0.372);
  }
  const mesh_trunk_4_6 = new THREE.Mesh(
    mesh_trunk_4_6Geometry,
    materialMap["trunk2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_4_6.name = "trunk 4";
  if (endpoint_trunk_4_6) {
    mesh_trunk_4_6.position.copy(endpoint_trunk_4_6.midpoint);
    mesh_trunk_4_6.quaternion.copy(endpoint_trunk_4_6.quaternion);
  }
  mesh_trunk_4_6.castShadow = options.castShadow ?? true;
  mesh_trunk_4_6.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_4_6.userData.sculptComponent = {"id": "trunk-4", "name": "trunk 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.56, 2.95, 0], "localEnd": [-0.56, 2.95, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.372, "height": 0.6, "depth": 0.372, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.56, 2.95, 0], "rotation": [0, 0, 0.24], "scale": [0.372, 0.6, 0.372]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_4_6.add(mesh_trunk_4_6);
  meshes["trunk-4"] = mesh_trunk_4_6;
  colliders["trunk-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_4_6);

  const attachment_trunk_5_7 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.875, 3.5, 0], "localEnd": [-0.875, 3.5, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_5_7 = makeAttachmentEndpoint(attachment_trunk_5_7);
  const node_trunk_5_7 = new THREE.Group();
  node_trunk_5_7.name = "trunk 5__pivot";
  node_trunk_5_7.scale.set(1, 1, 1);
  if (endpoint_trunk_5_7) {
    node_trunk_5_7.position.copy(endpoint_trunk_5_7.start);
    node_trunk_5_7.rotation.set(0.0, 0.0, 0.3);
  } else {
    node_trunk_5_7.position.set(-0.875, 3.5, 0.0);
    node_trunk_5_7.rotation.set(0.0, 0.0, 0.3);
  }
  node_trunk_5_7.userData.sculptComponent = {"id": "trunk-5", "name": "trunk 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.875, 3.5, 0], "localEnd": [-0.875, 3.5, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.6, "depth": 0.36, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.875, 3.5, 0], "rotation": [0, 0, 0.3], "scale": [0.36, 0.6, 0.36]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_5_7.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_5_7);
  nodes["trunk-5"] = node_trunk_5_7;
  const mesh_trunk_5_7Geometry = endpoint_trunk_5_7
    ? new THREE.CylinderGeometry(endpoint_trunk_5_7.endRadius, endpoint_trunk_5_7.baseRadius, endpoint_trunk_5_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_5_7) {
    mesh_trunk_5_7Geometry.scale(0.36, 0.6, 0.36);
  }
  const mesh_trunk_5_7 = new THREE.Mesh(
    mesh_trunk_5_7Geometry,
    materialMap["trunk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_5_7.name = "trunk 5";
  if (endpoint_trunk_5_7) {
    mesh_trunk_5_7.position.copy(endpoint_trunk_5_7.midpoint);
    mesh_trunk_5_7.quaternion.copy(endpoint_trunk_5_7.quaternion);
  }
  mesh_trunk_5_7.castShadow = options.castShadow ?? true;
  mesh_trunk_5_7.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_5_7.userData.sculptComponent = {"id": "trunk-5", "name": "trunk 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.875, 3.5, 0], "localEnd": [-0.875, 3.5, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.6, "depth": 0.36, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.875, 3.5, 0], "rotation": [0, 0, 0.3], "scale": [0.36, 0.6, 0.36]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_5_7.add(mesh_trunk_5_7);
  meshes["trunk-5"] = mesh_trunk_5_7;
  colliders["trunk-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_5_7);

  const attachment_trunk_6_8 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.26, 4.05, 0], "localEnd": [-1.26, 4.05, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_6_8 = makeAttachmentEndpoint(attachment_trunk_6_8);
  const node_trunk_6_8 = new THREE.Group();
  node_trunk_6_8.name = "trunk 6__pivot";
  node_trunk_6_8.scale.set(1, 1, 1);
  if (endpoint_trunk_6_8) {
    node_trunk_6_8.position.copy(endpoint_trunk_6_8.start);
    node_trunk_6_8.rotation.set(0.0, 0.0, 0.36);
  } else {
    node_trunk_6_8.position.set(-1.26, 4.05, 0.0);
    node_trunk_6_8.rotation.set(0.0, 0.0, 0.36);
  }
  node_trunk_6_8.userData.sculptComponent = {"id": "trunk-6", "name": "trunk 6", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.26, 4.05, 0], "localEnd": [-1.26, 4.05, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.348, "height": 0.6, "depth": 0.348, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.26, 4.05, 0], "rotation": [0, 0, 0.36], "scale": [0.348, 0.6, 0.348]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_6_8.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_6_8);
  nodes["trunk-6"] = node_trunk_6_8;
  const mesh_trunk_6_8Geometry = endpoint_trunk_6_8
    ? new THREE.CylinderGeometry(endpoint_trunk_6_8.endRadius, endpoint_trunk_6_8.baseRadius, endpoint_trunk_6_8.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_6_8) {
    mesh_trunk_6_8Geometry.scale(0.348, 0.6, 0.348);
  }
  const mesh_trunk_6_8 = new THREE.Mesh(
    mesh_trunk_6_8Geometry,
    materialMap["trunk2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_6_8.name = "trunk 6";
  if (endpoint_trunk_6_8) {
    mesh_trunk_6_8.position.copy(endpoint_trunk_6_8.midpoint);
    mesh_trunk_6_8.quaternion.copy(endpoint_trunk_6_8.quaternion);
  }
  mesh_trunk_6_8.castShadow = options.castShadow ?? true;
  mesh_trunk_6_8.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_6_8.userData.sculptComponent = {"id": "trunk-6", "name": "trunk 6", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.26, 4.05, 0], "localEnd": [-1.26, 4.05, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.348, "height": 0.6, "depth": 0.348, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.26, 4.05, 0], "rotation": [0, 0, 0.36], "scale": [0.348, 0.6, 0.348]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk2", "materialLayers": ["trunk2", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(176, 124, 72, 1.0)", "secondaryAlbedo": "rgba(149, 105, 61, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_6_8.add(mesh_trunk_6_8);
  meshes["trunk-6"] = mesh_trunk_6_8;
  colliders["trunk-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_6_8);

  const attachment_trunk_7_9 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.715, 4.6, 0], "localEnd": [-1.715, 4.6, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_trunk_7_9 = makeAttachmentEndpoint(attachment_trunk_7_9);
  const node_trunk_7_9 = new THREE.Group();
  node_trunk_7_9.name = "trunk 7__pivot";
  node_trunk_7_9.scale.set(1, 1, 1);
  if (endpoint_trunk_7_9) {
    node_trunk_7_9.position.copy(endpoint_trunk_7_9.start);
    node_trunk_7_9.rotation.set(0.0, 0.0, 0.42);
  } else {
    node_trunk_7_9.position.set(-1.715, 4.6, 0.0);
    node_trunk_7_9.rotation.set(0.0, 0.0, 0.42);
  }
  node_trunk_7_9.userData.sculptComponent = {"id": "trunk-7", "name": "trunk 7", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.715, 4.6, 0], "localEnd": [-1.715, 4.6, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.33599999999999997, "height": 0.6, "depth": 0.33599999999999997, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.715, 4.6, 0], "rotation": [0, 0, 0.42], "scale": [0.33599999999999997, 0.6, 0.33599999999999997]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_7_9.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_trunk_7_9);
  nodes["trunk-7"] = node_trunk_7_9;
  const mesh_trunk_7_9Geometry = endpoint_trunk_7_9
    ? new THREE.CylinderGeometry(endpoint_trunk_7_9.endRadius, endpoint_trunk_7_9.baseRadius, endpoint_trunk_7_9.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_trunk_7_9) {
    mesh_trunk_7_9Geometry.scale(0.33599999999999997, 0.6, 0.33599999999999997);
  }
  const mesh_trunk_7_9 = new THREE.Mesh(
    mesh_trunk_7_9Geometry,
    materialMap["trunk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_7_9.name = "trunk 7";
  if (endpoint_trunk_7_9) {
    mesh_trunk_7_9.position.copy(endpoint_trunk_7_9.midpoint);
    mesh_trunk_7_9.quaternion.copy(endpoint_trunk_7_9.quaternion);
  }
  mesh_trunk_7_9.castShadow = options.castShadow ?? true;
  mesh_trunk_7_9.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_7_9.userData.sculptComponent = {"id": "trunk-7", "name": "trunk 7", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "cylinder matches the trunk-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.715, 4.6, 0], "localEnd": [-1.715, 4.6, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.33599999999999997, "height": 0.6, "depth": 0.33599999999999997, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.715, 4.6, 0], "rotation": [0, 0, 0.42], "scale": [0.33599999999999997, 0.6, 0.33599999999999997]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "trunk", "materialLayers": ["trunk", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 106, 60, 1.0)", "secondaryAlbedo": "rgba(130, 90, 51, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8}};
  node_trunk_7_9.add(mesh_trunk_7_9);
  meshes["trunk-7"] = mesh_trunk_7_9;
  colliders["trunk-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_trunk_7_9);

  const endpoint_frond_0_10 = makeAttachmentEndpoint(null);
  const node_frond_0_10 = new THREE.Group();
  node_frond_0_10.name = "frond 0__pivot";
  node_frond_0_10.scale.set(1, 1, 1);
  if (endpoint_frond_0_10) {
    node_frond_0_10.position.copy(endpoint_frond_0_10.start);
    node_frond_0_10.rotation.set(0.0, -0.0, -0.5);
  } else {
    node_frond_0_10.position.set(-0.8, 4.9, 0.0);
    node_frond_0_10.rotation.set(0.0, -0.0, -0.5);
  }
  node_frond_0_10.userData.sculptComponent = {"id": "frond-0", "name": "frond 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.8, 4.9, 0.0], "localEnd": [-0.8, 4.9, 0.0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.8, 4.9, 0.0], "rotation": [0, -0.0, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_0_10.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_0_10);
  nodes["frond-0"] = node_frond_0_10;
  const mesh_frond_0_10Geometry = endpoint_frond_0_10
    ? new THREE.CylinderGeometry(endpoint_frond_0_10.endRadius, endpoint_frond_0_10.baseRadius, endpoint_frond_0_10.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_0_10) {
    mesh_frond_0_10Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_0_10 = new THREE.Mesh(
    mesh_frond_0_10Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_0_10.name = "frond 0";
  if (endpoint_frond_0_10) {
    mesh_frond_0_10.position.copy(endpoint_frond_0_10.midpoint);
    mesh_frond_0_10.quaternion.copy(endpoint_frond_0_10.quaternion);
  }
  mesh_frond_0_10.castShadow = options.castShadow ?? true;
  mesh_frond_0_10.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_0_10.userData.sculptComponent = {"id": "frond-0", "name": "frond 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-0.8, 4.9, 0.0], "localEnd": [-0.8, 4.9, 0.0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-0.8, 4.9, 0.0], "rotation": [0, -0.0, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_0_10.add(mesh_frond_0_10);
  meshes["frond-0"] = mesh_frond_0_10;
  colliders["frond-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_0_10);

  const endpoint_frond_1_11 = makeAttachmentEndpoint(null);
  const node_frond_1_11 = new THREE.Group();
  node_frond_1_11.name = "frond 1__pivot";
  node_frond_1_11.scale.set(1, 1, 1);
  if (endpoint_frond_1_11) {
    node_frond_1_11.position.copy(endpoint_frond_1_11.start);
    node_frond_1_11.rotation.set(0.0, -0.9, -0.5);
  } else {
    node_frond_1_11.position.set(-1.25, 4.9, 0.94);
    node_frond_1_11.rotation.set(0.0, -0.9, -0.5);
  }
  node_frond_1_11.userData.sculptComponent = {"id": "frond-1", "name": "frond 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.25, 4.9, 0.94], "localEnd": [-1.25, 4.9, 0.94], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.25, 4.9, 0.94], "rotation": [0, -0.9, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "frond-1-form", "kind": "detail", "description": "front frond", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_1_11.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_1_11);
  nodes["frond-1"] = node_frond_1_11;
  const mesh_frond_1_11Geometry = endpoint_frond_1_11
    ? new THREE.CylinderGeometry(endpoint_frond_1_11.endRadius, endpoint_frond_1_11.baseRadius, endpoint_frond_1_11.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_1_11) {
    mesh_frond_1_11Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_1_11 = new THREE.Mesh(
    mesh_frond_1_11Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_1_11.name = "frond 1";
  if (endpoint_frond_1_11) {
    mesh_frond_1_11.position.copy(endpoint_frond_1_11.midpoint);
    mesh_frond_1_11.quaternion.copy(endpoint_frond_1_11.quaternion);
  }
  mesh_frond_1_11.castShadow = options.castShadow ?? true;
  mesh_frond_1_11.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_1_11.userData.sculptComponent = {"id": "frond-1", "name": "frond 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.25, 4.9, 0.94], "localEnd": [-1.25, 4.9, 0.94], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.25, 4.9, 0.94], "rotation": [0, -0.9, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "frond-1-form", "kind": "detail", "description": "front frond", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_1_11.add(mesh_frond_1_11);
  meshes["frond-1"] = mesh_frond_1_11;
  colliders["frond-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_1_11);

  const endpoint_frond_2_12 = makeAttachmentEndpoint(null);
  const node_frond_2_12 = new THREE.Group();
  node_frond_2_12.name = "frond 2__pivot";
  node_frond_2_12.scale.set(1, 1, 1);
  if (endpoint_frond_2_12) {
    node_frond_2_12.position.copy(endpoint_frond_2_12.start);
    node_frond_2_12.rotation.set(0.0, -1.8, -0.5);
  } else {
    node_frond_2_12.position.set(-2.27, 4.9, 1.17);
    node_frond_2_12.rotation.set(0.0, -1.8, -0.5);
  }
  node_frond_2_12.userData.sculptComponent = {"id": "frond-2", "name": "frond 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.27, 4.9, 1.17], "localEnd": [-2.27, 4.9, 1.17], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.27, 4.9, 1.17], "rotation": [0, -1.8, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_2_12.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_2_12);
  nodes["frond-2"] = node_frond_2_12;
  const mesh_frond_2_12Geometry = endpoint_frond_2_12
    ? new THREE.CylinderGeometry(endpoint_frond_2_12.endRadius, endpoint_frond_2_12.baseRadius, endpoint_frond_2_12.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_2_12) {
    mesh_frond_2_12Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_2_12 = new THREE.Mesh(
    mesh_frond_2_12Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_2_12.name = "frond 2";
  if (endpoint_frond_2_12) {
    mesh_frond_2_12.position.copy(endpoint_frond_2_12.midpoint);
    mesh_frond_2_12.quaternion.copy(endpoint_frond_2_12.quaternion);
  }
  mesh_frond_2_12.castShadow = options.castShadow ?? true;
  mesh_frond_2_12.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_2_12.userData.sculptComponent = {"id": "frond-2", "name": "frond 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.27, 4.9, 1.17], "localEnd": [-2.27, 4.9, 1.17], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.27, 4.9, 1.17], "rotation": [0, -1.8, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_2_12.add(mesh_frond_2_12);
  meshes["frond-2"] = mesh_frond_2_12;
  colliders["frond-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_2_12);

  const endpoint_frond_3_13 = makeAttachmentEndpoint(null);
  const node_frond_3_13 = new THREE.Group();
  node_frond_3_13.name = "frond 3__pivot";
  node_frond_3_13.scale.set(1, 1, 1);
  if (endpoint_frond_3_13) {
    node_frond_3_13.position.copy(endpoint_frond_3_13.start);
    node_frond_3_13.rotation.set(0.0, -2.69, -0.5);
  } else {
    node_frond_3_13.position.set(-3.08, 4.9, 0.52);
    node_frond_3_13.rotation.set(0.0, -2.69, -0.5);
  }
  node_frond_3_13.userData.sculptComponent = {"id": "frond-3", "name": "frond 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-3.08, 4.9, 0.52], "localEnd": [-3.08, 4.9, 0.52], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-3.08, 4.9, 0.52], "rotation": [0, -2.69, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_3_13.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_3_13);
  nodes["frond-3"] = node_frond_3_13;
  const mesh_frond_3_13Geometry = endpoint_frond_3_13
    ? new THREE.CylinderGeometry(endpoint_frond_3_13.endRadius, endpoint_frond_3_13.baseRadius, endpoint_frond_3_13.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_3_13) {
    mesh_frond_3_13Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_3_13 = new THREE.Mesh(
    mesh_frond_3_13Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_3_13.name = "frond 3";
  if (endpoint_frond_3_13) {
    mesh_frond_3_13.position.copy(endpoint_frond_3_13.midpoint);
    mesh_frond_3_13.quaternion.copy(endpoint_frond_3_13.quaternion);
  }
  mesh_frond_3_13.castShadow = options.castShadow ?? true;
  mesh_frond_3_13.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_3_13.userData.sculptComponent = {"id": "frond-3", "name": "frond 3", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-3.08, 4.9, 0.52], "localEnd": [-3.08, 4.9, 0.52], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-3.08, 4.9, 0.52], "rotation": [0, -2.69, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_3_13.add(mesh_frond_3_13);
  meshes["frond-3"] = mesh_frond_3_13;
  colliders["frond-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_3_13);

  const endpoint_frond_4_14 = makeAttachmentEndpoint(null);
  const node_frond_4_14 = new THREE.Group();
  node_frond_4_14.name = "frond 4__pivot";
  node_frond_4_14.scale.set(1, 1, 1);
  if (endpoint_frond_4_14) {
    node_frond_4_14.position.copy(endpoint_frond_4_14.start);
    node_frond_4_14.rotation.set(0.0, -3.59, -0.5);
  } else {
    node_frond_4_14.position.set(-3.08, 4.9, -0.52);
    node_frond_4_14.rotation.set(0.0, -3.59, -0.5);
  }
  node_frond_4_14.userData.sculptComponent = {"id": "frond-4", "name": "frond 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-3.08, 4.9, -0.52], "localEnd": [-3.08, 4.9, -0.52], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-3.08, 4.9, -0.52], "rotation": [0, -3.59, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "frond-4-form", "kind": "detail", "description": "back frond", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_4_14.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_4_14);
  nodes["frond-4"] = node_frond_4_14;
  const mesh_frond_4_14Geometry = endpoint_frond_4_14
    ? new THREE.CylinderGeometry(endpoint_frond_4_14.endRadius, endpoint_frond_4_14.baseRadius, endpoint_frond_4_14.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_4_14) {
    mesh_frond_4_14Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_4_14 = new THREE.Mesh(
    mesh_frond_4_14Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_4_14.name = "frond 4";
  if (endpoint_frond_4_14) {
    mesh_frond_4_14.position.copy(endpoint_frond_4_14.midpoint);
    mesh_frond_4_14.quaternion.copy(endpoint_frond_4_14.quaternion);
  }
  mesh_frond_4_14.castShadow = options.castShadow ?? true;
  mesh_frond_4_14.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_4_14.userData.sculptComponent = {"id": "frond-4", "name": "frond 4", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-3.08, 4.9, -0.52], "localEnd": [-3.08, 4.9, -0.52], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-3.08, 4.9, -0.52], "rotation": [0, -3.59, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "frond-4-form", "kind": "detail", "description": "back frond", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_4_14.add(mesh_frond_4_14);
  meshes["frond-4"] = mesh_frond_4_14;
  colliders["frond-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_4_14);

  const endpoint_frond_5_15 = makeAttachmentEndpoint(null);
  const node_frond_5_15 = new THREE.Group();
  node_frond_5_15.name = "frond 5__pivot";
  node_frond_5_15.scale.set(1, 1, 1);
  if (endpoint_frond_5_15) {
    node_frond_5_15.position.copy(endpoint_frond_5_15.start);
    node_frond_5_15.rotation.set(0.0, -4.49, -0.5);
  } else {
    node_frond_5_15.position.set(-2.27, 4.9, -1.17);
    node_frond_5_15.rotation.set(0.0, -4.49, -0.5);
  }
  node_frond_5_15.userData.sculptComponent = {"id": "frond-5", "name": "frond 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.27, 4.9, -1.17], "localEnd": [-2.27, 4.9, -1.17], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.27, 4.9, -1.17], "rotation": [0, -4.49, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_5_15.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_5_15);
  nodes["frond-5"] = node_frond_5_15;
  const mesh_frond_5_15Geometry = endpoint_frond_5_15
    ? new THREE.CylinderGeometry(endpoint_frond_5_15.endRadius, endpoint_frond_5_15.baseRadius, endpoint_frond_5_15.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_5_15) {
    mesh_frond_5_15Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_5_15 = new THREE.Mesh(
    mesh_frond_5_15Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_5_15.name = "frond 5";
  if (endpoint_frond_5_15) {
    mesh_frond_5_15.position.copy(endpoint_frond_5_15.midpoint);
    mesh_frond_5_15.quaternion.copy(endpoint_frond_5_15.quaternion);
  }
  mesh_frond_5_15.castShadow = options.castShadow ?? true;
  mesh_frond_5_15.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_5_15.userData.sculptComponent = {"id": "frond-5", "name": "frond 5", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.27, 4.9, -1.17], "localEnd": [-2.27, 4.9, -1.17], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.27, 4.9, -1.17], "rotation": [0, -4.49, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_5_15.add(mesh_frond_5_15);
  meshes["frond-5"] = mesh_frond_5_15;
  colliders["frond-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_5_15);

  const endpoint_frond_6_16 = makeAttachmentEndpoint(null);
  const node_frond_6_16 = new THREE.Group();
  node_frond_6_16.name = "frond 6__pivot";
  node_frond_6_16.scale.set(1, 1, 1);
  if (endpoint_frond_6_16) {
    node_frond_6_16.position.copy(endpoint_frond_6_16.start);
    node_frond_6_16.rotation.set(0.0, -5.39, -0.5);
  } else {
    node_frond_6_16.position.set(-1.25, 4.9, -0.94);
    node_frond_6_16.rotation.set(0.0, -5.39, -0.5);
  }
  node_frond_6_16.userData.sculptComponent = {"id": "frond-6", "name": "frond 6", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.25, 4.9, -0.94], "localEnd": [-1.25, 4.9, -0.94], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.25, 4.9, -0.94], "rotation": [0, -5.39, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_6_16.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_frond_6_16);
  nodes["frond-6"] = node_frond_6_16;
  const mesh_frond_6_16Geometry = endpoint_frond_6_16
    ? new THREE.CylinderGeometry(endpoint_frond_6_16.endRadius, endpoint_frond_6_16.baseRadius, endpoint_frond_6_16.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_frond_6_16) {
    mesh_frond_6_16Geometry.scale(2.8, 0.22, 0.95);
  }
  const mesh_frond_6_16 = new THREE.Mesh(
    mesh_frond_6_16Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frond_6_16.name = "frond 6";
  if (endpoint_frond_6_16) {
    mesh_frond_6_16.position.copy(endpoint_frond_6_16.midpoint);
    mesh_frond_6_16.quaternion.copy(endpoint_frond_6_16.quaternion);
  }
  mesh_frond_6_16.castShadow = options.castShadow ?? true;
  mesh_frond_6_16.receiveShadow = options.receiveShadow ?? true;
  mesh_frond_6_16.userData.sculptComponent = {"id": "frond-6", "name": "frond 6", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "ellipsoid matches the frond-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.25, 4.9, -0.94], "localEnd": [-1.25, 4.9, -0.94], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8, "height": 0.22, "depth": 0.95, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.25, 4.9, -0.94], "rotation": [0, -5.39, -0.5], "scale": [2.8, 0.22, 0.95]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "leaf", "materialLayers": ["leaf", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(67, 180, 67, 1.0)", "secondaryAlbedo": "rgba(56, 153, 56, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_frond_6_16.add(mesh_frond_6_16);
  meshes["frond-6"] = mesh_frond_6_16;
  colliders["frond-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_frond_6_16);

  const endpoint_coconut_a_17 = makeAttachmentEndpoint(null);
  const node_coconut_a_17 = new THREE.Group();
  node_coconut_a_17.name = "coconut a__pivot";
  node_coconut_a_17.scale.set(1, 1, 1);
  if (endpoint_coconut_a_17) {
    node_coconut_a_17.position.copy(endpoint_coconut_a_17.start);
    node_coconut_a_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_coconut_a_17.position.set(-1.85, 4.85, 0.18);
    node_coconut_a_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_coconut_a_17.userData.sculptComponent = {"id": "coconut-a", "name": "coconut a", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "sphere matches the coconut-a form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.85, 4.85, 0.18], "localEnd": [-1.85, 4.85, 0.18], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.85, 4.85, 0.18], "rotation": [0, 0, 0], "scale": [0.3, 0.3, 0.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "nut", "materialLayers": ["nut", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "coconut-a-form", "kind": "form", "description": "coconut-a shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 70, 40, 1.0)", "secondaryAlbedo": "rgba(90, 59, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_coconut_a_17.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_coconut_a_17);
  nodes["coconut-a"] = node_coconut_a_17;
  const mesh_coconut_a_17Geometry = endpoint_coconut_a_17
    ? new THREE.CylinderGeometry(endpoint_coconut_a_17.endRadius, endpoint_coconut_a_17.baseRadius, endpoint_coconut_a_17.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_coconut_a_17) {
    mesh_coconut_a_17Geometry.scale(0.3, 0.3, 0.3);
  }
  const mesh_coconut_a_17 = new THREE.Mesh(
    mesh_coconut_a_17Geometry,
    materialMap["nut"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coconut_a_17.name = "coconut a";
  if (endpoint_coconut_a_17) {
    mesh_coconut_a_17.position.copy(endpoint_coconut_a_17.midpoint);
    mesh_coconut_a_17.quaternion.copy(endpoint_coconut_a_17.quaternion);
  }
  mesh_coconut_a_17.castShadow = options.castShadow ?? true;
  mesh_coconut_a_17.receiveShadow = options.receiveShadow ?? true;
  mesh_coconut_a_17.userData.sculptComponent = {"id": "coconut-a", "name": "coconut a", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "sphere matches the coconut-a form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-1.85, 4.85, 0.18], "localEnd": [-1.85, 4.85, 0.18], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-1.85, 4.85, 0.18], "rotation": [0, 0, 0], "scale": [0.3, 0.3, 0.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "nut", "materialLayers": ["nut", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "coconut-a-form", "kind": "form", "description": "coconut-a shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 70, 40, 1.0)", "secondaryAlbedo": "rgba(90, 59, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_coconut_a_17.add(mesh_coconut_a_17);
  meshes["coconut-a"] = mesh_coconut_a_17;
  colliders["coconut-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_coconut_a_17);

  const endpoint_coconut_b_18 = makeAttachmentEndpoint(null);
  const node_coconut_b_18 = new THREE.Group();
  node_coconut_b_18.name = "coconut b__pivot";
  node_coconut_b_18.scale.set(1, 1, 1);
  if (endpoint_coconut_b_18) {
    node_coconut_b_18.position.copy(endpoint_coconut_b_18.start);
    node_coconut_b_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_coconut_b_18.position.set(-2.15, 4.85, -0.12);
    node_coconut_b_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_coconut_b_18.userData.sculptComponent = {"id": "coconut-b", "name": "coconut b", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "sphere matches the coconut-b form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.15, 4.85, -0.12], "localEnd": [-2.15, 4.85, -0.12], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.15, 4.85, -0.12], "rotation": [0, 0, 0], "scale": [0.3, 0.3, 0.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "nut", "materialLayers": ["nut", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "coconut-b-form", "kind": "form", "description": "coconut-b shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 70, 40, 1.0)", "secondaryAlbedo": "rgba(90, 59, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_coconut_b_18.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_coconut_b_18);
  nodes["coconut-b"] = node_coconut_b_18;
  const mesh_coconut_b_18Geometry = endpoint_coconut_b_18
    ? new THREE.CylinderGeometry(endpoint_coconut_b_18.endRadius, endpoint_coconut_b_18.baseRadius, endpoint_coconut_b_18.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_coconut_b_18) {
    mesh_coconut_b_18Geometry.scale(0.3, 0.3, 0.3);
  }
  const mesh_coconut_b_18 = new THREE.Mesh(
    mesh_coconut_b_18Geometry,
    materialMap["nut"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coconut_b_18.name = "coconut b";
  if (endpoint_coconut_b_18) {
    mesh_coconut_b_18.position.copy(endpoint_coconut_b_18.midpoint);
    mesh_coconut_b_18.quaternion.copy(endpoint_coconut_b_18.quaternion);
  }
  mesh_coconut_b_18.castShadow = options.castShadow ?? true;
  mesh_coconut_b_18.receiveShadow = options.receiveShadow ?? true;
  mesh_coconut_b_18.userData.sculptComponent = {"id": "coconut-b", "name": "coconut b", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "sphere matches the coconut-b form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [-2.15, 4.85, -0.12], "localEnd": [-2.15, 4.85, -0.12], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "m", "confidence": 0.7}, "transform": {"position": [-2.15, 4.85, -0.12], "rotation": [0, 0, 0], "scale": [0.3, 0.3, 0.3]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "nut", "materialLayers": ["nut", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "coconut-b-form", "kind": "form", "description": "coconut-b shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 70, 40, 1.0)", "secondaryAlbedo": "rgba(90, 59, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_coconut_b_18.add(mesh_coconut_b_18);
  meshes["coconut-b"] = mesh_coconut_b_18;
  colliders["coconut-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_coconut_b_18);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createToyPalmTreeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Toy Palm Tree look-dev lights";
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
export function createToyPalmTreeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameToyPalmTreeCamera(
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
export function createToyPalmTreePresentationComposer(
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

export function configureToyPalmTreeRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createToyPalmTreeInspectControls(
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
