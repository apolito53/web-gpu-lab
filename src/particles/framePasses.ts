import type { GpuFrameProfile } from "../instrumentation/gpuTimestampProfiler";
import type { ParticleResources } from "./buffers";
import type { ParticlePipelineBundle, TrailPipelineSet } from "./pipelines";
import type { TrailFrameTargets } from "./renderTargets";
import { GRID_VERTEX_COUNT, type SimulationConfig } from "./types";

const CANVAS_CLEAR_COLOR: GPUColor = { r: 0.01, g: 0.012, b: 0.018, a: 1 };

export function recordComputePass(
  commandEncoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  resources: ParticleResources,
  readIndex: 0 | 1,
  dispatchSize: number,
  gpuFrame: GpuFrameProfile | null,
): void {
  const computePass = commandEncoder.beginComputePass({
    label: "particle compute pass",
    timestampWrites: gpuFrame?.timestampWrites("compute"),
  });
  computePass.setPipeline(pipeline);
  computePass.setBindGroup(0, resources.computeBindGroups[readIndex]);
  computePass.dispatchWorkgroups(dispatchSize);
  computePass.end();
}

export function recordDirectFramePass(
  commandEncoder: GPUCommandEncoder,
  canvasView: GPUTextureView,
  pipelines: ParticlePipelineBundle,
  resources: ParticleResources,
  gpuFrame: GpuFrameProfile | null,
  renderIndex: 0 | 1,
  config: SimulationConfig,
): void {
  const renderPass = commandEncoder.beginRenderPass({
    label: "particle direct render pass",
    timestampWrites: gpuFrame?.timestampWrites("directRender"),
    colorAttachments: [
      {
        view: canvasView,
        clearValue: CANVAS_CLEAR_COLOR,
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });

  renderPass.setBindGroup(0, resources.renderBindGroups[renderIndex]);
  renderPass.setPipeline(pipelines.renderPipeline);
  renderPass.draw(6, config.particleCount);
  recordGridDraw(renderPass, pipelines, config);
  renderPass.end();
}

export function recordTrailFramePasses(
  commandEncoder: GPUCommandEncoder,
  canvasView: GPUTextureView,
  pipelines: ParticlePipelineBundle,
  trailPipelines: TrailPipelineSet,
  resources: ParticleResources,
  targets: TrailFrameTargets,
  gpuFrame: GpuFrameProfile | null,
  renderIndex: 0 | 1,
  config: SimulationConfig,
): void {
  if (targets.shouldUpdate) {
    const fadePass = commandEncoder.beginRenderPass({
      label: "trail fade pass",
      timestampWrites: gpuFrame?.timestampWrites("trailFade"),
      colorAttachments: [
        {
          view: targets.resources.views[targets.writeIndex],
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    fadePass.setPipeline(trailPipelines.fadePipeline);
    fadePass.setBindGroup(0, targets.resources.bindGroups[targets.readIndex]);
    fadePass.draw(3);
    fadePass.end();

    const particleTrailPass = commandEncoder.beginRenderPass({
      label: "particle trail render pass",
      timestampWrites: gpuFrame?.timestampWrites("trailParticles"),
      colorAttachments: [
        {
          view: targets.resources.views[targets.writeIndex],
          loadOp: "load",
          storeOp: "store",
        },
      ],
    });
    particleTrailPass.setBindGroup(0, resources.renderBindGroups[renderIndex]);
    particleTrailPass.setPipeline(trailPipelines.particlePipeline);
    particleTrailPass.draw(6, config.particleCount);
    particleTrailPass.end();
  }

  const compositePass = commandEncoder.beginRenderPass({
    label: "trail composite pass",
    timestampWrites: gpuFrame?.timestampWrites("trailComposite"),
    colorAttachments: [
      {
        view: canvasView,
        clearValue: CANVAS_CLEAR_COLOR,
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  compositePass.setPipeline(pipelines.trailCompositePipeline);
  compositePass.setBindGroup(0, targets.resources.bindGroups[targets.compositeIndex]);
  compositePass.draw(3);

  // History stays low-energy; the live frame and grid remain full-resolution.
  compositePass.setBindGroup(0, resources.renderBindGroups[renderIndex]);
  compositePass.setPipeline(pipelines.renderPipeline);
  compositePass.draw(6, config.particleCount);
  recordGridDraw(compositePass, pipelines, config);
  compositePass.end();
}

function recordGridDraw(
  renderPass: GPURenderPassEncoder,
  pipelines: ParticlePipelineBundle,
  config: SimulationConfig,
): void {
  if (config.gridOpacity <= 0.001) {
    return;
  }

  renderPass.setPipeline(pipelines.gridPipeline);
  renderPass.draw(GRID_VERTEX_COUNT);
}
