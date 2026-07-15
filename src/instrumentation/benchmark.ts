import { summarizeFrameSamples, type FrameMetricSummary } from "./frameMetrics";
import {
  summarizeGpuTimings,
  type GpuFrameTimingSample,
  type GpuRenderPath,
  type GpuTimingAvailability,
  type GpuTimingSummary,
} from "./gpuTimestampProfiler";
import {
  DEFAULT_CONFIG,
  PARTICLE_STRIDE_BYTES,
  type FrameStats,
  type PointerState,
  type SimulationConfig,
  type TrailResolutionScale,
  type TrailTargetInfo,
} from "../particles/types";

export const BENCHMARK_PARTICLE_COUNTS = [
  16_384,
  65_536,
  262_144,
  524_288,
  1_048_576,
] as const;

export const BENCHMARK_WARMUP_FRAMES = 30;
export const BENCHMARK_SAMPLE_FRAMES = 120;
export const BENCHMARK_SIMULATION_STEP_SECONDS = 1 / 60;
export const BENCHMARK_SCENARIO_SET_VERSION = 1;

const MAX_GPU_SETTLE_FRAMES = 60;
const STABLE_P95_60HZ_MS = 18.5;
const STABLE_OVER_BUDGET_RATIO = 0.08;

export type BenchmarkScenarioId = "direct" | "trails" | "stress";
export type BenchmarkPhase = "warmup" | "sample" | "settle" | "complete";

export interface BenchmarkPathDescriptor {
  id: string;
  version: 1;
}

export interface BenchmarkScenario {
  id: BenchmarkScenarioId;
  label: string;
  version: 1;
  seed: number;
  renderPath: GpuRenderPath;
  particleCounts: readonly number[];
  config: Readonly<SimulationConfig>;
  pointerPath: BenchmarkPathDescriptor;
  cameraPath: BenchmarkPathDescriptor;
}

const DIRECT_SCENARIO: BenchmarkScenario = Object.freeze({
  id: "direct",
  label: "Direct",
  version: 1,
  seed: 0x10d1ec7,
  renderPath: "direct",
  particleCounts: BENCHMARK_PARTICLE_COUNTS,
  config: Object.freeze({
    ...DEFAULT_CONFIG,
    paused: false,
    cameraSpin: 0.12,
    gridOpacity: 0.36,
    trailOpacity: 0,
    trailFormatMode: "compat",
    trailResolutionScale: 1,
    pointerMode: "orbit",
    debugMode: "beauty",
  }),
  pointerPath: Object.freeze({ id: "inactive", version: 1 }),
  cameraPath: Object.freeze({ id: "fixed-spin", version: 1 }),
});

const TRAILS_SCENARIO: BenchmarkScenario = Object.freeze({
  id: "trails",
  label: "Trails",
  version: 1,
  seed: 0x7a115eed,
  renderPath: "trails",
  particleCounts: BENCHMARK_PARTICLE_COUNTS,
  config: Object.freeze({
    ...DEFAULT_CONFIG,
    paused: false,
    trailOpacity: 0.72,
    trailDecay: 0.965,
    trailExposure: 1,
    trailFormatMode: "compat",
    trailResolutionScale: 1,
    pointerMode: "orbit",
    debugMode: "beauty",
  }),
  pointerPath: Object.freeze({ id: "orbit-loop", version: 1 }),
  cameraPath: Object.freeze({ id: "fixed-spin", version: 1 }),
});

const STRESS_SCENARIO: BenchmarkScenario = Object.freeze({
  id: "stress",
  label: "Stress",
  version: 1,
  seed: 0x57e551ed,
  renderPath: "trails",
  particleCounts: BENCHMARK_PARTICLE_COUNTS,
  config: Object.freeze({
    ...DEFAULT_CONFIG,
    paused: false,
    speed: 1.6,
    damping: 0.97,
    strength: 3.4,
    radius: 0.95,
    turbulence: 0.75,
    diffusion: 0.035,
    depth: 2,
    cameraSpin: 0.36,
    perspective: 1.7,
    gridOpacity: 0.32,
    trailOpacity: 0.92,
    trailDecay: 0.987,
    trailExposure: 1.35,
    trailFormatMode: "compat",
    trailResolutionScale: 1,
    noiseScale: 4.4,
    flowSpeed: 0.55,
    pointerMode: "orbit",
    debugMode: "beauty",
    particleSize: 2.6,
  }),
  pointerPath: Object.freeze({ id: "figure-eight", version: 1 }),
  cameraPath: Object.freeze({ id: "fixed-spin", version: 1 }),
});

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = Object.freeze([
  DIRECT_SCENARIO,
  TRAILS_SCENARIO,
  STRESS_SCENARIO,
]);

export interface DeviceProfile {
  adapter: string;
  preferredFormat: string;
  userAgent: string;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  features: string[];
  limits: Record<string, number>;
}

export interface BenchmarkResourceEstimate {
  particleStorageBytes: number;
  trailTargetBytes: number;
  estimatedTotalBytes: number;
}

export interface BenchmarkStepResult {
  stepId: string;
  scenarioId: BenchmarkScenarioId;
  scenarioLabel: string;
  scenarioVersion: 1;
  seed: number;
  particleCount: number;
  config: SimulationConfig;
  pointerPath: BenchmarkPathDescriptor;
  cameraPath: BenchmarkPathDescriptor;
  renderPath: GpuRenderPath;
  canvasWidth: number;
  canvasHeight: number;
  targetFormat: GPUTextureFormat | null;
  targetScale: TrailResolutionScale | null;
  trailTarget: TrailTargetInfo | null;
  resources: BenchmarkResourceEstimate;
  warmupFrames: number;
  requestedSampleFrames: number;
  sampleCount: number;
  sampleWallDurationMs: number;
  averageFps: number;
  averageFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  averageCpuSubmitMs: number;
  p95CpuSubmitMs: number;
  over60HzBudgetRatio: number;
  stable60Hz: boolean;
  gpuTiming: GpuTimingSummary;
}

export interface BenchmarkScenarioSummary {
  scenarioId: BenchmarkScenarioId;
  scenarioVersion: 1;
  maxStableParticleCount: number;
  recommendedParticleCount: number;
  tier: string;
}

export interface BenchmarkReport {
  schemaVersion: 2;
  scenarioSetVersion: 1;
  app: "webgpu-particle-lab";
  startedAt: string;
  completedAt: string;
  timing: {
    warmupFrames: number;
    sampleFrames: number;
    simulationStepSeconds: number;
  };
  device: DeviceProfile;
  gpuTiming: {
    supported: boolean;
    availability: GpuTimingAvailability;
  };
  scenarios: BenchmarkScenario[];
  steps: BenchmarkStepResult[];
  scenarioSummaries: BenchmarkScenarioSummary[];
  maxStableParticleCount: number;
  recommendedParticleCount: number;
  tier: string;
}

export interface BenchmarkProgress {
  running: boolean;
  label: string;
  stepIndex: number;
  stepCount: number;
  particleCount: number;
  scenarioId: BenchmarkScenarioId;
  scenarioLabel: string;
  phase: BenchmarkPhase;
  phaseProgress: number;
  report?: BenchmarkReport;
  stepResult?: BenchmarkStepResult;
}

export interface BenchmarkFramePlan {
  stepId: string;
  stepIndex: number;
  stepCount: number;
  scenarioId: BenchmarkScenarioId;
  scenarioLabel: string;
  scenarioVersion: 1;
  scenarioSeed: number;
  renderPath: GpuRenderPath;
  config: SimulationConfig;
  pointer: PointerState;
  simulationNowMs: number;
  simulationDeltaSeconds: number;
  phase: Exclude<BenchmarkPhase, "complete">;
  phaseProgress: number;
  resetSeed: number | null;
  profileGpu: boolean;
}

interface BenchmarkSample {
  rafFrameMs: number;
  cpuSubmitMs: number;
}

interface BenchmarkStepDefinition {
  scenario: BenchmarkScenario;
  particleCount: number;
}

export class BenchmarkRunner {
  private readonly startedAt = new Date().toISOString();
  private readonly steps: BenchmarkStepDefinition[] = BENCHMARK_SCENARIOS.flatMap((scenario) =>
    scenario.particleCounts.map((particleCount) => ({ scenario, particleCount })),
  );
  private readonly results: BenchmarkStepResult[] = [];
  private stepIndex = 0;
  private frameIndex = 0;
  private settleFrames = 0;
  private samples: BenchmarkSample[] = [];
  private gpuSamples: GpuFrameTimingSample[] = [];
  private currentTrailTarget: TrailTargetInfo | null = null;
  private currentCanvasWidth = 0;
  private currentCanvasHeight = 0;

  constructor(
    private readonly device: DeviceProfile,
    private readonly gpuTimingAvailability: GpuTimingAvailability,
  ) {}

  get currentFramePlan(): BenchmarkFramePlan {
    const step = this.currentStep;
    const phase = this.currentPhase;
    const simulationFrame = this.frameIndex + this.settleFrames;
    const simulationNowMs = simulationFrame * BENCHMARK_SIMULATION_STEP_SECONDS * 1000;

    return {
      stepId: this.currentStepId,
      stepIndex: this.stepIndex,
      stepCount: this.steps.length,
      scenarioId: step.scenario.id,
      scenarioLabel: step.scenario.label,
      scenarioVersion: step.scenario.version,
      scenarioSeed: step.scenario.seed,
      renderPath: step.scenario.renderPath,
      config: this.currentConfig,
      pointer: pointerForScenario(step.scenario.id, simulationNowMs / 1000),
      simulationNowMs,
      simulationDeltaSeconds: BENCHMARK_SIMULATION_STEP_SECONDS,
      phase,
      phaseProgress: this.phaseProgress(phase),
      resetSeed: this.frameIndex === 0 ? step.scenario.seed : null,
      profileGpu: phase === "sample" && this.gpuTimingAvailability === "available",
    };
  }

  record(
    stats: FrameStats,
    gpuSamples: readonly GpuFrameTimingSample[],
    pendingGpuFrames: number,
  ): BenchmarkProgress {
    const plan = this.currentFramePlan;

    this.gpuSamples.push(
      ...gpuSamples.filter((sample) => sample.benchmarkStepId === this.currentStepId),
    );

    if (plan.phase === "sample" && stats.particleCount === this.currentStep.particleCount) {
      this.samples.push({
        rafFrameMs: stats.rafFrameMs,
        cpuSubmitMs: stats.cpuSubmitMs,
      });
      this.currentTrailTarget = stats.trailTarget ? { ...stats.trailTarget } : null;
      this.currentCanvasWidth = stats.canvasWidth;
      this.currentCanvasHeight = stats.canvasHeight;
    }

    if (plan.phase === "warmup" || plan.phase === "sample") {
      this.frameIndex += 1;
    } else {
      this.settleFrames += 1;
    }

    if (!this.stepIsComplete(pendingGpuFrames)) {
      return this.createProgress();
    }

    const stepResult = this.finishStep();

    if (this.stepIndex >= this.steps.length - 1) {
      const report = this.createReport();
      return {
        running: false,
        label: "complete",
        stepIndex: this.stepIndex,
        stepCount: this.steps.length,
        particleCount: this.currentStep.particleCount,
        scenarioId: this.currentStep.scenario.id,
        scenarioLabel: this.currentStep.scenario.label,
        phase: "complete",
        phaseProgress: 1,
        report,
        stepResult,
      };
    }

    this.beginStep(this.stepIndex + 1);
    return { ...this.createProgress(), stepResult };
  }

  private get currentStep(): BenchmarkStepDefinition {
    return this.steps[this.stepIndex];
  }

  private get currentStepId(): string {
    const step = this.currentStep;
    return `${step.scenario.id}:v${step.scenario.version}:${step.particleCount}`;
  }

  private get currentConfig(): SimulationConfig {
    return {
      ...this.currentStep.scenario.config,
      particleCount: this.currentStep.particleCount,
      paused: false,
    };
  }

  private get currentPhase(): Exclude<BenchmarkPhase, "complete"> {
    if (this.frameIndex < BENCHMARK_WARMUP_FRAMES) {
      return "warmup";
    }

    if (this.frameIndex < BENCHMARK_WARMUP_FRAMES + BENCHMARK_SAMPLE_FRAMES) {
      return "sample";
    }

    return "settle";
  }

  private phaseProgress(phase: Exclude<BenchmarkPhase, "complete">): number {
    if (phase === "warmup") {
      return clamp01(this.frameIndex / BENCHMARK_WARMUP_FRAMES);
    }

    if (phase === "sample") {
      return clamp01(
        (this.frameIndex - BENCHMARK_WARMUP_FRAMES) / BENCHMARK_SAMPLE_FRAMES,
      );
    }

    return clamp01(this.settleFrames / Math.max(1, MAX_GPU_SETTLE_FRAMES));
  }

  private stepIsComplete(pendingGpuFrames: number): boolean {
    if (this.frameIndex < BENCHMARK_WARMUP_FRAMES + BENCHMARK_SAMPLE_FRAMES) {
      return false;
    }

    if (this.gpuTimingAvailability !== "available") {
      return true;
    }

    return pendingGpuFrames === 0 || this.settleFrames >= MAX_GPU_SETTLE_FRAMES;
  }

  private beginStep(stepIndex: number): void {
    this.stepIndex = stepIndex;
    this.frameIndex = 0;
    this.settleFrames = 0;
    this.samples = [];
    this.gpuSamples = [];
    this.currentTrailTarget = null;
    this.currentCanvasWidth = 0;
    this.currentCanvasHeight = 0;
  }

  private finishStep(): BenchmarkStepResult {
    const summary = summarizeFrameSamples(this.samples);
    const step = this.currentStep;
    const gpuTimingSupported = this.gpuTimingAvailability === "available";
    const missingGpuSamples = gpuTimingSupported
      ? Math.max(0, BENCHMARK_SAMPLE_FRAMES - this.gpuSamples.length)
      : 0;
    const gpuTiming = summarizeGpuTimings(
      this.gpuSamples,
      gpuTimingSupported,
      missingGpuSamples,
      this.gpuTimingAvailability,
    );
    const result = createStepResult(
      this.currentStepId,
      step,
      this.currentConfig,
      summary,
      this.samples,
      this.currentCanvasWidth,
      this.currentCanvasHeight,
      this.currentTrailTarget,
      gpuTiming,
    );
    this.results.push(result);
    return result;
  }

  private createProgress(): BenchmarkProgress {
    const plan = this.currentFramePlan;
    return {
      running: true,
      label: `${plan.scenarioLabel} ${formatParticleCount(plan.config.particleCount)} ${plan.phase}`,
      stepIndex: plan.stepIndex,
      stepCount: plan.stepCount,
      particleCount: plan.config.particleCount,
      scenarioId: plan.scenarioId,
      scenarioLabel: plan.scenarioLabel,
      phase: plan.phase,
      phaseProgress: plan.phaseProgress,
    };
  }

  private createReport(): BenchmarkReport {
    const scenarioSummaries = BENCHMARK_SCENARIOS.map((scenario) =>
      summarizeScenario(scenario, this.results),
    );
    const maxStableParticleCount = scenarioSummaries.reduce(
      (minimum, summary) => Math.min(minimum, summary.maxStableParticleCount),
      Number.POSITIVE_INFINITY,
    );
    const normalizedMaxStable = Number.isFinite(maxStableParticleCount)
      ? maxStableParticleCount
      : 0;
    const recommendedParticleCount = scenarioSummaries.reduce(
      (minimum, summary) => Math.min(minimum, summary.recommendedParticleCount),
      Number.POSITIVE_INFINITY,
    );
    const normalizedRecommendation = Number.isFinite(recommendedParticleCount)
      ? recommendedParticleCount
      : BENCHMARK_PARTICLE_COUNTS[0];

    return {
      schemaVersion: 2,
      scenarioSetVersion: BENCHMARK_SCENARIO_SET_VERSION,
      app: "webgpu-particle-lab",
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      timing: {
        warmupFrames: BENCHMARK_WARMUP_FRAMES,
        sampleFrames: BENCHMARK_SAMPLE_FRAMES,
        simulationStepSeconds: BENCHMARK_SIMULATION_STEP_SECONDS,
      },
      device: cloneDeviceProfile(this.device),
      gpuTiming: {
        supported: this.gpuTimingAvailability === "available",
        availability: this.gpuTimingAvailability,
      },
      scenarios: BENCHMARK_SCENARIOS.map(cloneScenario),
      steps: [...this.results],
      scenarioSummaries,
      maxStableParticleCount: normalizedMaxStable,
      recommendedParticleCount: normalizedRecommendation,
      tier: tierForParticleCount(normalizedMaxStable),
    };
  }
}

function createStepResult(
  stepId: string,
  step: BenchmarkStepDefinition,
  config: SimulationConfig,
  summary: FrameMetricSummary,
  samples: readonly BenchmarkSample[],
  canvasWidth: number,
  canvasHeight: number,
  trailTarget: TrailTargetInfo | null,
  gpuTiming: GpuTimingSummary,
): BenchmarkStepResult {
  const stable60Hz =
    summary.sampleCount === BENCHMARK_SAMPLE_FRAMES
    && summary.p95FrameMs <= STABLE_P95_60HZ_MS
    && summary.over60HzBudgetRatio <= STABLE_OVER_BUDGET_RATIO;
  const particleStorageBytes = config.particleCount * PARTICLE_STRIDE_BYTES * 2;
  const trailTargetBytes = trailTarget?.estimatedBytes ?? 0;

  return {
    stepId,
    scenarioId: step.scenario.id,
    scenarioLabel: step.scenario.label,
    scenarioVersion: step.scenario.version,
    seed: step.scenario.seed,
    particleCount: step.particleCount,
    config: { ...config },
    pointerPath: { ...step.scenario.pointerPath },
    cameraPath: { ...step.scenario.cameraPath },
    renderPath: step.scenario.renderPath,
    canvasWidth,
    canvasHeight,
    targetFormat: trailTarget?.format ?? null,
    targetScale: trailTarget?.scale ?? null,
    trailTarget: trailTarget ? { ...trailTarget } : null,
    resources: {
      particleStorageBytes,
      trailTargetBytes,
      estimatedTotalBytes: particleStorageBytes + trailTargetBytes,
    },
    warmupFrames: BENCHMARK_WARMUP_FRAMES,
    requestedSampleFrames: BENCHMARK_SAMPLE_FRAMES,
    sampleCount: summary.sampleCount,
    sampleWallDurationMs: Number(
      samples.reduce((total, sample) => total + sample.rafFrameMs, 0).toFixed(2),
    ),
    averageFps: Number(summary.estimatedFps.toFixed(1)),
    averageFrameMs: Number(summary.averageFrameMs.toFixed(2)),
    p50FrameMs: Number(summary.p50FrameMs.toFixed(2)),
    p95FrameMs: Number(summary.p95FrameMs.toFixed(2)),
    maxFrameMs: Number(summary.maxFrameMs.toFixed(2)),
    averageCpuSubmitMs: Number(summary.averageCpuSubmitMs.toFixed(3)),
    p95CpuSubmitMs: Number(summary.p95CpuSubmitMs.toFixed(3)),
    over60HzBudgetRatio: Number(summary.over60HzBudgetRatio.toFixed(3)),
    stable60Hz,
    gpuTiming,
  };
}

function pointerForScenario(id: BenchmarkScenarioId, timeSeconds: number): PointerState {
  if (id === "direct") {
    return { x: 0, y: 0, active: false, locked: false };
  }

  if (id === "trails") {
    return {
      x: Math.cos(timeSeconds * 0.9) * 0.58,
      y: Math.sin(timeSeconds * 1.1) * 0.36,
      active: true,
      locked: false,
    };
  }

  return {
    x: Math.sin(timeSeconds * 0.85) * 0.72,
    y: Math.sin(timeSeconds * 1.7) * 0.52,
    active: true,
    locked: false,
  };
}

function summarizeScenario(
  scenario: BenchmarkScenario,
  results: readonly BenchmarkStepResult[],
): BenchmarkScenarioSummary {
  const scenarioResults = results.filter((result) => result.scenarioId === scenario.id);
  const maxStableParticleCount = scenarioResults.reduce(
    (max, result) => result.stable60Hz ? Math.max(max, result.particleCount) : max,
    0,
  );
  const recommendedParticleCount = maxStableParticleCount > 0
    ? maxStableParticleCount
    : scenario.particleCounts[0] ?? BENCHMARK_PARTICLE_COUNTS[0];

  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    maxStableParticleCount,
    recommendedParticleCount,
    tier: tierForParticleCount(maxStableParticleCount),
  };
}

function cloneScenario(scenario: BenchmarkScenario): BenchmarkScenario {
  return {
    ...scenario,
    particleCounts: [...scenario.particleCounts],
    config: { ...scenario.config },
    pointerPath: { ...scenario.pointerPath },
    cameraPath: { ...scenario.cameraPath },
  };
}

function cloneDeviceProfile(profile: DeviceProfile): DeviceProfile {
  return {
    ...profile,
    features: [...profile.features],
    limits: { ...profile.limits },
  };
}

function tierForParticleCount(particleCount: number): string {
  if (particleCount >= 1_048_576) {
    return "ultra";
  }

  if (particleCount >= 524_288) {
    return "high";
  }

  if (particleCount >= 262_144) {
    return "standard";
  }

  if (particleCount >= 65_536) {
    return "light";
  }

  return "fallback";
}

function formatParticleCount(value: number): string {
  return value >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(1))}m`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}
