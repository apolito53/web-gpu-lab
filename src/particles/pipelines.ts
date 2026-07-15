import type { Diagnostics } from "../diagnostics";
import computeShaderSource from "../shaders/particles.compute.wgsl?raw";
import renderShaderSource from "../shaders/particles.render.wgsl?raw";
import trailShaderSource from "../shaders/trails.render.wgsl?raw";
import { TRAIL_FORMATS, type TrailFormatMode } from "./types";

export interface ParticleLayouts {
  compute: GPUBindGroupLayout;
  render: GPUBindGroupLayout;
  trail: GPUBindGroupLayout;
}

export interface TrailPipelineSet {
  mode: TrailFormatMode;
  format: GPUTextureFormat;
  fadePipeline: GPURenderPipeline;
  particlePipeline: GPURenderPipeline;
}

export interface ParticlePipelineBundle {
  layouts: ParticleLayouts;
  computePipeline: GPUComputePipeline;
  gridPipeline: GPURenderPipeline;
  renderPipeline: GPURenderPipeline;
  trailCompositePipeline: GPURenderPipeline;
  trailPipelines: Record<TrailFormatMode, TrailPipelineSet | null>;
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
  let trailCompositePipeline: GPURenderPipeline;
  let compatTrailPipelines: TrailPipelineSet;

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

    compatTrailPipelines = await createTrailTargetPipelines(
      device,
      renderModule,
      trailModule,
      layouts,
      "compat",
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

  const hdrTrailPipelines = await tryCreateOptionalTrailPipelines(
    device,
    renderModule,
    trailModule,
    layouts,
    "hdr",
    diagnostics,
  );

  return {
    layouts,
    computePipeline,
    gridPipeline,
    renderPipeline,
    trailCompositePipeline,
    trailPipelines: {
      compat: compatTrailPipelines,
      hdr: hdrTrailPipelines,
    },
  };
}

async function createTrailTargetPipelines(
  device: GPUDevice,
  renderModule: GPUShaderModule,
  trailModule: GPUShaderModule,
  layouts: ParticleLayouts,
  mode: TrailFormatMode,
): Promise<TrailPipelineSet> {
  const format = TRAIL_FORMATS[mode];
  const label = mode === "hdr" ? "HDR" : "8-bit";
  const [particlePipeline, fadePipeline] = await Promise.all([
    createParticleRenderPipeline(
      device,
      renderModule,
      layouts.render,
      format,
      "trailFragmentMain",
      `${label} particle trail render pipeline`,
    ),
    createTrailPipeline(
      device,
      trailModule,
      layouts.trail,
      format,
      "fadeFragmentMain",
      `${label} trail fade pipeline`,
    ),
  ]);

  return { mode, format, fadePipeline, particlePipeline };
}

async function tryCreateOptionalTrailPipelines(
  device: GPUDevice,
  renderModule: GPUShaderModule,
  trailModule: GPUShaderModule,
  layouts: ParticleLayouts,
  mode: TrailFormatMode,
  diagnostics: Diagnostics,
): Promise<TrailPipelineSet | null> {
  device.pushErrorScope("validation");
  let pipelines: TrailPipelineSet | null = null;
  let thrownMessage: string | null = null;

  try {
    pipelines = await createTrailTargetPipelines(device, renderModule, trailModule, layouts, mode);
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  const scopedError = await device.popErrorScope().catch(() => null);
  const message = scopedError?.message ?? thrownMessage;

  if (message || !pipelines) {
    diagnostics.log("trails.formatUnsupported", {
      mode,
      format: TRAIL_FORMATS[mode],
      message: message ?? "Pipeline creation returned no result.",
    });
    return null;
  }

  return pipelines;
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
