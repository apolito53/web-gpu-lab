import type { Diagnostics } from "../diagnostics";
import type { ParticleLayouts, TrailPipelineSet } from "./pipelines";
import type {
  SimulationConfig,
  TrailFormatMode,
  TrailResolutionScale,
  TrailTargetInfo,
} from "./types";

export interface TrailTargetResources extends TrailTargetInfo {
  textures: [GPUTexture, GPUTexture];
  views: [GPUTextureView, GPUTextureView];
  bindGroups: [GPUBindGroup, GPUBindGroup];
  sampler: GPUSampler;
}

export interface TrailFrameTargets {
  resources: TrailTargetResources;
  readIndex: 0 | 1;
  writeIndex: 0 | 1;
  compositeIndex: 0 | 1;
  shouldUpdate: boolean;
  clearRequired: boolean;
}

interface TrailTargetOptions {
  canvasWidth: number;
  canvasHeight: number;
  requestedMode: TrailFormatMode;
  mode: TrailFormatMode;
  format: GPUTextureFormat;
  scale: TrailResolutionScale;
}

export class RenderTargets {
  private trailResources: TrailTargetResources | null = null;
  private trailReadIndex: 0 | 1 = 0;
  private trailsNeedClear = true;

  constructor(
    private readonly device: GPUDevice,
    private readonly layouts: ParticleLayouts,
    private readonly diagnostics: Diagnostics,
  ) {}

  ensureTrails(
    canvasWidth: number,
    canvasHeight: number,
    config: SimulationConfig,
    pipelines: TrailPipelineSet,
    renderUniformBuffer: GPUBuffer,
  ): TrailTargetResources {
    const targetWidth = Math.max(1, Math.floor(canvasWidth * config.trailResolutionScale));
    const targetHeight = Math.max(1, Math.floor(canvasHeight * config.trailResolutionScale));

    if (
      this.trailResources
      && this.trailResources.width === targetWidth
      && this.trailResources.height === targetHeight
      && this.trailResources.requestedMode === config.trailFormatMode
      && this.trailResources.mode === pipelines.mode
      && this.trailResources.scale === config.trailResolutionScale
    ) {
      return this.trailResources;
    }

    this.releaseTrails();
    this.trailResources = createTrailTargetResources(
      this.device,
      this.layouts,
      renderUniformBuffer,
      {
        canvasWidth,
        canvasHeight,
        requestedMode: config.trailFormatMode,
        mode: pipelines.mode,
        format: pipelines.format,
        scale: config.trailResolutionScale,
      },
    );
    this.trailReadIndex = 0;
    this.trailsNeedClear = true;
    this.diagnostics.log("trails.targets", {
      ...this.describe(this.trailResources),
      canvasWidth,
      canvasHeight,
    });

    if (config.trailFormatMode !== pipelines.mode) {
      this.diagnostics.log("trails.formatFallback", {
        requestedMode: config.trailFormatMode,
        selectedMode: pipelines.mode,
        selectedFormat: pipelines.format,
      });
    }

    return this.trailResources;
  }

  prepareTrailFrame(paused: boolean): TrailFrameTargets {
    if (!this.trailResources) {
      throw new Error("Trail frame targets were requested before allocation.");
    }

    const readIndex = this.trailReadIndex;
    const writeIndex = flipIndex(readIndex);
    const shouldUpdate = !paused || this.trailsNeedClear;

    return {
      resources: this.trailResources,
      readIndex,
      writeIndex,
      compositeIndex: shouldUpdate ? writeIndex : readIndex,
      shouldUpdate,
      clearRequired: this.trailsNeedClear,
    };
  }

  commitTrailFrame(frame: TrailFrameTargets): void {
    if (!frame.shouldUpdate) {
      return;
    }

    this.trailReadIndex = frame.writeIndex;
    this.trailsNeedClear = false;
  }

  describe(resources: TrailTargetResources): TrailTargetInfo {
    return {
      requestedMode: resources.requestedMode,
      mode: resources.mode,
      format: resources.format,
      scale: resources.scale,
      width: resources.width,
      height: resources.height,
      estimatedBytes: resources.estimatedBytes,
    };
  }

  markTrailsForClear(): void {
    this.trailsNeedClear = true;
  }

  releaseTrails(): void {
    destroyTrailTargetResources(this.trailResources);
    this.trailResources = null;
    this.trailReadIndex = 0;
    this.trailsNeedClear = true;
  }

  destroy(): void {
    this.releaseTrails();
  }
}

function createTrailTargetResources(
  device: GPUDevice,
  layouts: ParticleLayouts,
  renderUniformBuffer: GPUBuffer,
  options: TrailTargetOptions,
): TrailTargetResources {
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

function destroyTrailTargetResources(resources: TrailTargetResources | null): void {
  resources?.textures[0].destroy();
  resources?.textures[1].destroy();
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

function flipIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}
