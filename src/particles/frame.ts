import type { Diagnostics } from "../diagnostics";
import { configureCanvasSize } from "../gpu/resize";
import type { WebGpuContext } from "../gpu/webgpu";
import { createParticleResources, destroyParticleResources, type ParticleResources } from "./buffers";
import { createTrailResources, destroyTrailResources, type TrailResources } from "./trails";
import {
  debugModeIndex,
  type FrameStats,
  GRID_VERTEX_COUNT,
  type PointerState,
  pointerModeIndex,
  RENDER_UNIFORM_FLOATS,
  type SimulationConfig,
  SIM_UNIFORM_FLOATS,
  type TrailFormatMode,
  type TrailTargetInfo,
  WORKGROUP_SIZE,
} from "./types";
import {
  createParticlePipelineBundle,
  type ParticlePipelineBundle,
  type TrailPipelineSet,
} from "./pipelines";

export class ParticleEngine {
  private readonly simUniforms = new Float32Array(SIM_UNIFORM_FLOATS);
  private readonly renderUniforms = new Float32Array(RENDER_UNIFORM_FLOATS);
  private readonly rafFrameTimes: number[] = [];
  private resources: ParticleResources;
  private trailResources: TrailResources | null = null;
  private activeReadIndex: 0 | 1 = 0;
  private trailReadIndex: 0 | 1 = 0;
  private needsTrailClear = true;
  private seed = 0x51a7f13;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly webgpu: WebGpuContext,
    private readonly pipelines: ParticlePipelineBundle,
    private readonly diagnostics: Diagnostics,
    initialConfig: SimulationConfig,
  ) {
    this.resources = createParticleResources(
      webgpu.device,
      pipelines.layouts,
      initialConfig.particleCount,
      this.seed,
    );
  }

  static async create(
    canvas: HTMLCanvasElement,
    webgpu: WebGpuContext,
    diagnostics: Diagnostics,
    initialConfig: SimulationConfig,
  ): Promise<ParticleEngine> {
    const pipelines = await createParticlePipelineBundle(webgpu.device, webgpu.format, diagnostics);
    return new ParticleEngine(canvas, webgpu, pipelines, diagnostics, initialConfig);
  }

  supportsTrailFormat(mode: TrailFormatMode): boolean {
    return this.pipelines.trailPipelines[mode] !== null;
  }

  reset(config: SimulationConfig): void {
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    this.replaceResources(config.particleCount);
    this.needsTrailClear = true;
    this.diagnostics.log("simulation.reset", {
      particleCount: config.particleCount,
      seed: this.seed,
    });
  }

  frame(now: number, deltaSeconds: number, config: SimulationConfig, pointer: PointerState): FrameStats {
    if (config.particleCount !== this.resources.particleCount) {
      this.replaceResources(config.particleCount);
      this.diagnostics.log("particles.countChanged", {
        particleCount: config.particleCount,
      });
    }

    const canvasSize = configureCanvasSize(this.canvas, this.webgpu);

    if (canvasSize.changed) {
      this.diagnostics.log("resize", {
        width: canvasSize.width,
        height: canvasSize.height,
        dpr: Number(canvasSize.dpr.toFixed(2)),
      });
    }

    const cpuSubmitStart = performance.now();
    const rafFrameMs = deltaSeconds * 1000;
    const dt = config.paused ? 0 : Math.min(deltaSeconds, 1 / 30);
    const dispatchSize = Math.ceil(config.particleCount / WORKGROUP_SIZE);
    const renderIndex = config.paused ? this.activeReadIndex : this.flipIndex(this.activeReadIndex);
    const trailsEnabled = config.trailOpacity > 0.001;
    const trailPipelines = this.resolveTrailPipelines(config.trailFormatMode);
    const trailResources = trailsEnabled
      ? this.ensureTrailResources(canvasSize.width, canvasSize.height, config, trailPipelines)
      : null;

    if (!trailsEnabled) {
      this.releaseTrailResources();
    }

    this.writeSimulationUniforms(now, dt, config, pointer);
    this.writeRenderUniforms(
      now,
      canvasSize.width,
      canvasSize.height,
      canvasSize.dpr,
      dt,
      trailResources !== null && this.needsTrailClear,
      trailResources?.mode ?? "compat",
      config,
    );

    const commandEncoder = this.webgpu.device.createCommandEncoder({
      label: "particle frame command encoder",
    });

    if (!config.paused) {
      const computePass = commandEncoder.beginComputePass({ label: "particle compute pass" });
      computePass.setPipeline(this.pipelines.computePipeline);
      computePass.setBindGroup(0, this.resources.computeBindGroups[this.activeReadIndex]);
      computePass.dispatchWorkgroups(dispatchSize);
      computePass.end();
    }

    const textureView = this.webgpu.canvasContext.getCurrentTexture().createView();

    if (trailResources) {
      this.renderTrailFrame(
        commandEncoder,
        textureView,
        trailResources,
        trailPipelines,
        renderIndex,
        config,
      );
    } else {
      this.renderDirectFrame(commandEncoder, textureView, renderIndex, config);
    }

    this.webgpu.device.queue.submit([commandEncoder.finish()]);

    if (!config.paused) {
      this.activeReadIndex = renderIndex;
    }

    const cpuSubmitMs = performance.now() - cpuSubmitStart;
    const fps = this.updateRafAverage(rafFrameMs);

    return {
      fps,
      rafFrameMs,
      cpuSubmitMs,
      particleCount: config.particleCount,
      dispatchSize,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      pointerMode: config.pointerMode,
      debugMode: config.debugMode,
      paused: config.paused,
      trailTarget: trailResources ? this.describeTrailTarget(trailResources) : null,
    };
  }

  destroy(): void {
    destroyParticleResources(this.resources);
    destroyTrailResources(this.trailResources);
  }

  private replaceResources(particleCount: number): void {
    destroyParticleResources(this.resources);
    this.releaseTrailResources();
    this.resources = createParticleResources(
      this.webgpu.device,
      this.pipelines.layouts,
      particleCount,
      this.seed,
    );
    this.activeReadIndex = 0;
    this.needsTrailClear = true;
  }

  private writeSimulationUniforms(
    now: number,
    deltaSeconds: number,
    config: SimulationConfig,
    pointer: PointerState,
  ): void {
    this.simUniforms[0] = deltaSeconds;
    this.simUniforms[1] = now / 1000;
    this.simUniforms[2] = config.particleCount;
    this.simUniforms[3] = this.seed;
    this.simUniforms[4] = config.speed;
    this.simUniforms[5] = config.damping;
    this.simUniforms[6] = 1.12;
    this.simUniforms[7] = config.particleSize;
    this.simUniforms[8] = pointer.x;
    this.simUniforms[9] = pointer.y;
    this.simUniforms[10] = config.strength;
    this.simUniforms[11] = config.radius;
    this.simUniforms[12] = pointer.active || pointer.locked ? 1 : 0;
    this.simUniforms[13] = pointerModeIndex(config.pointerMode);
    this.simUniforms[14] = config.turbulence;
    this.simUniforms[15] = config.noiseScale;
    this.simUniforms[16] = config.flowSpeed;
    this.simUniforms[17] = config.diffusion;
    this.simUniforms[18] = config.depth;
    this.simUniforms[19] = 0;

    this.webgpu.device.queue.writeBuffer(this.resources.simUniformBuffer, 0, this.simUniforms);
  }

  private writeRenderUniforms(
    now: number,
    width: number,
    height: number,
    dpr: number,
    deltaSeconds: number,
    clearTrail: boolean,
    trailMode: TrailFormatMode,
    config: SimulationConfig,
  ): void {
    this.renderUniforms[0] = width;
    this.renderUniforms[1] = height;
    this.renderUniforms[2] = dpr;
    this.renderUniforms[3] = config.particleSize;
    this.renderUniforms[4] = debugModeIndex(config.debugMode);
    this.renderUniforms[5] = config.strength;
    this.renderUniforms[6] = config.radius;
    this.renderUniforms[7] = config.paused ? 1 : 0;
    this.renderUniforms[8] = now / 1000;
    this.renderUniforms[9] = config.cameraSpin;
    this.renderUniforms[10] = config.depth;
    this.renderUniforms[11] = config.perspective;
    this.renderUniforms[12] = config.gridOpacity;
    this.renderUniforms[13] = 1.12;
    this.renderUniforms[14] = 0;
    this.renderUniforms[15] = 0;
    this.renderUniforms[16] = config.trailOpacity;
    this.renderUniforms[17] = config.trailDecay;
    this.renderUniforms[18] = deltaSeconds * 60;
    this.renderUniforms[19] = clearTrail ? 1 : 0;
    this.renderUniforms[20] = config.trailExposure;
    this.renderUniforms[21] = trailMode === "hdr" ? 1 : 0;
    this.renderUniforms[22] = config.trailResolutionScale;
    this.renderUniforms[23] = 0;

    this.webgpu.device.queue.writeBuffer(this.resources.renderUniformBuffer, 0, this.renderUniforms);
  }

  private renderDirectFrame(
    commandEncoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    renderIndex: 0 | 1,
    config: SimulationConfig,
  ): void {
    const renderPass = commandEncoder.beginRenderPass({
      label: "particle direct render pass",
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.01, g: 0.012, b: 0.018, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPass.setBindGroup(0, this.resources.renderBindGroups[renderIndex]);
    renderPass.setPipeline(this.pipelines.renderPipeline);
    renderPass.draw(6, config.particleCount);
    this.drawGrid(renderPass, config);
    renderPass.end();
  }

  private renderTrailFrame(
    commandEncoder: GPUCommandEncoder,
    textureView: GPUTextureView,
    trailResources: TrailResources,
    trailPipelines: TrailPipelineSet,
    renderIndex: 0 | 1,
    config: SimulationConfig,
  ): void {
    let compositeTrailIndex = this.trailReadIndex;
    const shouldUpdateTrail = !config.paused || this.needsTrailClear;

    if (shouldUpdateTrail) {
      const writeIndex = this.flipIndex(this.trailReadIndex);

      const fadePass = commandEncoder.beginRenderPass({
        label: "trail fade pass",
        colorAttachments: [
          {
            view: trailResources.views[writeIndex],
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      fadePass.setPipeline(trailPipelines.fadePipeline);
      fadePass.setBindGroup(0, trailResources.bindGroups[this.trailReadIndex]);
      fadePass.draw(3);
      fadePass.end();

      const particleTrailPass = commandEncoder.beginRenderPass({
        label: "particle trail render pass",
        colorAttachments: [
          {
            view: trailResources.views[writeIndex],
            loadOp: "load",
            storeOp: "store",
          },
        ],
      });
      particleTrailPass.setBindGroup(0, this.resources.renderBindGroups[renderIndex]);
      particleTrailPass.setPipeline(trailPipelines.particlePipeline);
      particleTrailPass.draw(6, config.particleCount);
      particleTrailPass.end();

      this.trailReadIndex = writeIndex;
      this.needsTrailClear = false;
      compositeTrailIndex = writeIndex;
    }

    const compositePass = commandEncoder.beginRenderPass({
      label: "trail composite pass",
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.01, g: 0.012, b: 0.018, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    compositePass.setPipeline(this.pipelines.trailCompositePipeline);
    compositePass.setBindGroup(0, trailResources.bindGroups[compositeTrailIndex]);
    compositePass.draw(3);

    // History is deliberately low-energy. Draw the current frame at full
    // resolution so particles stay crisp while their previous positions fade.
    compositePass.setBindGroup(0, this.resources.renderBindGroups[renderIndex]);
    compositePass.setPipeline(this.pipelines.renderPipeline);
    compositePass.draw(6, config.particleCount);
    this.drawGrid(compositePass, config);
    compositePass.end();
  }

  private drawGrid(renderPass: GPURenderPassEncoder, config: SimulationConfig): void {
    if (config.gridOpacity <= 0.001) {
      return;
    }

    renderPass.setPipeline(this.pipelines.gridPipeline);
    renderPass.draw(GRID_VERTEX_COUNT);
  }

  private ensureTrailResources(
    width: number,
    height: number,
    config: SimulationConfig,
    trailPipelines: TrailPipelineSet,
  ): TrailResources {
    const targetWidth = Math.max(1, Math.floor(width * config.trailResolutionScale));
    const targetHeight = Math.max(1, Math.floor(height * config.trailResolutionScale));

    if (
      this.trailResources
      && this.trailResources.width === targetWidth
      && this.trailResources.height === targetHeight
      && this.trailResources.requestedMode === config.trailFormatMode
      && this.trailResources.mode === trailPipelines.mode
      && this.trailResources.scale === config.trailResolutionScale
    ) {
      return this.trailResources;
    }

    destroyTrailResources(this.trailResources);
    this.trailResources = createTrailResources(
      this.webgpu.device,
      this.pipelines.layouts,
      this.resources.renderUniformBuffer,
      {
        canvasWidth: width,
        canvasHeight: height,
        requestedMode: config.trailFormatMode,
        mode: trailPipelines.mode,
        format: trailPipelines.format,
        scale: config.trailResolutionScale,
      },
    );
    this.trailReadIndex = 0;
    this.needsTrailClear = true;
    this.diagnostics.log("trails.targets", {
      ...this.describeTrailTarget(this.trailResources),
      canvasWidth: width,
      canvasHeight: height,
    });

    if (config.trailFormatMode !== trailPipelines.mode) {
      this.diagnostics.log("trails.formatFallback", {
        requestedMode: config.trailFormatMode,
        selectedMode: trailPipelines.mode,
        selectedFormat: trailPipelines.format,
      });
    }

    return this.trailResources;
  }

  private resolveTrailPipelines(requestedMode: TrailFormatMode): TrailPipelineSet {
    const selected = this.pipelines.trailPipelines[requestedMode]
      ?? this.pipelines.trailPipelines.compat;

    if (!selected) {
      throw new Error("The required 8-bit trail pipeline is unavailable.");
    }

    return selected;
  }

  private describeTrailTarget(resources: TrailResources): TrailTargetInfo {
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

  private releaseTrailResources(): void {
    if (!this.trailResources) {
      return;
    }

    destroyTrailResources(this.trailResources);
    this.trailResources = null;
    this.trailReadIndex = 0;
    this.needsTrailClear = true;
  }

  private updateRafAverage(frameMs: number): number {
    this.rafFrameTimes.push(frameMs);

    while (this.rafFrameTimes.length > 45) {
      this.rafFrameTimes.shift();
    }

    const average = this.rafFrameTimes.reduce((sum, value) => sum + value, 0) / this.rafFrameTimes.length;
    return average > 0 ? 1000 / average : 0;
  }

  private flipIndex(index: 0 | 1): 0 | 1 {
    return index === 0 ? 1 : 0;
  }
}
