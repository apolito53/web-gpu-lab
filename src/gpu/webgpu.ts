import type { Diagnostics } from "../diagnostics";

export interface WebGpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  canvasContext: GPUCanvasContext;
  format: GPUTextureFormat;
  adapterSummary: string;
}

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuUnavailableError";
  }
}

type AdapterWithInfo = GPUAdapter & {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
};

export async function initializeWebGpu(
  canvas: HTMLCanvasElement,
  diagnostics: Diagnostics,
): Promise<WebGpuContext> {
  const gpu = navigator.gpu;
  diagnostics.log("webgpu.support", { available: Boolean(gpu) });

  if (!gpu) {
    throw new WebGpuUnavailableError("This browser does not expose navigator.gpu.");
  }

  const adapter = await gpu.requestAdapter();

  if (!adapter) {
    throw new WebGpuUnavailableError("No WebGPU adapter was available.");
  }

  const device = await adapter.requestDevice();
  const canvasContext = canvas.getContext("webgpu");

  if (!canvasContext) {
    throw new WebGpuUnavailableError("Could not create a WebGPU canvas context.");
  }

  const format = gpu.getPreferredCanvasFormat();
  const adapterSummary = summarizeAdapter(adapter);

  device.lost.then((info) => {
    diagnostics.log("webgpu.deviceLost", {
      reason: info.reason,
      message: info.message,
    });
  });

  device.addEventListener("uncapturederror", (event) => {
    const gpuEvent = event as GPUUncapturedErrorEvent;

    diagnostics.log("webgpu.uncapturedError", {
      message: gpuEvent.error.message,
    });
  });

  diagnostics.log("webgpu.ready", {
    adapter: adapterSummary,
    preferredFormat: format,
  });

  return {
    adapter,
    device,
    canvasContext,
    format,
    adapterSummary,
  };
}

function summarizeAdapter(adapter: GPUAdapter): string {
  const info = (adapter as AdapterWithInfo).info;
  const parts = [
    info?.vendor,
    info?.architecture,
    info?.device,
    info?.description,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "WebGPU adapter";
}
