import { Diagnostics, type DiagnosticPayload } from "./diagnostics";
import { initializeWebGpu, WebGpuUnavailableError, type WebGpuContext } from "./gpu/webgpu";
import {
  BenchmarkRunner,
  type BenchmarkFramePlan,
  type BenchmarkProgress,
  type BenchmarkReport,
  type DeviceProfile,
} from "./instrumentation/benchmark";
import { RollingFrameMetrics } from "./instrumentation/frameMetrics";
import {
  RollingGpuTimingMetrics,
  summarizeGpuTimings,
  type GpuFrameTimingSample,
  type GpuTimingAvailability,
  type GpuTimingSummary,
} from "./instrumentation/gpuTimestampProfiler";
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
let webgpuContext: WebGpuContext | null = null;
let animationFrame = 0;
let lastFrameTime: number | null = null;
let deviceProfile: DeviceProfile | null = null;
let benchmarkRunner: BenchmarkRunner | null = null;
let benchmarkStarting = false;
let latestBenchmarkReport: BenchmarkReport | null = null;
let gpuProfilingEnabled = false;

interface BenchmarkRestoreState {
  engine: ParticleEngine;
  config: SimulationConfig;
  pointer: PointerState;
}

let benchmarkRestoreState: BenchmarkRestoreState | null = null;
const frameMetrics = new RollingFrameMetrics();
const gpuTimingMetrics = new RollingGpuTimingMetrics();
let lastGpuDiagnosticAt = 0;

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
    if (benchmarkRunner || benchmarkStarting) {
      controls.applyConfig(latestConfig);
      return;
    }

    latestConfig = config;
    diagnostics.log(key === "debugMode" ? "debug.mode" : "control.changed", {
      key,
      value: String(config[key as keyof SimulationConfig]),
    });
  },
  onReset: () => {
    if (engine && !benchmarkRunner && !benchmarkStarting) {
      engine.reset(latestConfig);
    }
  },
  onPointerLockChanged: (locked) => {
    if (benchmarkRunner || benchmarkStarting) {
      return;
    }

    pointer.locked = locked;
    pointer.active = locked || pointer.active;
    controls.updatePointer(pointer.active, pointer.locked);
    diagnostics.log("control.changed", { key: "pointerLock", value: locked });
  },
  onGpuProfilerToggle: () => toggleGpuProfiler(),
  onBenchmarkStart: () => {
    void startBenchmark();
  },
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
    gpuProfilingEnabled =
      new URLSearchParams(window.location.search).get("gpuProfiler") === "on";
    const webgpu = await initializeWebGpu(canvas, diagnostics, gpuProfilingEnabled);
    webgpuContext = webgpu;
    deviceProfile = createDeviceProfile(webgpu);
    controls.updateStatus(webgpu.adapterSummary);
    controls.setGpuProfilerMode(gpuProfilingEnabled, webgpu.timestampQuerySupported);
    diagnostics.log("webgpu.profile", {
      adapter: deviceProfile.adapter,
      preferredFormat: deviceProfile.preferredFormat,
      features: deviceProfile.features,
      limits: deviceProfile.limits,
    });
    engine = await ParticleEngine.create(
      canvas,
      webgpu,
      diagnostics,
      latestConfig,
      gpuProfilingEnabled,
    );
    const hdrTrailsAvailable = engine.supportsTrailFormat("hdr");
    controls.setHdrTrailsAvailable(hdrTrailsAvailable);
    diagnostics.log("trails.capabilities", {
      compat: engine.supportsTrailFormat("compat"),
      hdr: hdrTrailsAvailable,
    });
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
  const activeEngine = engine;

  if (!activeEngine) {
    return;
  }

  const deltaSeconds = lastFrameTime === null ? 1 / 60 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const benchmarkFrame = benchmarkRunner?.currentFramePlan ?? null;

  if (benchmarkFrame?.resetSeed !== null && benchmarkFrame?.resetSeed !== undefined) {
    activeEngine.reset(benchmarkFrame.config, benchmarkFrame.resetSeed);
  }

  const stats = activeEngine.frame(
    now,
    deltaSeconds,
    benchmarkFrame?.config ?? latestConfig,
    benchmarkFrame?.pointer ?? pointer,
    benchmarkFrame
      ? {
          simulationNowMs: benchmarkFrame.simulationNowMs,
          simulationDeltaSeconds: benchmarkFrame.simulationDeltaSeconds,
          profileGpu: benchmarkFrame.profileGpu,
          gpuProfileTag: benchmarkFrame.stepId,
        }
      : undefined,
  );
  const gpuSamples = activeEngine.drainGpuTimingSamples();
  const gpuTimingSummary = activeEngine.gpuTimingSupported
    ? gpuTimingMetrics.record(
        gpuSamples,
        activeEngine.getDroppedGpuTimingFrames(),
      )
    : summarizeGpuTimings([], false, 0, gpuTimingAvailabilityForEngine(activeEngine));
  const metricSummary = frameMetrics.record(stats);
  controls.updateStats(stats);
  controls.updatePerformance(metricSummary);
  controls.updateGpuPerformance(gpuTimingSummary);
  updateBenchmark(stats, gpuSamples, activeEngine.getPendingGpuTimingFrames());
  diagnostics.logFrameSample(now, {
    fps: stats.fps,
    rafFrameMs: stats.rafFrameMs,
    cpuSubmitMs: stats.cpuSubmitMs,
    particleCount: stats.particleCount,
    dispatchSize: stats.dispatchSize,
    canvasWidth: stats.canvasWidth,
    canvasHeight: stats.canvasHeight,
    paused: stats.paused,
    trailTarget: toDiagnosticTrailTarget(stats.trailTarget),
    benchmarkStepId: benchmarkFrame?.stepId ?? null,
    benchmarkPhase: benchmarkFrame?.phase ?? null,
  });

  if (gpuTimingSummary.sampleCount > 0 && now - lastGpuDiagnosticAt >= 5000) {
    lastGpuDiagnosticAt = now;
    diagnostics.log("gpu.frameSample", toDiagnosticGpuSummary(gpuTimingSummary));
  }
  animationFrame = requestAnimationFrame(runFrame);
}

async function startBenchmark(): Promise<void> {
  if (!engine || !deviceProfile || !webgpuContext) {
    controls.updateBenchmarkCopyStatus("not ready", latestBenchmarkReport);
    return;
  }

  if (benchmarkRunner || benchmarkStarting) {
    return;
  }

  benchmarkStarting = true;
  controls.setBenchmarkInputLocked(true);
  const restoreState: BenchmarkRestoreState = {
    engine,
    config: { ...latestConfig },
    pointer: { ...pointer },
  };
  let benchmarkEngine: ParticleEngine | null = null;

  try {
    const initialRunner = new BenchmarkRunner(
      deviceProfile,
      gpuTimingAvailabilityForEngine(restoreState.engine),
    );
    const initialFrame = initialRunner.currentFramePlan;
    benchmarkEngine = await ParticleEngine.create(
      canvas,
      webgpuContext,
      diagnostics,
      initialFrame.config,
      gpuProfilingEnabled,
    );
    const benchmarkGpuTimingAvailability = gpuTimingAvailabilityForEngine(benchmarkEngine);
    const runner = new BenchmarkRunner(deviceProfile, benchmarkGpuTimingAvailability);
    const firstFrame = runner.currentFramePlan;
    benchmarkRestoreState = restoreState;
    benchmarkRunner = runner;
    engine = benchmarkEngine;
    lastFrameTime = null;
    frameMetrics.reset();
    gpuTimingMetrics.reset();
    controls.updateBenchmark(progressForFramePlan(firstFrame));
    diagnostics.log("benchmark.started", {
      schemaVersion: 2,
      scenarioSetVersion: 1,
      stepCount: firstFrame.stepCount,
      baselineParticleCount: restoreState.config.particleCount,
      restoredPausedState: restoreState.config.paused,
      adapter: deviceProfile.adapter,
      gpuTimingAvailability: benchmarkGpuTimingAvailability,
    });
  } catch (error) {
    if (engine === benchmarkEngine) {
      engine = restoreState.engine;
    }

    benchmarkRunner = null;
    benchmarkRestoreState = null;
    latestConfig = { ...restoreState.config };
    Object.assign(pointer, restoreState.pointer);
    benchmarkEngine?.destroy();
    lastFrameTime = null;
    frameMetrics.reset();
    gpuTimingMetrics.reset();
    controls.applyConfig(latestConfig);
    controls.updatePointer(pointer.active, pointer.locked);
    controls.setBenchmarkInputLocked(false);
    controls.updateBenchmarkCopyStatus("start failed", latestBenchmarkReport);
    diagnostics.log("benchmark.startFailed", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    benchmarkStarting = false;
  }
}

function updateBenchmark(
  stats: ReturnType<ParticleEngine["frame"]>,
  gpuSamples: readonly GpuFrameTimingSample[],
  pendingGpuFrames: number,
): void {
  if (!benchmarkRunner) {
    return;
  }

  const progress = benchmarkRunner.record(stats, gpuSamples, pendingGpuFrames);

  if (progress.stepResult) {
    diagnostics.log("benchmark.step", {
      stepId: progress.stepResult.stepId,
      scenarioId: progress.stepResult.scenarioId,
      scenarioVersion: progress.stepResult.scenarioVersion,
      seed: progress.stepResult.seed,
      particleCount: progress.stepResult.particleCount,
      sampleCount: progress.stepResult.sampleCount,
      p50FrameMs: progress.stepResult.p50FrameMs,
      p95FrameMs: progress.stepResult.p95FrameMs,
      averageFps: progress.stepResult.averageFps,
      p95CpuSubmitMs: progress.stepResult.p95CpuSubmitMs,
      stable60Hz: progress.stepResult.stable60Hz,
      renderPath: progress.stepResult.renderPath,
      canvasWidth: progress.stepResult.canvasWidth,
      canvasHeight: progress.stepResult.canvasHeight,
      resources: { ...progress.stepResult.resources },
      trailTarget: toDiagnosticTrailTarget(progress.stepResult.trailTarget),
      gpuTiming: toDiagnosticGpuSummary(progress.stepResult.gpuTiming),
    });
    frameMetrics.reset();
    gpuTimingMetrics.reset();
  }

  if (progress.running) {
    controls.updateBenchmark(progress);
    return;
  }

  finishBenchmark(progress);
}

function finishBenchmark(progress: BenchmarkProgress): void {
  const completedBenchmarkEngine = engine;
  const restoreState = benchmarkRestoreState;
  benchmarkRunner = null;
  latestBenchmarkReport = progress.report ?? null;

  if (restoreState) {
    engine = restoreState.engine;
    latestConfig = { ...restoreState.config };
    Object.assign(pointer, restoreState.pointer);
    controls.applyConfig(latestConfig);
    controls.updatePointer(pointer.active, pointer.locked);
    completedBenchmarkEngine?.destroy();
    engine.drainGpuTimingSamples();
  } else {
    completedBenchmarkEngine?.destroy();
    engine = null;
  }

  benchmarkRestoreState = null;
  lastFrameTime = null;
  frameMetrics.reset();
  gpuTimingMetrics.reset();
  controls.updateBenchmark(progress);
  controls.setBenchmarkInputLocked(false);

  if (latestBenchmarkReport) {
    persistBenchmarkReport(latestBenchmarkReport);
    diagnostics.log("benchmark.completed", {
      tier: latestBenchmarkReport.tier,
      maxStableParticleCount: latestBenchmarkReport.maxStableParticleCount,
      recommendedParticleCount: latestBenchmarkReport.recommendedParticleCount,
      steps: latestBenchmarkReport.steps.map((step) => ({
        stepId: step.stepId,
        scenarioId: step.scenarioId,
        particleCount: step.particleCount,
        p95FrameMs: step.p95FrameMs,
        p95CpuSubmitMs: step.p95CpuSubmitMs,
        stable60Hz: step.stable60Hz,
        renderPath: step.renderPath,
        resources: { ...step.resources },
        trailTarget: toDiagnosticTrailTarget(step.trailTarget),
        gpuTiming: toDiagnosticGpuSummary(step.gpuTiming),
      })),
    });
    diagnostics.log("benchmark.restored", {
      particleCount: latestConfig.particleCount,
      paused: latestConfig.paused,
      pointerActive: pointer.active,
      pointerLocked: pointer.locked,
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

function progressForFramePlan(plan: BenchmarkFramePlan): BenchmarkProgress {
  return {
    running: true,
    label: `${plan.scenarioLabel} ${formatCount(plan.config.particleCount)} ${plan.phase}`,
    stepIndex: plan.stepIndex,
    stepCount: plan.stepCount,
    particleCount: plan.config.particleCount,
    scenarioId: plan.scenarioId,
    scenarioLabel: plan.scenarioLabel,
    phase: plan.phase,
    phaseProgress: plan.phaseProgress,
  };
}

function gpuTimingAvailabilityForEngine(target: ParticleEngine): GpuTimingAvailability {
  if (target.gpuTimingSupported) {
    return "available";
  }

  if (!gpuProfilingEnabled && webgpuContext?.timestampQuerySupported) {
    return "disabled";
  }

  return "unavailable";
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

function toDiagnosticTrailTarget(
  target: ReturnType<ParticleEngine["frame"]>["trailTarget"],
): DiagnosticPayload | null {
  return target ? { ...target } : null;
}

function toDiagnosticGpuSummary(summary: GpuTimingSummary): DiagnosticPayload {
  const passes: DiagnosticPayload = {};

  for (const [passId, timing] of Object.entries(summary.passes)) {
    if (timing) {
      passes[passId] = { ...timing };
    }
  }

  return {
    supported: summary.supported,
    availability: summary.availability,
    sampleCount: summary.sampleCount,
    averageMs: Number(summary.averageMs.toFixed(4)),
    p50Ms: Number(summary.p50Ms.toFixed(4)),
    p95Ms: Number(summary.p95Ms.toFixed(4)),
    droppedFrames: summary.droppedFrames,
    passes,
  };
}

function toggleGpuProfiler(): void {
  const url = new URL(window.location.href);

  if (url.searchParams.get("gpuProfiler") === "on") {
    url.searchParams.delete("gpuProfiler");
  } else {
    url.searchParams.set("gpuProfiler", "on");
  }

  window.location.assign(url);
}

function installPointerInput(): void {
  canvas.addEventListener("pointermove", (event) => {
    if (benchmarkRunner || benchmarkStarting) {
      return;
    }

    updatePointerPosition(event);
    pointer.active = true;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (benchmarkRunner || benchmarkStarting) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    updatePointerPosition(event);
    pointer.active = true;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (benchmarkRunner || benchmarkStarting) {
      return;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    pointer.active = pointer.locked;
    controls.updatePointer(pointer.active, pointer.locked);
  });

  canvas.addEventListener("pointerleave", () => {
    if (benchmarkRunner || benchmarkStarting) {
      return;
    }

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

  if (benchmarkRestoreState?.engine !== engine) {
    benchmarkRestoreState?.engine.destroy();
  }
});
