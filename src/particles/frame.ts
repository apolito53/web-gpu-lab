import type { Diagnostics } from "../diagnostics";
import { configureCanvasSize } from "../gpu/resize";
import type { WebGpuContext } from "../gpu/webgpu";
import { createParticleResources, destroyParticleResources, type ParticleResources } from "./buffers";
import {
  debugModeIndex,
  type FrameStats,
  type PointerState,
  pointerModeIndex,
  RENDER_UNIFORM_FLOATS,
  type SimulationConfig,
  SIM_UNIFORM_FLOATS,
  WORKGROUP_SIZE,
} from "./types";
import { createParticlePipelineBundle, type ParticlePipelineBundle } from "./pipelines";

export class ParticleEngine {
  private readonly simUniforms = new Float32Array(SIM_UNIFORM_FLOATS);
  private readonly renderUniforms = new Float32Array(RENDER_UNIFORM_FLOATS);
  private readonly rafFrameTimes: number[] = [];
  private resources: ParticleResources;
  private activeReadIndex: 0 | 1 = 0;
  private seed = 0x51a7f13;
  private lastCanvasWidth = 1;
  private lastCanvasHeight = 1;

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

  reset(config: SimulationConfig): void {
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    this.replaceResources(config.particleCount);
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
    this.lastCanvasWidth = canvasSize.width;
    this.lastCanvasHeight = canvasSize.height;

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

    this.writeSimulationUniforms(now, dt, config, pointer);
    this.writeRenderUniforms(canvasSize.width, canvasSize.height, canvasSize.dpr, config);

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
    const renderPass = commandEncoder.beginRenderPass({
      label: "particle render pass",
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.01, g: 0.012, b: 0.018, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPass.setPipeline(this.pipelines.renderPipeline);
    renderPass.setBindGroup(0, this.resources.renderBindGroups[renderIndex]);
    renderPass.draw(6, config.particleCount);
    renderPass.end();

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
    };
  }

  destroy(): void {
    destroyParticleResources(this.resources);
  }

  private replaceResources(particleCount: number): void {
    destroyParticleResources(this.resources);
    this.resources = createParticleResources(
      this.webgpu.device,
      this.pipelines.layouts,
      particleCount,
      this.seed,
    );
    this.activeReadIndex = 0;
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
    this.simUniforms[18] = this.lastCanvasWidth;
    this.simUniforms[19] = this.lastCanvasHeight;

    this.webgpu.device.queue.writeBuffer(this.resources.simUniformBuffer, 0, this.simUniforms);
  }

  private writeRenderUniforms(width: number, height: number, dpr: number, config: SimulationConfig): void {
    this.renderUniforms[0] = width;
    this.renderUniforms[1] = height;
    this.renderUniforms[2] = dpr;
    this.renderUniforms[3] = config.particleSize;
    this.renderUniforms[4] = debugModeIndex(config.debugMode);
    this.renderUniforms[5] = config.strength;
    this.renderUniforms[6] = config.radius;
    this.renderUniforms[7] = config.paused ? 1 : 0;

    this.webgpu.device.queue.writeBuffer(this.resources.renderUniformBuffer, 0, this.renderUniforms);
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
