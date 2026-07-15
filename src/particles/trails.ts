import type { ParticleLayouts } from "./pipelines";
import { TRAIL_FORMAT } from "./types";

export interface TrailResources {
  width: number;
  height: number;
  textures: [GPUTexture, GPUTexture];
  views: [GPUTextureView, GPUTextureView];
  bindGroups: [GPUBindGroup, GPUBindGroup];
  sampler: GPUSampler;
}

export function createTrailResources(
  device: GPUDevice,
  layouts: ParticleLayouts,
  renderUniformBuffer: GPUBuffer,
  width: number,
  height: number,
): TrailResources {
  const textureWidth = Math.max(1, width);
  const textureHeight = Math.max(1, height);
  const sampler = device.createSampler({
    label: "trail sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear",
  });
  const textures: [GPUTexture, GPUTexture] = [
    createTrailTexture(device, textureWidth, textureHeight, "trail texture A"),
    createTrailTexture(device, textureWidth, textureHeight, "trail texture B"),
  ];
  const views: [GPUTextureView, GPUTextureView] = [
    textures[0].createView({ label: "trail texture view A" }),
    textures[1].createView({ label: "trail texture view B" }),
  ];

  return {
    width: textureWidth,
    height: textureHeight,
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
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format: TRAIL_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
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
