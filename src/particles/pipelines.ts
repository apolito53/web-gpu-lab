import type { Diagnostics } from "../diagnostics";
import computeShaderSource from "../shaders/particles.compute.wgsl?raw";
import renderShaderSource from "../shaders/particles.render.wgsl?raw";

export interface ParticleLayouts {
  compute: GPUBindGroupLayout;
  render: GPUBindGroupLayout;
}

export interface ParticlePipelineBundle {
  layouts: ParticleLayouts;
  computePipeline: GPUComputePipeline;
  gridPipeline: GPURenderPipeline;
  renderPipeline: GPURenderPipeline;
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

  let computePipeline: GPUComputePipeline;
  let gridPipeline: GPURenderPipeline;
  let renderPipeline: GPURenderPipeline;

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

    renderPipeline = await device.createRenderPipelineAsync({
      label: "particle render pipeline",
      layout: device.createPipelineLayout({
        label: "particle render layout",
        bindGroupLayouts: [layouts.render],
      }),
      vertex: {
        module: renderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: renderModule,
        entryPoint: "fragmentMain",
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
  };
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

  return { compute, render };
}
