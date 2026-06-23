import type { WebGpuContext } from "./webgpu";

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
  changed: boolean;
}

const MAX_DEVICE_PIXEL_RATIO = 2;

export function configureCanvasSize(
  canvas: HTMLCanvasElement,
  webgpu: WebGpuContext,
): CanvasSize {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  const changed = canvas.width !== width || canvas.height !== height;

  if (changed) {
    canvas.width = width;
    canvas.height = height;
    webgpu.canvasContext.configure({
      device: webgpu.device,
      format: webgpu.format,
      alphaMode: "opaque",
    });
  }

  return { width, height, dpr, changed };
}

