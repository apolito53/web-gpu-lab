import type { Diagnostics } from "../diagnostics";
import computeShaderSource from "../shaders/particles.compute.wgsl?raw";
import renderShaderSource from "../shaders/particles.render.wgsl?raw";
import trailShaderSource from "../shaders/trails.render.wgsl?raw";
import { TRAIL_FORMAT } from "./types";

export interface ParticleLayouts {
  compute: GPUBindGroupLayout;
  render: GPUBindGroupLayout;
  trail: GPUBindGroupLayout;
}

export interface ParticlePipelineBundle {
  layouts: ParticleLayouts;
  computePipeline: GPUComputePipeline;
  gridPipeline: GPURenderPipeline;
  renderPipeline: GPURenderPipeline;
  trailFadePipeline: GPURenderPipeline;
  trailCompositePipeline: GPURenderPipeline;
  trailParticlePipeline: GPURenderPipeline;
}

export async function createParticlePipelineBundle(
  device: GPUDevice,
  format: GPUTextureFormat,
  diagnostics: Diagnostics,
): Promise<ParticlePipelineBundle> {
  device.pushErrorScope("validation");

  const layouts = createLayouts(device);
  const computeModule = device.createShaderModule({
    label: "particle compute shader",
    code: computeShaderSource,
  });
  const renderModule = device.createShaderModule({
    label: "particle render shader",
    code: renderShaderSource,
  });
  const trailModule = device.createShaderModule({
    label: "trail render shader",
    code: trailShaderSource,
  });

  let computePipeline: GPUComputePipeline;
  let gridPipeline: GPURenderPipeline;
  let renderPipeline: GPURenderPipeline;
  let trailFadePipeline: GPURenderPipeline;
  let trailCompositePipeline: GPURenderPipeline;
  let trailParticlePipeline: GPURenderPipeline;

  try {
    computePipeline = await device.createComputePipelineAsync({
      label: "particle compute pipeline",
      layout: device.createPipelineLayout({
        label: "particle compute layout",
        bindGroupLayouts: [layouts.compute],
      }),
      compute: {
        module: computeModule,
        entryPoint: "main",
      },
    });

    renderPipeline = await createParticleRenderPipeline(
      device,
      renderModule,
      layouts.render,
      format,
      "fragmentMain",
      "particle render pipeline",
    );

    trailParticlePipeline = await createParticleRenderPipeline(
      device,
      renderModule,
      layouts.render,
      TRAIL_FORMAT,
      "trailFragmentMain",
      "particle trail render pipeline",
    );

    trailFadePipeline = await createTrailPipeline(
      device,
      trailModule,
      layouts.trail,
      TRAIL_FORMAT,
      "fadeFragmentMain",
      "trail fade pipeline",
    );

    trailCompositePipeline = await createTrailPipeline(
      device,
      trailModule,
      layouts.trail,
      format,
      "compositeFragmentMain",
      "trail composite pipeline",
    );

    gridPipeline = await device.createRenderPipelineAsync({
      label: "particle reference grid pipeline",
      layout: device.createPipelineLayout({
        label: "particle reference grid layout",
        bindGroupLayouts: [layouts.render],
      }),
      vertex: {
        module: renderModule,
        entryPoint: "gridVertexMain",
      },
      fragment: {
        module: renderModule,
        entryPoint: "gridFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "line-list",
      },
    });
  } catch (error) {
    const scopedError = await device.popErrorScope().catch(() => null);
    const message = scopedError?.message ?? (error instanceof Error ? error.message : String(error));
    diagnostics.log("webgpu.pipelineError", { message });
    throw new Error(message);
  }

  const scopedError = await device.popErrorScope();

  if (scopedError) {
    diagnostics.log("webgpu.pipelineError", {
      message: scopedError.message,
    });
    throw new Error(scopedError.message);
  }

  return {
    layouts,
    computePipeline,
    gridPipeline,
    renderPipeline,
    trailFadePipeline,
    trailCompositePipeline,
    trailParticlePipeline,
  };
}

function createParticleRenderPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  fragmentEntryPoint: string,
  label: string,
): Promise<GPURenderPipeline> {
  return device.createRenderPipelineAsync({
    label,
    layout: device.createPipelineLayout({
      label: `${label} layout`,
      bindGroupLayouts: [layout],
    }),
    vertex: {
      module,
      entryPoint: "vertexMain",
    },
    fragment: {
      module,
      entryPoint: fragmentEntryPoint,
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function createTrailPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  fragmentEntryPoint: string,
  label: string,
): Promise<GPURenderPipeline> {
  return device.createRenderPipelineAsync({
    label,
    layout: device.createPipelineLayout({
      label: `${label} layout`,
      bindGroupLayouts: [layout],
    }),
    vertex: {
      module,
      entryPoint: "fullscreenVertexMain",
    },
    fragment: {
      module,
      entryPoint: fragmentEntryPoint,
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function createLayouts(device: GPUDevice): ParticleLayouts {
  const compute = device.createBindGroupLayout({
    label: "particle compute bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const render = device.createBindGroupLayout({
    label: "particle render bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const trail = device.createBindGroupLayout({
    label: "trail texture bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  return { compute, render, trail };
}
