import { Diagnostics } from "./diagnostics";
import { initializeWebGpu, WebGpuUnavailableError, type WebGpuContext } from "./gpu/webgpu";
import {
  BENCHMARK_PARTICLE_COUNTS,
  BenchmarkRunner,
  type BenchmarkProgress,
  type BenchmarkReport,
  type DeviceProfile,
} from "./instrumentation/benchmark";
import { RollingFrameMetrics } from "./instrumentation/frameMetrics";
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
let lastFrameTime: number | null = null;
let deviceProfile: DeviceProfile | null = null;
let benchmarkRunner: BenchmarkRunner | null = null;
let latestBenchmarkReport: BenchmarkReport | null = null;
let benchmarkRestoreState: Pick<SimulationConfig, "particleCount" | "paused"> | null = null;
const frameMetrics = new RollingFrameMetrics();

const DEVICE_LIMIT_KEYS = [
  "maxTextureDimension2D",
  "maxBindGroups",
  "maxStorageBuffersPerShaderStage",
  "maxUniformBufferBindingSize",
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupsPerDimension",
] as const;

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
  onBenchmarkStart: () => startBenchmark(),
  onBenchmarkCopy: () => {
    void copyBenchmarkReport();
  },
});
latestConfig = { ...controls.config };

installPointerInput();
void boot();

async function boot(): Promise<void> {
  try {
    controls.updateStatus("Requesting GPU");
    const webgpu = await initializeWebGpu(canvas, diagnostics);
    deviceProfile = createDeviceProfile(webgpu);
    controls.updateStatus(webgpu.adapterSummary);
    diagnostics.log("webgpu.profile", {
      adapter: deviceProfile.adapter,
      preferredFormat: deviceProfile.preferredFormat,
      features: deviceProfile.features,
      limits: deviceProfile.limits,
    });
    engine = await ParticleEngine.create(canvas, webgpu, diagnostics, latestConfig);
    engine.reset(latestConfig);
    lastFrameTime = null;
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

  const deltaSeconds = lastFrameTime === null ? 1 / 60 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const stats = engine.frame(now, deltaSeconds, latestConfig, pointer);
  const metricSummary = frameMetrics.record(stats);
  controls.updateStats(stats);
  controls.updatePerformance(metricSummary);
  updateBenchmark(now, stats);
  diagnostics.logFrameSample(now, {
    fps: stats.fps,
    rafFrameMs: stats.rafFrameMs,
    cpuSubmitMs: stats.cpuSubmitMs,
    particleCount: stats.particleCount,
    dispatchSize: stats.dispatchSize,
    canvasWidth: stats.canvasWidth,
    canvasHeight: stats.canvasHeight,
    paused: stats.paused,
  });
  animationFrame = requestAnimationFrame(runFrame);
}

function startBenchmark(): void {
  if (!engine || !deviceProfile) {
    controls.updateBenchmarkCopyStatus("not ready", latestBenchmarkReport);
    return;
  }

  if (benchmarkRunner) {
    return;
  }

  benchmarkRestoreState = {
    particleCount: latestConfig.particleCount,
    paused: latestConfig.paused,
  };
  benchmarkRunner = new BenchmarkRunner(deviceProfile, latestConfig, performance.now());
  latestConfig = {
    ...latestConfig,
    particleCount: benchmarkRunner.currentParticleCount,
    paused: false,
  };
  controls.setParticleCount(benchmarkRunner.currentParticleCount);
  controls.setPaused(false);
  controls.updateBenchmark({
    running: true,
    label: `${formatCount(benchmarkRunner.currentParticleCount)} warmup`,
    stepIndex: 0,
    stepCount: BENCHMARK_PARTICLE_COUNTS.length,
    particleCount: benchmarkRunner.currentParticleCount,
    phase: "warmup",
    phaseProgress: 0,
  });
  diagnostics.log("benchmark.started", {
    particleCounts: [...BENCHMARK_PARTICLE_COUNTS],
    baselineParticleCount: benchmarkRestoreState.particleCount,
    restoredPausedState: benchmarkRestoreState.paused,
    adapter: deviceProfile.adapter,
  });
}

function updateBenchmark(now: number, stats: ReturnType<ParticleEngine["frame"]>): void {
  if (!benchmarkRunner) {
    return;
  }

  const progress = benchmarkRunner.record(now, stats);

  if (progress.stepResult) {
    diagnostics.log("benchmark.step", {
      particleCount: progress.stepResult.particleCount,
      p50FrameMs: progress.stepResult.p50FrameMs,
      p95FrameMs: progress.stepResult.p95FrameMs,
      averageFps: progress.stepResult.averageFps,
      p95CpuSubmitMs: progress.stepResult.p95CpuSubmitMs,
      stable60Hz: progress.stepResult.stable60Hz,
    });
  }

  if (progress.running) {
    latestConfig = {
      ...latestConfig,
      particleCount: progress.particleCount,
    };
    controls.setParticleCount(progress.particleCount);
    controls.updateBenchmark(progress);
    return;
  }

  finishBenchmark(progress);
}

function finishBenchmark(progress: BenchmarkProgress): void {
  benchmarkRunner = null;
  latestBenchmarkReport = progress.report ?? null;

  if (benchmarkRestoreState) {
    latestConfig = {
      ...latestConfig,
      particleCount: benchmarkRestoreState.particleCount,
      paused: benchmarkRestoreState.paused,
    };
    controls.setParticleCount(benchmarkRestoreState.particleCount);
    controls.setPaused(benchmarkRestoreState.paused);
    benchmarkRestoreState = null;
  }

  controls.updateBenchmark(progress);

  if (latestBenchmarkReport) {
    persistBenchmarkReport(latestBenchmarkReport);
    diagnostics.log("benchmark.completed", {
      tier: latestBenchmarkReport.tier,
      maxStableParticleCount: latestBenchmarkReport.maxStableParticleCount,
      recommendedParticleCount: latestBenchmarkReport.recommendedParticleCount,
      steps: latestBenchmarkReport.steps.map((step) => ({
        particleCount: step.particleCount,
        p95FrameMs: step.p95FrameMs,
        p95CpuSubmitMs: step.p95CpuSubmitMs,
        stable60Hz: step.stable60Hz,
      })),
    });
  }
}

async function copyBenchmarkReport(): Promise<void> {
  if (!latestBenchmarkReport) {
    controls.updateBenchmarkCopyStatus("no report", null);
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(latestBenchmarkReport, null, 2));
    controls.updateBenchmarkCopyStatus("copied", latestBenchmarkReport);
    diagnostics.log("benchmark.copied", {
      tier: latestBenchmarkReport.tier,
      maxStableParticleCount: latestBenchmarkReport.maxStableParticleCount,
    });
  } catch (error) {
    controls.updateBenchmarkCopyStatus("copy failed", latestBenchmarkReport);
    diagnostics.log("benchmark.copyFailed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function persistBenchmarkReport(report: BenchmarkReport): void {
  try {
    localStorage.setItem("webgpu-particle-lab:lastBenchmark", JSON.stringify(report));
  } catch (error) {
    diagnostics.log("benchmark.persistFailed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function createDeviceProfile(webgpu: WebGpuContext): DeviceProfile {
  return {
    adapter: webgpu.adapterSummary,
    preferredFormat: webgpu.format,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    features: Array.from(webgpu.device.features).map(String).sort(),
    limits: pickDeviceLimits(webgpu.device.limits),
  };
}

function pickDeviceLimits(limits: GPUSupportedLimits): Record<string, number> {
  const picked: Record<string, number> = {};

  for (const key of DEVICE_LIMIT_KEYS) {
    const value = limits[key as keyof GPUSupportedLimits];

    if (typeof value === "number") {
      picked[key] = value;
    }
  }

  return picked;
}

function formatCount(value: number): string {
  return value >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(1))}m`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value);
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
