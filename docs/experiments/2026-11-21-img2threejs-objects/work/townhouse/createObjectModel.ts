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

// Generated from ObjectSculptSpec target: Toy Town House
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createToyTownHouseModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Toy Town House";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wall"] = createSculptMaterial(
    "wall",
    {"id": "wall", "name": "wall", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f1e2b4", "color": "#f1e2b4", "albedo": {"dominant": "#f1e2b4", "secondary": ["#ccc099", "#fff8c6"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#f1e2b4", "#ccc099", "#fff8c6"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "wall-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#fff4c2", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "wall-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#c0b490", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["roof"] = createSculptMaterial(
    "roof",
    {"id": "roof", "name": "roof", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#7f97d6", "color": "#7f97d6", "albedo": {"dominant": "#7f97d6", "secondary": ["#6b80b5", "#8ba6eb"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#7f97d6", "#6b80b5", "#8ba6eb"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "roof-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#89a3e7", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "roof-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#6578ab", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["frame"] = createSculptMaterial(
    "frame",
    {"id": "frame", "name": "frame", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a8c8ea", "color": "#a8c8ea", "albedo": {"dominant": "#a8c8ea", "secondary": ["#8eaac6", "#b8dcff"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#a8c8ea", "#8eaac6", "#b8dcff"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "frame-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#b5d8fc", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "frame-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#86a0bb", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#dfeaf6", "color": "#dfeaf6", "albedo": {"dominant": "#dfeaf6", "secondary": ["#bdc6d1", "#f5ffff"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#dfeaf6", "#bdc6d1", "#f5ffff"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.08, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#f0fcff", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "glass-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#b2bbc4", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["door"] = createSculptMaterial(
    "door",
    {"id": "door", "name": "door", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#7a4a2c", "color": "#7a4a2c", "albedo": {"dominant": "#7a4a2c", "secondary": ["#673e25", "#865130"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#7a4a2c", "#673e25", "#865130"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "door-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#834f2f", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "door-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#613b23", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["plinth"] = createSculptMaterial(
    "plinth",
    {"id": "plinth", "name": "plinth", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9aa3ad", "color": "#9aa3ad", "albedo": {"dominant": "#9aa3ad", "secondary": ["#828a93", "#a9b3be"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#9aa3ad", "#828a93", "#a9b3be"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.35, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "plinth-edge-wear", "kind": "edge-wear", "mask": "convex edges", "colorShift": "#a6b0ba", "roughnessDelta": 0.05, "evidenceRefs": ["full-object"]}, {"id": "plinth-ao", "kind": "ambient-occlusion", "mask": "crevices and contact areas", "colorShift": "#7b828a", "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}},
    options
  );
  materialMap["coat"] = createSculptMaterial(
    "coat",
    {"id": "coat", "name": "satin plastic coat", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#ffffff", "color": "#ffffff", "albedo": {"dominant": "#f1e2b4", "secondary": ["#ccc099", "#fff8c6"], "samplingNotes": "Toy figurine colours from the reference picture."}, "colorVariation": {"palette": ["#f1e2b4", "#ccc099", "#fff8c6"], "pattern": "smooth", "amplitude": 0.04, "heightCorrelation": 0.1}, "roughness": 0.2, "metalness": 0.0, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "coat-gloss", "kind": "gloss", "mask": "top faces", "roughnessDelta": -0.1, "evidenceRefs": ["full-object"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["reference picture refs/<name>.png: smooth glossy toy plastic, flat colour regions, no grain, print or pores (designer-toy look)"]}, "clearcoat": 0.6},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Toy Town House__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Town House", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wall", "materialLayers": ["wall", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 226, 180, 1.0)", "secondaryAlbedo": "rgba(204, 192, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
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
    materialMap["wall"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Toy Town House";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Toy Town House", "level": "macro", "role": "assembly root", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Assembly pivot only; the visible parts are its children.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 1.0}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wall", "materialLayers": ["wall", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 226, 180, 1.0)", "secondaryAlbedo": "rgba(204, 192, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_plinth_1 = makeAttachmentEndpoint(null);
  const node_plinth_1 = new THREE.Group();
  node_plinth_1.name = "plinth__pivot";
  node_plinth_1.scale.set(1, 1, 1);
  if (endpoint_plinth_1) {
    node_plinth_1.position.copy(endpoint_plinth_1.start);
    node_plinth_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plinth_1.position.set(0.0, 0.15, 0.0);
    node_plinth_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_plinth_1.userData.sculptComponent = {"id": "plinth", "name": "plinth", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the plinth form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.15, 0], "localEnd": [0, 0.15, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8000000000000003, "height": 0.3, "depth": 3.8000000000000003, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.15, 0], "rotation": [0, 0, 0], "scale": [2.8000000000000003, 0.3, 3.8000000000000003]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "plinth", "materialLayers": ["plinth", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plinth-form", "kind": "detail", "description": "grey plinth at the base", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 163, 173, 1.0)", "secondaryAlbedo": "rgba(130, 138, 147, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_plinth_1.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_plinth_1);
  nodes["plinth"] = node_plinth_1;
  const mesh_plinth_1Geometry = endpoint_plinth_1
    ? new THREE.CylinderGeometry(endpoint_plinth_1.endRadius, endpoint_plinth_1.baseRadius, endpoint_plinth_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_plinth_1) {
    mesh_plinth_1Geometry.scale(2.8000000000000003, 0.3, 3.8000000000000003);
  }
  const mesh_plinth_1 = new THREE.Mesh(
    mesh_plinth_1Geometry,
    materialMap["plinth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_1.name = "plinth";
  if (endpoint_plinth_1) {
    mesh_plinth_1.position.copy(endpoint_plinth_1.midpoint);
    mesh_plinth_1.quaternion.copy(endpoint_plinth_1.quaternion);
  }
  mesh_plinth_1.castShadow = options.castShadow ?? true;
  mesh_plinth_1.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_1.userData.sculptComponent = {"id": "plinth", "name": "plinth", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the plinth form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 0.15, 0], "localEnd": [0, 0.15, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.8000000000000003, "height": 0.3, "depth": 3.8000000000000003, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 0.15, 0], "rotation": [0, 0, 0], "scale": [2.8000000000000003, 0.3, 3.8000000000000003]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "plinth", "materialLayers": ["plinth", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plinth-form", "kind": "detail", "description": "grey plinth at the base", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 163, 173, 1.0)", "secondaryAlbedo": "rgba(130, 138, 147, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_plinth_1.add(mesh_plinth_1);
  meshes["plinth"] = mesh_plinth_1;
  colliders["plinth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_plinth_1);

  const endpoint_walls_2 = makeAttachmentEndpoint(null);
  const node_walls_2 = new THREE.Group();
  node_walls_2.name = "walls__pivot";
  node_walls_2.scale.set(1, 1, 1);
  if (endpoint_walls_2) {
    node_walls_2.position.copy(endpoint_walls_2.start);
    node_walls_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_walls_2.position.set(0.0, 3.4, 0.0);
    node_walls_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_walls_2.userData.sculptComponent = {"id": "walls", "name": "walls", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the walls form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 3.4, 0], "localEnd": [0, 3.4, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.6, "height": 6.2, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 3.4, 0], "rotation": [0, 0, 0], "scale": [2.6, 6.2, 3.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wall", "materialLayers": ["wall", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 226, 180, 1.0)", "secondaryAlbedo": "rgba(204, 192, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_walls_2.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_walls_2);
  nodes["walls"] = node_walls_2;
  const mesh_walls_2Geometry = endpoint_walls_2
    ? new THREE.CylinderGeometry(endpoint_walls_2.endRadius, endpoint_walls_2.baseRadius, endpoint_walls_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_walls_2) {
    mesh_walls_2Geometry.scale(2.6, 6.2, 3.6);
  }
  const mesh_walls_2 = new THREE.Mesh(
    mesh_walls_2Geometry,
    materialMap["wall"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_walls_2.name = "walls";
  if (endpoint_walls_2) {
    mesh_walls_2.position.copy(endpoint_walls_2.midpoint);
    mesh_walls_2.quaternion.copy(endpoint_walls_2.quaternion);
  }
  mesh_walls_2.castShadow = options.castShadow ?? true;
  mesh_walls_2.receiveShadow = options.receiveShadow ?? true;
  mesh_walls_2.userData.sculptComponent = {"id": "walls", "name": "walls", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the walls form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 3.4, 0], "localEnd": [0, 3.4, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.6, "height": 6.2, "depth": 3.6, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 3.4, 0], "rotation": [0, 0, 0], "scale": [2.6, 6.2, 3.6]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "wall", "materialLayers": ["wall", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 226, 180, 1.0)", "secondaryAlbedo": "rgba(204, 192, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_walls_2.add(mesh_walls_2);
  meshes["walls"] = mesh_walls_2;
  colliders["walls"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_walls_2);

  const attachment_roof_3 = {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 6.9, 0], "localEnd": [0, 6.9, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_roof_3 = makeAttachmentEndpoint(attachment_roof_3);
  const node_roof_3 = new THREE.Group();
  node_roof_3.name = "roof__pivot";
  node_roof_3.scale.set(1, 1, 1);
  if (endpoint_roof_3) {
    node_roof_3.position.copy(endpoint_roof_3.start);
    node_roof_3.rotation.set(0.0, 0.7854, 0.0);
  } else {
    node_roof_3.position.set(0.0, 6.9, 0.0);
    node_roof_3.rotation.set(0.0, 0.7854, 0.0);
  }
  node_roof_3.userData.sculptComponent = {"id": "roof", "name": "roof", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the roof form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "note": "4-sided cone = hipped roof"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 6.9, 0], "localEnd": [0, 6.9, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.16, "height": 0.8, "depth": 5.760000000000001, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 6.9, 0], "rotation": [0, 0.7854, 0], "scale": [4.16, 0.8, 5.760000000000001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "roof", "materialLayers": ["roof", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(127, 151, 214, 1.0)", "secondaryAlbedo": "rgba(107, 128, 181, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_roof_3.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_roof_3);
  nodes["roof"] = node_roof_3;
  const mesh_roof_3Geometry = endpoint_roof_3
    ? new THREE.CylinderGeometry(endpoint_roof_3.endRadius, endpoint_roof_3.baseRadius, endpoint_roof_3.length, 32, 12)
    : new THREE.ConeGeometry(0.5, 1, 48, 1);
  if (!endpoint_roof_3) {
    mesh_roof_3Geometry.scale(4.16, 0.8, 5.760000000000001);
  }
  const mesh_roof_3 = new THREE.Mesh(
    mesh_roof_3Geometry,
    materialMap["roof"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roof_3.name = "roof";
  if (endpoint_roof_3) {
    mesh_roof_3.position.copy(endpoint_roof_3.midpoint);
    mesh_roof_3.quaternion.copy(endpoint_roof_3.quaternion);
  }
  mesh_roof_3.castShadow = options.castShadow ?? true;
  mesh_roof_3.receiveShadow = options.receiveShadow ?? true;
  mesh_roof_3.userData.sculptComponent = {"id": "roof", "name": "roof", "level": "macro", "role": "macro part", "importance": 1.0, "confidence": 0.5, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "cone matches the roof form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "note": "4-sided cone = hipped roof"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 6.9, 0], "localEnd": [0, 6.9, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.16, "height": 0.8, "depth": 5.760000000000001, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 6.9, 0], "rotation": [0, 0.7854, 0], "scale": [4.16, 0.8, 5.760000000000001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "roof", "materialLayers": ["roof", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(127, 151, 214, 1.0)", "secondaryAlbedo": "rgba(107, 128, 181, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_roof_3.add(mesh_roof_3);
  meshes["roof"] = mesh_roof_3;
  colliders["roof"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_roof_3);

  const endpoint_eave_4 = makeAttachmentEndpoint(null);
  const node_eave_4 = new THREE.Group();
  node_eave_4.name = "eave__pivot";
  node_eave_4.scale.set(1, 1, 1);
  if (endpoint_eave_4) {
    node_eave_4.position.copy(endpoint_eave_4.start);
    node_eave_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eave_4.position.set(0.0, 6.55, 0.0);
    node_eave_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_eave_4.userData.sculptComponent = {"id": "eave", "name": "eave", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the eave form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 6.55, 0], "localEnd": [0, 6.55, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.9, "height": 0.16, "depth": 3.9, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 6.55, 0], "rotation": [0, 0, 0], "scale": [2.9, 0.16, 3.9]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "roof", "materialLayers": ["roof", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eave-form", "kind": "detail", "description": "roof eave", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(127, 151, 214, 1.0)", "secondaryAlbedo": "rgba(107, 128, 181, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_eave_4.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_eave_4);
  nodes["eave"] = node_eave_4;
  const mesh_eave_4Geometry = endpoint_eave_4
    ? new THREE.CylinderGeometry(endpoint_eave_4.endRadius, endpoint_eave_4.baseRadius, endpoint_eave_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_eave_4) {
    mesh_eave_4Geometry.scale(2.9, 0.16, 3.9);
  }
  const mesh_eave_4 = new THREE.Mesh(
    mesh_eave_4Geometry,
    materialMap["roof"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eave_4.name = "eave";
  if (endpoint_eave_4) {
    mesh_eave_4.position.copy(endpoint_eave_4.midpoint);
    mesh_eave_4.quaternion.copy(endpoint_eave_4.quaternion);
  }
  mesh_eave_4.castShadow = options.castShadow ?? true;
  mesh_eave_4.receiveShadow = options.receiveShadow ?? true;
  mesh_eave_4.userData.sculptComponent = {"id": "eave", "name": "eave", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the eave form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0, 6.55, 0], "localEnd": [0, 6.55, 0], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.9, "height": 0.16, "depth": 3.9, "units": "m", "confidence": 0.7}, "transform": {"position": [0, 6.55, 0], "rotation": [0, 0, 0], "scale": [2.9, 0.16, 3.9]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "roof", "materialLayers": ["roof", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eave-form", "kind": "detail", "description": "roof eave", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(127, 151, 214, 1.0)", "secondaryAlbedo": "rgba(107, 128, 181, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_eave_4.add(mesh_eave_4);
  meshes["eave"] = mesh_eave_4;
  colliders["eave"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_eave_4);

  const endpoint_door_5 = makeAttachmentEndpoint(null);
  const node_door_5 = new THREE.Group();
  node_door_5.name = "door__pivot";
  node_door_5.scale.set(1, 1, 1);
  if (endpoint_door_5) {
    node_door_5.position.copy(endpoint_door_5.start);
    node_door_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_5.position.set(1.33, 1.05, 1.1);
    node_door_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_5.userData.sculptComponent = {"id": "door", "name": "door", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the door form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.05, 1.1], "localEnd": [1.33, 1.05, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 1.5, "depth": 0.8, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.05, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 1.5, 0.8]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "door", "materialLayers": ["door", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 74, 44, 1.0)", "secondaryAlbedo": "rgba(103, 62, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_door_5.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_door_5);
  nodes["door"] = node_door_5;
  const mesh_door_5Geometry = endpoint_door_5
    ? new THREE.CylinderGeometry(endpoint_door_5.endRadius, endpoint_door_5.baseRadius, endpoint_door_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_door_5) {
    mesh_door_5Geometry.scale(0.08, 1.5, 0.8);
  }
  const mesh_door_5 = new THREE.Mesh(
    mesh_door_5Geometry,
    materialMap["door"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_5.name = "door";
  if (endpoint_door_5) {
    mesh_door_5.position.copy(endpoint_door_5.midpoint);
    mesh_door_5.quaternion.copy(endpoint_door_5.quaternion);
  }
  mesh_door_5.castShadow = options.castShadow ?? true;
  mesh_door_5.receiveShadow = options.receiveShadow ?? true;
  mesh_door_5.userData.sculptComponent = {"id": "door", "name": "door", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the door form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.05, 1.1], "localEnd": [1.33, 1.05, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 1.5, "depth": 0.8, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.05, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 1.5, 0.8]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "door", "materialLayers": ["door", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 74, 44, 1.0)", "secondaryAlbedo": "rgba(103, 62, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_door_5.add(mesh_door_5);
  meshes["door"] = mesh_door_5;
  colliders["door"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_door_5);

  const endpoint_door_canopy_6 = makeAttachmentEndpoint(null);
  const node_door_canopy_6 = new THREE.Group();
  node_door_canopy_6.name = "door canopy__pivot";
  node_door_canopy_6.scale.set(1, 1, 1);
  if (endpoint_door_canopy_6) {
    node_door_canopy_6.position.copy(endpoint_door_canopy_6.start);
    node_door_canopy_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_canopy_6.position.set(1.48, 1.9, 1.1);
    node_door_canopy_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_canopy_6.userData.sculptComponent = {"id": "door-canopy", "name": "door canopy", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the door-canopy form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.48, 1.9, 1.1], "localEnd": [1.48, 1.9, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.1, "depth": 1.1, "units": "m", "confidence": 0.7}, "transform": {"position": [1.48, 1.9, 1.1], "rotation": [0, 0, 0], "scale": [0.4, 0.1, 1.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "door-canopy-form", "kind": "detail", "description": "small canopy over the door", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_door_canopy_6.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_door_canopy_6);
  nodes["door-canopy"] = node_door_canopy_6;
  const mesh_door_canopy_6Geometry = endpoint_door_canopy_6
    ? new THREE.CylinderGeometry(endpoint_door_canopy_6.endRadius, endpoint_door_canopy_6.baseRadius, endpoint_door_canopy_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_door_canopy_6) {
    mesh_door_canopy_6Geometry.scale(0.4, 0.1, 1.1);
  }
  const mesh_door_canopy_6 = new THREE.Mesh(
    mesh_door_canopy_6Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_canopy_6.name = "door canopy";
  if (endpoint_door_canopy_6) {
    mesh_door_canopy_6.position.copy(endpoint_door_canopy_6.midpoint);
    mesh_door_canopy_6.quaternion.copy(endpoint_door_canopy_6.quaternion);
  }
  mesh_door_canopy_6.castShadow = options.castShadow ?? true;
  mesh_door_canopy_6.receiveShadow = options.receiveShadow ?? true;
  mesh_door_canopy_6.userData.sculptComponent = {"id": "door-canopy", "name": "door canopy", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the door-canopy form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.48, 1.9, 1.1], "localEnd": [1.48, 1.9, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.1, "depth": 1.1, "units": "m", "confidence": 0.7}, "transform": {"position": [1.48, 1.9, 1.1], "rotation": [0, 0, 0], "scale": [0.4, 0.1, 1.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "door-canopy-form", "kind": "detail", "description": "small canopy over the door", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_door_canopy_6.add(mesh_door_canopy_6);
  meshes["door-canopy"] = mesh_door_canopy_6;
  colliders["door-canopy"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_door_canopy_6);

  const endpoint_win_front_0_7 = makeAttachmentEndpoint(null);
  const node_win_front_0_7 = new THREE.Group();
  node_win_front_0_7.name = "win front 0__pivot";
  node_win_front_0_7.scale.set(1, 1, 1);
  if (endpoint_win_front_0_7) {
    node_win_front_0_7.position.copy(endpoint_win_front_0_7.start);
    node_win_front_0_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_0_7.position.set(1.33, 1.4, 0.05);
    node_win_front_0_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_0_7.userData.sculptComponent = {"id": "win-front-0", "name": "win front 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, 0.05], "localEnd": [1.33, 1.4, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-0-form", "kind": "form", "description": "win-front-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_0_7.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_0_7);
  nodes["win-front-0"] = node_win_front_0_7;
  const mesh_win_front_0_7Geometry = endpoint_win_front_0_7
    ? new THREE.CylinderGeometry(endpoint_win_front_0_7.endRadius, endpoint_win_front_0_7.baseRadius, endpoint_win_front_0_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_0_7) {
    mesh_win_front_0_7Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_0_7 = new THREE.Mesh(
    mesh_win_front_0_7Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_0_7.name = "win front 0";
  if (endpoint_win_front_0_7) {
    mesh_win_front_0_7.position.copy(endpoint_win_front_0_7.midpoint);
    mesh_win_front_0_7.quaternion.copy(endpoint_win_front_0_7.quaternion);
  }
  mesh_win_front_0_7.castShadow = options.castShadow ?? true;
  mesh_win_front_0_7.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_0_7.userData.sculptComponent = {"id": "win-front-0", "name": "win front 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, 0.05], "localEnd": [1.33, 1.4, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-0-form", "kind": "form", "description": "win-front-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_0_7.add(mesh_win_front_0_7);
  meshes["win-front-0"] = mesh_win_front_0_7;
  colliders["win-front-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_0_7);

  const endpoint_glass_front_0_8 = makeAttachmentEndpoint(null);
  const node_glass_front_0_8 = new THREE.Group();
  node_glass_front_0_8.name = "glass front 0__pivot";
  node_glass_front_0_8.scale.set(1, 1, 1);
  if (endpoint_glass_front_0_8) {
    node_glass_front_0_8.position.copy(endpoint_glass_front_0_8.start);
    node_glass_front_0_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_0_8.position.set(1.33, 1.4, 0.05);
    node_glass_front_0_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_0_8.userData.sculptComponent = {"id": "glass-front-0", "name": "glass front 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, 0.05], "localEnd": [1.33, 1.4, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-0-form", "kind": "form", "description": "glass-front-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_0_8.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_0_8);
  nodes["glass-front-0"] = node_glass_front_0_8;
  const mesh_glass_front_0_8Geometry = endpoint_glass_front_0_8
    ? new THREE.CylinderGeometry(endpoint_glass_front_0_8.endRadius, endpoint_glass_front_0_8.baseRadius, endpoint_glass_front_0_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_0_8) {
    mesh_glass_front_0_8Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_0_8 = new THREE.Mesh(
    mesh_glass_front_0_8Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_0_8.name = "glass front 0";
  if (endpoint_glass_front_0_8) {
    mesh_glass_front_0_8.position.copy(endpoint_glass_front_0_8.midpoint);
    mesh_glass_front_0_8.quaternion.copy(endpoint_glass_front_0_8.quaternion);
  }
  mesh_glass_front_0_8.castShadow = options.castShadow ?? true;
  mesh_glass_front_0_8.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_0_8.userData.sculptComponent = {"id": "glass-front-0", "name": "glass front 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, 0.05], "localEnd": [1.33, 1.4, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-0-form", "kind": "form", "description": "glass-front-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_0_8.add(mesh_glass_front_0_8);
  meshes["glass-front-0"] = mesh_glass_front_0_8;
  colliders["glass-front-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_0_8);

  const endpoint_win_front_1_9 = makeAttachmentEndpoint(null);
  const node_win_front_1_9 = new THREE.Group();
  node_win_front_1_9.name = "win front 1__pivot";
  node_win_front_1_9.scale.set(1, 1, 1);
  if (endpoint_win_front_1_9) {
    node_win_front_1_9.position.copy(endpoint_win_front_1_9.start);
    node_win_front_1_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_1_9.position.set(1.33, 1.4, -1.05);
    node_win_front_1_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_1_9.userData.sculptComponent = {"id": "win-front-1", "name": "win front 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, -1.05], "localEnd": [1.33, 1.4, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-1-form", "kind": "form", "description": "win-front-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_1_9.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_1_9);
  nodes["win-front-1"] = node_win_front_1_9;
  const mesh_win_front_1_9Geometry = endpoint_win_front_1_9
    ? new THREE.CylinderGeometry(endpoint_win_front_1_9.endRadius, endpoint_win_front_1_9.baseRadius, endpoint_win_front_1_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_1_9) {
    mesh_win_front_1_9Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_1_9 = new THREE.Mesh(
    mesh_win_front_1_9Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_1_9.name = "win front 1";
  if (endpoint_win_front_1_9) {
    mesh_win_front_1_9.position.copy(endpoint_win_front_1_9.midpoint);
    mesh_win_front_1_9.quaternion.copy(endpoint_win_front_1_9.quaternion);
  }
  mesh_win_front_1_9.castShadow = options.castShadow ?? true;
  mesh_win_front_1_9.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_1_9.userData.sculptComponent = {"id": "win-front-1", "name": "win front 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, -1.05], "localEnd": [1.33, 1.4, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-1-form", "kind": "form", "description": "win-front-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_1_9.add(mesh_win_front_1_9);
  meshes["win-front-1"] = mesh_win_front_1_9;
  colliders["win-front-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_1_9);

  const endpoint_glass_front_1_10 = makeAttachmentEndpoint(null);
  const node_glass_front_1_10 = new THREE.Group();
  node_glass_front_1_10.name = "glass front 1__pivot";
  node_glass_front_1_10.scale.set(1, 1, 1);
  if (endpoint_glass_front_1_10) {
    node_glass_front_1_10.position.copy(endpoint_glass_front_1_10.start);
    node_glass_front_1_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_1_10.position.set(1.33, 1.4, -1.05);
    node_glass_front_1_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_1_10.userData.sculptComponent = {"id": "glass-front-1", "name": "glass front 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, -1.05], "localEnd": [1.33, 1.4, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-1-form", "kind": "form", "description": "glass-front-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_1_10.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_1_10);
  nodes["glass-front-1"] = node_glass_front_1_10;
  const mesh_glass_front_1_10Geometry = endpoint_glass_front_1_10
    ? new THREE.CylinderGeometry(endpoint_glass_front_1_10.endRadius, endpoint_glass_front_1_10.baseRadius, endpoint_glass_front_1_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_1_10) {
    mesh_glass_front_1_10Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_1_10 = new THREE.Mesh(
    mesh_glass_front_1_10Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_1_10.name = "glass front 1";
  if (endpoint_glass_front_1_10) {
    mesh_glass_front_1_10.position.copy(endpoint_glass_front_1_10.midpoint);
    mesh_glass_front_1_10.quaternion.copy(endpoint_glass_front_1_10.quaternion);
  }
  mesh_glass_front_1_10.castShadow = options.castShadow ?? true;
  mesh_glass_front_1_10.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_1_10.userData.sculptComponent = {"id": "glass-front-1", "name": "glass front 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 1.4, -1.05], "localEnd": [1.33, 1.4, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 1.4, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-1-form", "kind": "form", "description": "glass-front-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_1_10.add(mesh_glass_front_1_10);
  meshes["glass-front-1"] = mesh_glass_front_1_10;
  colliders["glass-front-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_1_10);

  const endpoint_win_side_0_11 = makeAttachmentEndpoint(null);
  const node_win_side_0_11 = new THREE.Group();
  node_win_side_0_11.name = "win side 0__pivot";
  node_win_side_0_11.scale.set(1, 1, 1);
  if (endpoint_win_side_0_11) {
    node_win_side_0_11.position.copy(endpoint_win_side_0_11.start);
    node_win_side_0_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_side_0_11.position.set(0.3, 1.4, 1.83);
    node_win_side_0_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_side_0_11.userData.sculptComponent = {"id": "win-side-0", "name": "win side 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 1.4, 1.83], "localEnd": [0.3, 1.4, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 1.4, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_0_11.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_side_0_11);
  nodes["win-side-0"] = node_win_side_0_11;
  const mesh_win_side_0_11Geometry = endpoint_win_side_0_11
    ? new THREE.CylinderGeometry(endpoint_win_side_0_11.endRadius, endpoint_win_side_0_11.baseRadius, endpoint_win_side_0_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_side_0_11) {
    mesh_win_side_0_11Geometry.scale(0.6, 0.95, 0.08);
  }
  const mesh_win_side_0_11 = new THREE.Mesh(
    mesh_win_side_0_11Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_side_0_11.name = "win side 0";
  if (endpoint_win_side_0_11) {
    mesh_win_side_0_11.position.copy(endpoint_win_side_0_11.midpoint);
    mesh_win_side_0_11.quaternion.copy(endpoint_win_side_0_11.quaternion);
  }
  mesh_win_side_0_11.castShadow = options.castShadow ?? true;
  mesh_win_side_0_11.receiveShadow = options.receiveShadow ?? true;
  mesh_win_side_0_11.userData.sculptComponent = {"id": "win-side-0", "name": "win side 0", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 1.4, 1.83], "localEnd": [0.3, 1.4, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 1.4, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_0_11.add(mesh_win_side_0_11);
  meshes["win-side-0"] = mesh_win_side_0_11;
  colliders["win-side-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_side_0_11);

  const endpoint_glass_side_0_12 = makeAttachmentEndpoint(null);
  const node_glass_side_0_12 = new THREE.Group();
  node_glass_side_0_12.name = "glass side 0__pivot";
  node_glass_side_0_12.scale.set(1, 1, 1);
  if (endpoint_glass_side_0_12) {
    node_glass_side_0_12.position.copy(endpoint_glass_side_0_12.start);
    node_glass_side_0_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_side_0_12.position.set(0.3, 1.4, 1.83);
    node_glass_side_0_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_side_0_12.userData.sculptComponent = {"id": "glass-side-0", "name": "glass side 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 1.4, 1.83], "localEnd": [0.3, 1.4, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 1.4, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-0-form", "kind": "form", "description": "glass-side-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_0_12.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_side_0_12);
  nodes["glass-side-0"] = node_glass_side_0_12;
  const mesh_glass_side_0_12Geometry = endpoint_glass_side_0_12
    ? new THREE.CylinderGeometry(endpoint_glass_side_0_12.endRadius, endpoint_glass_side_0_12.baseRadius, endpoint_glass_side_0_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_side_0_12) {
    mesh_glass_side_0_12Geometry.scale(0.42, 0.75, 0.1);
  }
  const mesh_glass_side_0_12 = new THREE.Mesh(
    mesh_glass_side_0_12Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_side_0_12.name = "glass side 0";
  if (endpoint_glass_side_0_12) {
    mesh_glass_side_0_12.position.copy(endpoint_glass_side_0_12.midpoint);
    mesh_glass_side_0_12.quaternion.copy(endpoint_glass_side_0_12.quaternion);
  }
  mesh_glass_side_0_12.castShadow = options.castShadow ?? true;
  mesh_glass_side_0_12.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_side_0_12.userData.sculptComponent = {"id": "glass-side-0", "name": "glass side 0", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-0 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 1.4, 1.83], "localEnd": [0.3, 1.4, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 1.4, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-0-form", "kind": "form", "description": "glass-side-0 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_0_12.add(mesh_glass_side_0_12);
  meshes["glass-side-0"] = mesh_glass_side_0_12;
  colliders["glass-side-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_side_0_12);

  const endpoint_win_front_2_13 = makeAttachmentEndpoint(null);
  const node_win_front_2_13 = new THREE.Group();
  node_win_front_2_13.name = "win front 2__pivot";
  node_win_front_2_13.scale.set(1, 1, 1);
  if (endpoint_win_front_2_13) {
    node_win_front_2_13.position.copy(endpoint_win_front_2_13.start);
    node_win_front_2_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_2_13.position.set(1.33, 3.3, 1.1);
    node_win_front_2_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_2_13.userData.sculptComponent = {"id": "win-front-2", "name": "win front 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 1.1], "localEnd": [1.33, 3.3, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-2-form", "kind": "form", "description": "win-front-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_2_13.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_2_13);
  nodes["win-front-2"] = node_win_front_2_13;
  const mesh_win_front_2_13Geometry = endpoint_win_front_2_13
    ? new THREE.CylinderGeometry(endpoint_win_front_2_13.endRadius, endpoint_win_front_2_13.baseRadius, endpoint_win_front_2_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_2_13) {
    mesh_win_front_2_13Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_2_13 = new THREE.Mesh(
    mesh_win_front_2_13Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_2_13.name = "win front 2";
  if (endpoint_win_front_2_13) {
    mesh_win_front_2_13.position.copy(endpoint_win_front_2_13.midpoint);
    mesh_win_front_2_13.quaternion.copy(endpoint_win_front_2_13.quaternion);
  }
  mesh_win_front_2_13.castShadow = options.castShadow ?? true;
  mesh_win_front_2_13.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_2_13.userData.sculptComponent = {"id": "win-front-2", "name": "win front 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 1.1], "localEnd": [1.33, 3.3, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-2-form", "kind": "form", "description": "win-front-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_2_13.add(mesh_win_front_2_13);
  meshes["win-front-2"] = mesh_win_front_2_13;
  colliders["win-front-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_2_13);

  const endpoint_glass_front_2_14 = makeAttachmentEndpoint(null);
  const node_glass_front_2_14 = new THREE.Group();
  node_glass_front_2_14.name = "glass front 2__pivot";
  node_glass_front_2_14.scale.set(1, 1, 1);
  if (endpoint_glass_front_2_14) {
    node_glass_front_2_14.position.copy(endpoint_glass_front_2_14.start);
    node_glass_front_2_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_2_14.position.set(1.33, 3.3, 1.1);
    node_glass_front_2_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_2_14.userData.sculptComponent = {"id": "glass-front-2", "name": "glass front 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 1.1], "localEnd": [1.33, 3.3, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 1.1], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-2-form", "kind": "form", "description": "glass-front-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_2_14.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_2_14);
  nodes["glass-front-2"] = node_glass_front_2_14;
  const mesh_glass_front_2_14Geometry = endpoint_glass_front_2_14
    ? new THREE.CylinderGeometry(endpoint_glass_front_2_14.endRadius, endpoint_glass_front_2_14.baseRadius, endpoint_glass_front_2_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_2_14) {
    mesh_glass_front_2_14Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_2_14 = new THREE.Mesh(
    mesh_glass_front_2_14Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_2_14.name = "glass front 2";
  if (endpoint_glass_front_2_14) {
    mesh_glass_front_2_14.position.copy(endpoint_glass_front_2_14.midpoint);
    mesh_glass_front_2_14.quaternion.copy(endpoint_glass_front_2_14.quaternion);
  }
  mesh_glass_front_2_14.castShadow = options.castShadow ?? true;
  mesh_glass_front_2_14.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_2_14.userData.sculptComponent = {"id": "glass-front-2", "name": "glass front 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 1.1], "localEnd": [1.33, 3.3, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 1.1], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-2-form", "kind": "form", "description": "glass-front-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_2_14.add(mesh_glass_front_2_14);
  meshes["glass-front-2"] = mesh_glass_front_2_14;
  colliders["glass-front-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_2_14);

  const endpoint_win_front_3_15 = makeAttachmentEndpoint(null);
  const node_win_front_3_15 = new THREE.Group();
  node_win_front_3_15.name = "win front 3__pivot";
  node_win_front_3_15.scale.set(1, 1, 1);
  if (endpoint_win_front_3_15) {
    node_win_front_3_15.position.copy(endpoint_win_front_3_15.start);
    node_win_front_3_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_3_15.position.set(1.33, 3.3, 0.05);
    node_win_front_3_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_3_15.userData.sculptComponent = {"id": "win-front-3", "name": "win front 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 0.05], "localEnd": [1.33, 3.3, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-3-form", "kind": "form", "description": "win-front-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_3_15.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_3_15);
  nodes["win-front-3"] = node_win_front_3_15;
  const mesh_win_front_3_15Geometry = endpoint_win_front_3_15
    ? new THREE.CylinderGeometry(endpoint_win_front_3_15.endRadius, endpoint_win_front_3_15.baseRadius, endpoint_win_front_3_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_3_15) {
    mesh_win_front_3_15Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_3_15 = new THREE.Mesh(
    mesh_win_front_3_15Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_3_15.name = "win front 3";
  if (endpoint_win_front_3_15) {
    mesh_win_front_3_15.position.copy(endpoint_win_front_3_15.midpoint);
    mesh_win_front_3_15.quaternion.copy(endpoint_win_front_3_15.quaternion);
  }
  mesh_win_front_3_15.castShadow = options.castShadow ?? true;
  mesh_win_front_3_15.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_3_15.userData.sculptComponent = {"id": "win-front-3", "name": "win front 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 0.05], "localEnd": [1.33, 3.3, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-3-form", "kind": "form", "description": "win-front-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_3_15.add(mesh_win_front_3_15);
  meshes["win-front-3"] = mesh_win_front_3_15;
  colliders["win-front-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_3_15);

  const endpoint_glass_front_3_16 = makeAttachmentEndpoint(null);
  const node_glass_front_3_16 = new THREE.Group();
  node_glass_front_3_16.name = "glass front 3__pivot";
  node_glass_front_3_16.scale.set(1, 1, 1);
  if (endpoint_glass_front_3_16) {
    node_glass_front_3_16.position.copy(endpoint_glass_front_3_16.start);
    node_glass_front_3_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_3_16.position.set(1.33, 3.3, 0.05);
    node_glass_front_3_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_3_16.userData.sculptComponent = {"id": "glass-front-3", "name": "glass front 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 0.05], "localEnd": [1.33, 3.3, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-3-form", "kind": "form", "description": "glass-front-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_3_16.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_3_16);
  nodes["glass-front-3"] = node_glass_front_3_16;
  const mesh_glass_front_3_16Geometry = endpoint_glass_front_3_16
    ? new THREE.CylinderGeometry(endpoint_glass_front_3_16.endRadius, endpoint_glass_front_3_16.baseRadius, endpoint_glass_front_3_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_3_16) {
    mesh_glass_front_3_16Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_3_16 = new THREE.Mesh(
    mesh_glass_front_3_16Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_3_16.name = "glass front 3";
  if (endpoint_glass_front_3_16) {
    mesh_glass_front_3_16.position.copy(endpoint_glass_front_3_16.midpoint);
    mesh_glass_front_3_16.quaternion.copy(endpoint_glass_front_3_16.quaternion);
  }
  mesh_glass_front_3_16.castShadow = options.castShadow ?? true;
  mesh_glass_front_3_16.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_3_16.userData.sculptComponent = {"id": "glass-front-3", "name": "glass front 3", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-3 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, 0.05], "localEnd": [1.33, 3.3, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-3-form", "kind": "form", "description": "glass-front-3 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_3_16.add(mesh_glass_front_3_16);
  meshes["glass-front-3"] = mesh_glass_front_3_16;
  colliders["glass-front-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_3_16);

  const endpoint_win_front_4_17 = makeAttachmentEndpoint(null);
  const node_win_front_4_17 = new THREE.Group();
  node_win_front_4_17.name = "win front 4__pivot";
  node_win_front_4_17.scale.set(1, 1, 1);
  if (endpoint_win_front_4_17) {
    node_win_front_4_17.position.copy(endpoint_win_front_4_17.start);
    node_win_front_4_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_4_17.position.set(1.33, 3.3, -1.05);
    node_win_front_4_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_4_17.userData.sculptComponent = {"id": "win-front-4", "name": "win front 4", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, -1.05], "localEnd": [1.33, 3.3, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-4-form", "kind": "form", "description": "win-front-4 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_4_17.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_4_17);
  nodes["win-front-4"] = node_win_front_4_17;
  const mesh_win_front_4_17Geometry = endpoint_win_front_4_17
    ? new THREE.CylinderGeometry(endpoint_win_front_4_17.endRadius, endpoint_win_front_4_17.baseRadius, endpoint_win_front_4_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_4_17) {
    mesh_win_front_4_17Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_4_17 = new THREE.Mesh(
    mesh_win_front_4_17Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_4_17.name = "win front 4";
  if (endpoint_win_front_4_17) {
    mesh_win_front_4_17.position.copy(endpoint_win_front_4_17.midpoint);
    mesh_win_front_4_17.quaternion.copy(endpoint_win_front_4_17.quaternion);
  }
  mesh_win_front_4_17.castShadow = options.castShadow ?? true;
  mesh_win_front_4_17.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_4_17.userData.sculptComponent = {"id": "win-front-4", "name": "win front 4", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, -1.05], "localEnd": [1.33, 3.3, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-4-form", "kind": "form", "description": "win-front-4 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_4_17.add(mesh_win_front_4_17);
  meshes["win-front-4"] = mesh_win_front_4_17;
  colliders["win-front-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_4_17);

  const endpoint_glass_front_4_18 = makeAttachmentEndpoint(null);
  const node_glass_front_4_18 = new THREE.Group();
  node_glass_front_4_18.name = "glass front 4__pivot";
  node_glass_front_4_18.scale.set(1, 1, 1);
  if (endpoint_glass_front_4_18) {
    node_glass_front_4_18.position.copy(endpoint_glass_front_4_18.start);
    node_glass_front_4_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_4_18.position.set(1.33, 3.3, -1.05);
    node_glass_front_4_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_4_18.userData.sculptComponent = {"id": "glass-front-4", "name": "glass front 4", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, -1.05], "localEnd": [1.33, 3.3, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-4-form", "kind": "form", "description": "glass-front-4 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_4_18.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_4_18);
  nodes["glass-front-4"] = node_glass_front_4_18;
  const mesh_glass_front_4_18Geometry = endpoint_glass_front_4_18
    ? new THREE.CylinderGeometry(endpoint_glass_front_4_18.endRadius, endpoint_glass_front_4_18.baseRadius, endpoint_glass_front_4_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_4_18) {
    mesh_glass_front_4_18Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_4_18 = new THREE.Mesh(
    mesh_glass_front_4_18Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_4_18.name = "glass front 4";
  if (endpoint_glass_front_4_18) {
    mesh_glass_front_4_18.position.copy(endpoint_glass_front_4_18.midpoint);
    mesh_glass_front_4_18.quaternion.copy(endpoint_glass_front_4_18.quaternion);
  }
  mesh_glass_front_4_18.castShadow = options.castShadow ?? true;
  mesh_glass_front_4_18.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_4_18.userData.sculptComponent = {"id": "glass-front-4", "name": "glass front 4", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-4 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 3.3, -1.05], "localEnd": [1.33, 3.3, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 3.3, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-4-form", "kind": "form", "description": "glass-front-4 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_4_18.add(mesh_glass_front_4_18);
  meshes["glass-front-4"] = mesh_glass_front_4_18;
  colliders["glass-front-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_4_18);

  const endpoint_win_side_1_19 = makeAttachmentEndpoint(null);
  const node_win_side_1_19 = new THREE.Group();
  node_win_side_1_19.name = "win side 1__pivot";
  node_win_side_1_19.scale.set(1, 1, 1);
  if (endpoint_win_side_1_19) {
    node_win_side_1_19.position.copy(endpoint_win_side_1_19.start);
    node_win_side_1_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_side_1_19.position.set(0.3, 3.3, 1.83);
    node_win_side_1_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_side_1_19.userData.sculptComponent = {"id": "win-side-1", "name": "win side 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 3.3, 1.83], "localEnd": [0.3, 3.3, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 3.3, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-side-1-form", "kind": "detail", "description": "windows on the side", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_1_19.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_side_1_19);
  nodes["win-side-1"] = node_win_side_1_19;
  const mesh_win_side_1_19Geometry = endpoint_win_side_1_19
    ? new THREE.CylinderGeometry(endpoint_win_side_1_19.endRadius, endpoint_win_side_1_19.baseRadius, endpoint_win_side_1_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_side_1_19) {
    mesh_win_side_1_19Geometry.scale(0.6, 0.95, 0.08);
  }
  const mesh_win_side_1_19 = new THREE.Mesh(
    mesh_win_side_1_19Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_side_1_19.name = "win side 1";
  if (endpoint_win_side_1_19) {
    mesh_win_side_1_19.position.copy(endpoint_win_side_1_19.midpoint);
    mesh_win_side_1_19.quaternion.copy(endpoint_win_side_1_19.quaternion);
  }
  mesh_win_side_1_19.castShadow = options.castShadow ?? true;
  mesh_win_side_1_19.receiveShadow = options.receiveShadow ?? true;
  mesh_win_side_1_19.userData.sculptComponent = {"id": "win-side-1", "name": "win side 1", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 3.3, 1.83], "localEnd": [0.3, 3.3, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 3.3, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-side-1-form", "kind": "detail", "description": "windows on the side", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_1_19.add(mesh_win_side_1_19);
  meshes["win-side-1"] = mesh_win_side_1_19;
  colliders["win-side-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_side_1_19);

  const endpoint_glass_side_1_20 = makeAttachmentEndpoint(null);
  const node_glass_side_1_20 = new THREE.Group();
  node_glass_side_1_20.name = "glass side 1__pivot";
  node_glass_side_1_20.scale.set(1, 1, 1);
  if (endpoint_glass_side_1_20) {
    node_glass_side_1_20.position.copy(endpoint_glass_side_1_20.start);
    node_glass_side_1_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_side_1_20.position.set(0.3, 3.3, 1.83);
    node_glass_side_1_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_side_1_20.userData.sculptComponent = {"id": "glass-side-1", "name": "glass side 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 3.3, 1.83], "localEnd": [0.3, 3.3, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 3.3, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-1-form", "kind": "form", "description": "glass-side-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_1_20.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_side_1_20);
  nodes["glass-side-1"] = node_glass_side_1_20;
  const mesh_glass_side_1_20Geometry = endpoint_glass_side_1_20
    ? new THREE.CylinderGeometry(endpoint_glass_side_1_20.endRadius, endpoint_glass_side_1_20.baseRadius, endpoint_glass_side_1_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_side_1_20) {
    mesh_glass_side_1_20Geometry.scale(0.42, 0.75, 0.1);
  }
  const mesh_glass_side_1_20 = new THREE.Mesh(
    mesh_glass_side_1_20Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_side_1_20.name = "glass side 1";
  if (endpoint_glass_side_1_20) {
    mesh_glass_side_1_20.position.copy(endpoint_glass_side_1_20.midpoint);
    mesh_glass_side_1_20.quaternion.copy(endpoint_glass_side_1_20.quaternion);
  }
  mesh_glass_side_1_20.castShadow = options.castShadow ?? true;
  mesh_glass_side_1_20.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_side_1_20.userData.sculptComponent = {"id": "glass-side-1", "name": "glass side 1", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-1 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 3.3, 1.83], "localEnd": [0.3, 3.3, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 3.3, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-1-form", "kind": "form", "description": "glass-side-1 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_1_20.add(mesh_glass_side_1_20);
  meshes["glass-side-1"] = mesh_glass_side_1_20;
  colliders["glass-side-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_side_1_20);

  const endpoint_win_front_5_21 = makeAttachmentEndpoint(null);
  const node_win_front_5_21 = new THREE.Group();
  node_win_front_5_21.name = "win front 5__pivot";
  node_win_front_5_21.scale.set(1, 1, 1);
  if (endpoint_win_front_5_21) {
    node_win_front_5_21.position.copy(endpoint_win_front_5_21.start);
    node_win_front_5_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_5_21.position.set(1.33, 5.199999999999999, 1.1);
    node_win_front_5_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_5_21.userData.sculptComponent = {"id": "win-front-5", "name": "win front 5", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 1.1], "localEnd": [1.33, 5.199999999999999, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-5-form", "kind": "form", "description": "win-front-5 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_5_21.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_5_21);
  nodes["win-front-5"] = node_win_front_5_21;
  const mesh_win_front_5_21Geometry = endpoint_win_front_5_21
    ? new THREE.CylinderGeometry(endpoint_win_front_5_21.endRadius, endpoint_win_front_5_21.baseRadius, endpoint_win_front_5_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_5_21) {
    mesh_win_front_5_21Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_5_21 = new THREE.Mesh(
    mesh_win_front_5_21Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_5_21.name = "win front 5";
  if (endpoint_win_front_5_21) {
    mesh_win_front_5_21.position.copy(endpoint_win_front_5_21.midpoint);
    mesh_win_front_5_21.quaternion.copy(endpoint_win_front_5_21.quaternion);
  }
  mesh_win_front_5_21.castShadow = options.castShadow ?? true;
  mesh_win_front_5_21.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_5_21.userData.sculptComponent = {"id": "win-front-5", "name": "win front 5", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 1.1], "localEnd": [1.33, 5.199999999999999, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 1.1], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-5-form", "kind": "form", "description": "win-front-5 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_5_21.add(mesh_win_front_5_21);
  meshes["win-front-5"] = mesh_win_front_5_21;
  colliders["win-front-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_5_21);

  const endpoint_glass_front_5_22 = makeAttachmentEndpoint(null);
  const node_glass_front_5_22 = new THREE.Group();
  node_glass_front_5_22.name = "glass front 5__pivot";
  node_glass_front_5_22.scale.set(1, 1, 1);
  if (endpoint_glass_front_5_22) {
    node_glass_front_5_22.position.copy(endpoint_glass_front_5_22.start);
    node_glass_front_5_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_5_22.position.set(1.33, 5.199999999999999, 1.1);
    node_glass_front_5_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_5_22.userData.sculptComponent = {"id": "glass-front-5", "name": "glass front 5", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 1.1], "localEnd": [1.33, 5.199999999999999, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 1.1], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-5-form", "kind": "form", "description": "glass-front-5 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_5_22.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_5_22);
  nodes["glass-front-5"] = node_glass_front_5_22;
  const mesh_glass_front_5_22Geometry = endpoint_glass_front_5_22
    ? new THREE.CylinderGeometry(endpoint_glass_front_5_22.endRadius, endpoint_glass_front_5_22.baseRadius, endpoint_glass_front_5_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_5_22) {
    mesh_glass_front_5_22Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_5_22 = new THREE.Mesh(
    mesh_glass_front_5_22Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_5_22.name = "glass front 5";
  if (endpoint_glass_front_5_22) {
    mesh_glass_front_5_22.position.copy(endpoint_glass_front_5_22.midpoint);
    mesh_glass_front_5_22.quaternion.copy(endpoint_glass_front_5_22.quaternion);
  }
  mesh_glass_front_5_22.castShadow = options.castShadow ?? true;
  mesh_glass_front_5_22.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_5_22.userData.sculptComponent = {"id": "glass-front-5", "name": "glass front 5", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-5 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 1.1], "localEnd": [1.33, 5.199999999999999, 1.1], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 1.1], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-5-form", "kind": "form", "description": "glass-front-5 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_5_22.add(mesh_glass_front_5_22);
  meshes["glass-front-5"] = mesh_glass_front_5_22;
  colliders["glass-front-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_5_22);

  const endpoint_win_front_6_23 = makeAttachmentEndpoint(null);
  const node_win_front_6_23 = new THREE.Group();
  node_win_front_6_23.name = "win front 6__pivot";
  node_win_front_6_23.scale.set(1, 1, 1);
  if (endpoint_win_front_6_23) {
    node_win_front_6_23.position.copy(endpoint_win_front_6_23.start);
    node_win_front_6_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_6_23.position.set(1.33, 5.199999999999999, 0.05);
    node_win_front_6_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_6_23.userData.sculptComponent = {"id": "win-front-6", "name": "win front 6", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 0.05], "localEnd": [1.33, 5.199999999999999, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-6-form", "kind": "form", "description": "win-front-6 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_6_23.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_6_23);
  nodes["win-front-6"] = node_win_front_6_23;
  const mesh_win_front_6_23Geometry = endpoint_win_front_6_23
    ? new THREE.CylinderGeometry(endpoint_win_front_6_23.endRadius, endpoint_win_front_6_23.baseRadius, endpoint_win_front_6_23.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_6_23) {
    mesh_win_front_6_23Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_6_23 = new THREE.Mesh(
    mesh_win_front_6_23Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_6_23.name = "win front 6";
  if (endpoint_win_front_6_23) {
    mesh_win_front_6_23.position.copy(endpoint_win_front_6_23.midpoint);
    mesh_win_front_6_23.quaternion.copy(endpoint_win_front_6_23.quaternion);
  }
  mesh_win_front_6_23.castShadow = options.castShadow ?? true;
  mesh_win_front_6_23.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_6_23.userData.sculptComponent = {"id": "win-front-6", "name": "win front 6", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 0.05], "localEnd": [1.33, 5.199999999999999, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 0.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-6-form", "kind": "form", "description": "win-front-6 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_6_23.add(mesh_win_front_6_23);
  meshes["win-front-6"] = mesh_win_front_6_23;
  colliders["win-front-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_6_23);

  const endpoint_glass_front_6_24 = makeAttachmentEndpoint(null);
  const node_glass_front_6_24 = new THREE.Group();
  node_glass_front_6_24.name = "glass front 6__pivot";
  node_glass_front_6_24.scale.set(1, 1, 1);
  if (endpoint_glass_front_6_24) {
    node_glass_front_6_24.position.copy(endpoint_glass_front_6_24.start);
    node_glass_front_6_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_6_24.position.set(1.33, 5.199999999999999, 0.05);
    node_glass_front_6_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_6_24.userData.sculptComponent = {"id": "glass-front-6", "name": "glass front 6", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 0.05], "localEnd": [1.33, 5.199999999999999, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-6-form", "kind": "form", "description": "glass-front-6 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_6_24.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_6_24);
  nodes["glass-front-6"] = node_glass_front_6_24;
  const mesh_glass_front_6_24Geometry = endpoint_glass_front_6_24
    ? new THREE.CylinderGeometry(endpoint_glass_front_6_24.endRadius, endpoint_glass_front_6_24.baseRadius, endpoint_glass_front_6_24.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_6_24) {
    mesh_glass_front_6_24Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_6_24 = new THREE.Mesh(
    mesh_glass_front_6_24Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_6_24.name = "glass front 6";
  if (endpoint_glass_front_6_24) {
    mesh_glass_front_6_24.position.copy(endpoint_glass_front_6_24.midpoint);
    mesh_glass_front_6_24.quaternion.copy(endpoint_glass_front_6_24.quaternion);
  }
  mesh_glass_front_6_24.castShadow = options.castShadow ?? true;
  mesh_glass_front_6_24.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_6_24.userData.sculptComponent = {"id": "glass-front-6", "name": "glass front 6", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-6 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, 0.05], "localEnd": [1.33, 5.199999999999999, 0.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, 0.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-6-form", "kind": "form", "description": "glass-front-6 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_6_24.add(mesh_glass_front_6_24);
  meshes["glass-front-6"] = mesh_glass_front_6_24;
  colliders["glass-front-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_6_24);

  const endpoint_win_front_7_25 = makeAttachmentEndpoint(null);
  const node_win_front_7_25 = new THREE.Group();
  node_win_front_7_25.name = "win front 7__pivot";
  node_win_front_7_25.scale.set(1, 1, 1);
  if (endpoint_win_front_7_25) {
    node_win_front_7_25.position.copy(endpoint_win_front_7_25.start);
    node_win_front_7_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_front_7_25.position.set(1.33, 5.199999999999999, -1.05);
    node_win_front_7_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_front_7_25.userData.sculptComponent = {"id": "win-front-7", "name": "win front 7", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, -1.05], "localEnd": [1.33, 5.199999999999999, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-7-form", "kind": "form", "description": "win-front-7 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_7_25.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_front_7_25);
  nodes["win-front-7"] = node_win_front_7_25;
  const mesh_win_front_7_25Geometry = endpoint_win_front_7_25
    ? new THREE.CylinderGeometry(endpoint_win_front_7_25.endRadius, endpoint_win_front_7_25.baseRadius, endpoint_win_front_7_25.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_front_7_25) {
    mesh_win_front_7_25Geometry.scale(0.08, 0.95, 0.7);
  }
  const mesh_win_front_7_25 = new THREE.Mesh(
    mesh_win_front_7_25Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_front_7_25.name = "win front 7";
  if (endpoint_win_front_7_25) {
    mesh_win_front_7_25.position.copy(endpoint_win_front_7_25.midpoint);
    mesh_win_front_7_25.quaternion.copy(endpoint_win_front_7_25.quaternion);
  }
  mesh_win_front_7_25.castShadow = options.castShadow ?? true;
  mesh_win_front_7_25.receiveShadow = options.receiveShadow ?? true;
  mesh_win_front_7_25.userData.sculptComponent = {"id": "win-front-7", "name": "win front 7", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-front-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, -1.05], "localEnd": [1.33, 5.199999999999999, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.95, "depth": 0.7, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, -1.05], "rotation": [0, 0, 0], "scale": [0.08, 0.95, 0.7]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "win-front-7-form", "kind": "form", "description": "win-front-7 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_front_7_25.add(mesh_win_front_7_25);
  meshes["win-front-7"] = mesh_win_front_7_25;
  colliders["win-front-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_front_7_25);

  const endpoint_glass_front_7_26 = makeAttachmentEndpoint(null);
  const node_glass_front_7_26 = new THREE.Group();
  node_glass_front_7_26.name = "glass front 7__pivot";
  node_glass_front_7_26.scale.set(1, 1, 1);
  if (endpoint_glass_front_7_26) {
    node_glass_front_7_26.position.copy(endpoint_glass_front_7_26.start);
    node_glass_front_7_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_front_7_26.position.set(1.33, 5.199999999999999, -1.05);
    node_glass_front_7_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_front_7_26.userData.sculptComponent = {"id": "glass-front-7", "name": "glass front 7", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, -1.05], "localEnd": [1.33, 5.199999999999999, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-7-form", "kind": "form", "description": "glass-front-7 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_7_26.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_front_7_26);
  nodes["glass-front-7"] = node_glass_front_7_26;
  const mesh_glass_front_7_26Geometry = endpoint_glass_front_7_26
    ? new THREE.CylinderGeometry(endpoint_glass_front_7_26.endRadius, endpoint_glass_front_7_26.baseRadius, endpoint_glass_front_7_26.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_front_7_26) {
    mesh_glass_front_7_26Geometry.scale(0.1, 0.75, 0.5);
  }
  const mesh_glass_front_7_26 = new THREE.Mesh(
    mesh_glass_front_7_26Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_front_7_26.name = "glass front 7";
  if (endpoint_glass_front_7_26) {
    mesh_glass_front_7_26.position.copy(endpoint_glass_front_7_26.midpoint);
    mesh_glass_front_7_26.quaternion.copy(endpoint_glass_front_7_26.quaternion);
  }
  mesh_glass_front_7_26.castShadow = options.castShadow ?? true;
  mesh_glass_front_7_26.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_front_7_26.userData.sculptComponent = {"id": "glass-front-7", "name": "glass front 7", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-front-7 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [1.33, 5.199999999999999, -1.05], "localEnd": [1.33, 5.199999999999999, -1.05], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.1, "height": 0.75, "depth": 0.5, "units": "m", "confidence": 0.7}, "transform": {"position": [1.33, 5.199999999999999, -1.05], "rotation": [0, 0, 0], "scale": [0.1, 0.75, 0.5]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-front-7-form", "kind": "form", "description": "glass-front-7 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_front_7_26.add(mesh_glass_front_7_26);
  meshes["glass-front-7"] = mesh_glass_front_7_26;
  colliders["glass-front-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_front_7_26);

  const endpoint_win_side_2_27 = makeAttachmentEndpoint(null);
  const node_win_side_2_27 = new THREE.Group();
  node_win_side_2_27.name = "win side 2__pivot";
  node_win_side_2_27.scale.set(1, 1, 1);
  if (endpoint_win_side_2_27) {
    node_win_side_2_27.position.copy(endpoint_win_side_2_27.start);
    node_win_side_2_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_win_side_2_27.position.set(0.3, 5.199999999999999, 1.83);
    node_win_side_2_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_win_side_2_27.userData.sculptComponent = {"id": "win-side-2", "name": "win side 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 5.199999999999999, 1.83], "localEnd": [0.3, 5.199999999999999, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 5.199999999999999, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_2_27.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_win_side_2_27);
  nodes["win-side-2"] = node_win_side_2_27;
  const mesh_win_side_2_27Geometry = endpoint_win_side_2_27
    ? new THREE.CylinderGeometry(endpoint_win_side_2_27.endRadius, endpoint_win_side_2_27.baseRadius, endpoint_win_side_2_27.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_win_side_2_27) {
    mesh_win_side_2_27Geometry.scale(0.6, 0.95, 0.08);
  }
  const mesh_win_side_2_27 = new THREE.Mesh(
    mesh_win_side_2_27Geometry,
    materialMap["frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_win_side_2_27.name = "win side 2";
  if (endpoint_win_side_2_27) {
    mesh_win_side_2_27.position.copy(endpoint_win_side_2_27.midpoint);
    mesh_win_side_2_27.quaternion.copy(endpoint_win_side_2_27.quaternion);
  }
  mesh_win_side_2_27.castShadow = options.castShadow ?? true;
  mesh_win_side_2_27.receiveShadow = options.receiveShadow ?? true;
  mesh_win_side_2_27.userData.sculptComponent = {"id": "win-side-2", "name": "win side 2", "level": "meso", "role": "meso part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the win-side-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 5.199999999999999, 1.83], "localEnd": [0.3, 5.199999999999999, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.95, "depth": 0.08, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 5.199999999999999, 1.83], "rotation": [0, 0, 0], "scale": [0.6, 0.95, 0.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "frame", "materialLayers": ["frame", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 200, 234, 1.0)", "secondaryAlbedo": "rgba(142, 170, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_win_side_2_27.add(mesh_win_side_2_27);
  meshes["win-side-2"] = mesh_win_side_2_27;
  colliders["win-side-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_win_side_2_27);

  const endpoint_glass_side_2_28 = makeAttachmentEndpoint(null);
  const node_glass_side_2_28 = new THREE.Group();
  node_glass_side_2_28.name = "glass side 2__pivot";
  node_glass_side_2_28.scale.set(1, 1, 1);
  if (endpoint_glass_side_2_28) {
    node_glass_side_2_28.position.copy(endpoint_glass_side_2_28.start);
    node_glass_side_2_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_side_2_28.position.set(0.3, 5.199999999999999, 1.83);
    node_glass_side_2_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_side_2_28.userData.sculptComponent = {"id": "glass-side-2", "name": "glass side 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 5.199999999999999, 1.83], "localEnd": [0.3, 5.199999999999999, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 5.199999999999999, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-2-form", "kind": "form", "description": "glass-side-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_2_28.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_glass_side_2_28);
  nodes["glass-side-2"] = node_glass_side_2_28;
  const mesh_glass_side_2_28Geometry = endpoint_glass_side_2_28
    ? new THREE.CylinderGeometry(endpoint_glass_side_2_28.endRadius, endpoint_glass_side_2_28.baseRadius, endpoint_glass_side_2_28.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_glass_side_2_28) {
    mesh_glass_side_2_28Geometry.scale(0.42, 0.75, 0.1);
  }
  const mesh_glass_side_2_28 = new THREE.Mesh(
    mesh_glass_side_2_28Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_side_2_28.name = "glass side 2";
  if (endpoint_glass_side_2_28) {
    mesh_glass_side_2_28.position.copy(endpoint_glass_side_2_28.midpoint);
    mesh_glass_side_2_28.quaternion.copy(endpoint_glass_side_2_28.quaternion);
  }
  mesh_glass_side_2_28.castShadow = options.castShadow ?? true;
  mesh_glass_side_2_28.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_side_2_28.userData.sculptComponent = {"id": "glass-side-2", "name": "glass side 2", "level": "micro", "role": "micro part", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "box matches the glass-side-2 form seen in the reference.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-origin", "localStart": [0.3, 5.199999999999999, 1.83], "localEnd": [0.3, 5.199999999999999, 1.83], "contactType": "embedded", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 0.75, "depth": 0.1, "units": "m", "confidence": 0.7}, "transform": {"position": [0.3, 5.199999999999999, 1.83], "rotation": [0, 0, 0], "scale": [0.42, 0.75, 0.1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass", "coat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-side-2-form", "kind": "form", "description": "glass-side-2 shape as in the reference", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.02, "microRoughness": 0.04, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded toy plastic, no grain", "displacementPattern": "", "occlusionPattern": "contact ambient occlusion where the part meets its neighbour and the ground", "edgeWearPattern": "none (new toy)", "notes": "glossy plastic highlight from the satin coat"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(223, 234, 246, 1.0)", "secondaryAlbedo": "rgba(189, 198, 209, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8}};
  node_glass_side_2_28.add(mesh_glass_side_2_28);
  meshes["glass-side-2"] = mesh_glass_side_2_28;
  colliders["glass-side-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_glass_side_2_28);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createToyTownHouseLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Toy Town House look-dev lights";
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
export function createToyTownHouseEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameToyTownHouseCamera(
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
export function createToyTownHousePresentationComposer(
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

export function configureToyTownHouseRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createToyTownHouseInspectControls(
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
