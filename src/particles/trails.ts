import type { ParticleLayouts } from "./pipelines";
import type {
  TrailFormatMode,
  TrailResolutionScale,
  TrailTargetInfo,
} from "./types";

export interface TrailResources extends TrailTargetInfo {
  textures: [GPUTexture, GPUTexture];
  views: [GPUTextureView, GPUTextureView];
  bindGroups: [GPUBindGroup, GPUBindGroup];
  sampler: GPUSampler;
}

export interface TrailResourceOptions {
  canvasWidth: number;
  canvasHeight: number;
  requestedMode: TrailFormatMode;
  mode: TrailFormatMode;
  format: GPUTextureFormat;
  scale: TrailResolutionScale;
}

export function createTrailResources(
  device: GPUDevice,
  layouts: ParticleLayouts,
  renderUniformBuffer: GPUBuffer,
  options: TrailResourceOptions,
): TrailResources {
  const textureWidth = Math.max(1, Math.floor(options.canvasWidth * options.scale));
  const textureHeight = Math.max(1, Math.floor(options.canvasHeight * options.scale));
  const estimatedBytes = textureWidth * textureHeight * bytesPerPixel(options.format) * 2;
  const sampler = device.createSampler({
    label: "trail sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear",
  });
  const textures: [GPUTexture, GPUTexture] = [
    createTrailTexture(device, textureWidth, textureHeight, options.format, "trail texture A"),
    createTrailTexture(device, textureWidth, textureHeight, options.format, "trail texture B"),
  ];
  const views: [GPUTextureView, GPUTextureView] = [
    textures[0].createView({ label: "trail texture view A" }),
    textures[1].createView({ label: "trail texture view B" }),
  ];

  return {
    requestedMode: options.requestedMode,
    mode: options.mode,
    format: options.format,
    scale: options.scale,
    width: textureWidth,
    height: textureHeight,
    estimatedBytes,
    textures,
    views,
    bindGroups: [
      createTrailBindGroup(device, layouts, views[0], sampler, renderUniformBuffer, "sample A"),
      createTrailBindGroup(device, layouts, views[1], sampler, renderUniformBuffer, "sample B"),
    ],
    sampler,
  };
}

export function destroyTrailResources(resources: TrailResources | null): void {
  if (!resources) {
    return;
  }

  resources.textures[0].destroy();
  resources.textures[1].destroy();
}

function createTrailTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}

function bytesPerPixel(format: GPUTextureFormat): number {
  switch (format) {
    case "rgba16float":
      return 8;
    case "rgba8unorm":
      return 4;
    default:
      throw new Error(`Unsupported trail format for memory accounting: ${format}`);
  }
}

function createTrailBindGroup(
  device: GPUDevice,
  layouts: ParticleLayouts,
  textureView: GPUTextureView,
  sampler: GPUSampler,
  renderUniformBuffer: GPUBuffer,
  label: string,
): GPUBindGroup {
  return device.createBindGroup({
    label: `trail bind group ${label}`,
    layout: layouts.trail,
    entries: [
      { binding: 0, resource: textureView },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: renderUniformBuffer } },
    ],
  });
}
