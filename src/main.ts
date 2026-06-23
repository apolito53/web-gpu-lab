import { Diagnostics } from "./diagnostics";
import { initializeWebGpu, WebGpuUnavailableError } from "./gpu/webgpu";
import { ParticleEngine } from "./particles/frame";
import type { PointerState, SimulationConfig } from "./particles/types";
import { Controls } from "./ui/controls";
import "./styles.css";

const diagnostics = new Diagnostics();
diagnostics.installGlobalErrorHandlers();
diagnostics.log("app.boot", { app: "webgpu-particle-lab" });

const canvas = requireElement<HTMLCanvasElement>("particle-canvas");
const hudRoot = requireElement<HTMLElement>("hud-root");
const fallbackRoot = requireElement<HTMLElement>("fallback-root");
const pointer: PointerState = { x: 0, y: 0, active: false, locked: false };
let latestConfig: SimulationConfig;
let engine: ParticleEngine | null = null;
let animationFrame = 0;
let lastFrameTime = performance.now();

const controls = new Controls(hudRoot, {
  onConfigChanged: (config, key) => {
    latestConfig = config;
    diagnostics.log(key === "debugMode" ? "debug.mode" : "control.changed", {
      key,
      value: String(config[key as keyof SimulationConfig]),
    });
  },
  onReset: () => {
    if (engine) {
      engine.reset(latestConfig);
    }
  },
  onPointerLockChanged: (locked) => {
    pointer.locked = locked;
    pointer.active = locked || pointer.active;
    controls.updatePointer(pointer.active, pointer.locked);
    diagnostics.log("control.changed", { key: "pointerLock", value: locked });
  },
});
latestConfig = { ...controls.config };

installPointerInput();
void boot();

async function boot(): Promise<void> {
  try {
    controls.updateStatus("Requesting GPU");
    const webgpu = await initializeWebGpu(canvas, diagnostics);
    controls.updateStatus(webgpu.adapterSummary);
    engine = await ParticleEngine.create(canvas, webgpu, diagnostics, latestConfig);
    engine.reset(latestConfig);
    animationFrame = requestAnimationFrame(runFrame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof WebGpuUnavailableError) {
      diagnostics.log("webgpu.unavailable", { message });
      showFallback("WebGPU unavailable", message);
      controls.updateStatus("Unavailable");
      return;
    }

    diagnostics.log("webgpu.bootError", { message });
    showFallback("WebGPU boot failed", message);
    controls.updateStatus("Boot failed");
  }
}

function runFrame(now: number): void {
  if (!engine) {
    return;
  }

  const deltaSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const stats = engine.frame(now, deltaSeconds, latestConfig, pointer);
  controls.updateStats(stats);
  diagnostics.logFrameSample(now, {
    fps: stats.fps,
    frameMs: stats.frameMs,
    particleCount: stats.particleCount,
    dispatchSize: stats.dispatchSize,
    canvasWidth: stats.canvasWidth,
    canvasHeight: stats.canvasHeight,
    paused: stats.paused,
  });
  animationFrame = requestAnimationFrame(runFrame);
}

function installPointerInput(): void {
  canvas.addEventListener("pointermove", (event) => {
    updatePointerPosition(event);
    pointer.active = true;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    updatePointerPosition(event);
    pointer.active = true;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    pointer.active = pointer.locked;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.active = pointer.locked;
    controls.updatePointer(pointer.active, pointer.locked);
  });
}

function updatePointerPosition(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
  const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
  pointer.x = x * 2 - 1;
  pointer.y = -(y * 2 - 1);
}

function showFallback(title: string, detail: string): void {
  cancelAnimationFrame(animationFrame);
  canvas.hidden = true;
  fallbackRoot.hidden = false;
  fallbackRoot.replaceChildren();

  const panel = document.createElement("section");
  panel.className = "fallback-panel";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  panel.append(heading, paragraph);
  fallbackRoot.append(panel);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing #${id}`);
  }

  return element as T;
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrame);
  engine?.destroy();
});

