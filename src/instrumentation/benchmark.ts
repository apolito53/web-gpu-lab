import { summarizeFrameSamples, type FrameMetricSummary } from "./frameMetrics";
import type { FrameStats, SimulationConfig, TrailTargetInfo } from "../particles/types";

export const BENCHMARK_PARTICLE_COUNTS = [
  16_384,
  65_536,
  262_144,
  524_288,
  1_048_576,
] as const;

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

export interface BenchmarkStepResult {
  particleCount: number;
  durationMs: number;
  sampleCount: number;
  averageFps: number;
  averageFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  averageCpuSubmitMs: number;
  p95CpuSubmitMs: number;
  over60HzBudgetRatio: number;
  stable60Hz: boolean;
  trailTarget: TrailTargetInfo | null;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  app: "webgpu-particle-lab";
  startedAt: string;
  completedAt: string;
  warmupMs: number;
  sampleMs: number;
  device: DeviceProfile;
  baselineConfig: Pick<
    SimulationConfig,
    | "speed"
    | "damping"
    | "strength"
    | "radius"
    | "turbulence"
    | "diffusion"
    | "depth"
    | "cameraSpin"
    | "perspective"
    | "gridOpacity"
    | "trailOpacity"
    | "trailDecay"
    | "trailExposure"
    | "trailFormatMode"
    | "trailResolutionScale"
    | "particleSize"
    | "pointerMode"
    | "debugMode"
  >;
  steps: BenchmarkStepResult[];
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
  phase: "warmup" | "sample" | "complete";
  phaseProgress: number;
  report?: BenchmarkReport;
  stepResult?: BenchmarkStepResult;
}

interface BenchmarkSample {
  rafFrameMs: number;
  cpuSubmitMs: number;
}

const BENCHMARK_WARMUP_MS = 650;
const BENCHMARK_SAMPLE_MS = 2200;
const STABLE_P95_60HZ_MS = 18.5;
const STABLE_OVER_BUDGET_RATIO = 0.08;

export class BenchmarkRunner {
  private readonly startedAt = new Date().toISOString();
  private readonly steps = [...BENCHMARK_PARTICLE_COUNTS];
  private readonly results: BenchmarkStepResult[] = [];
  private readonly baselineConfig: BenchmarkReport["baselineConfig"];
  private stepIndex = 0;
  private stepStartedAt = 0;
  private samples: BenchmarkSample[] = [];
  private currentTrailTarget: TrailTargetInfo | null = null;

  constructor(
    private readonly device: DeviceProfile,
    baselineConfig: SimulationConfig,
    now: number,
  ) {
    this.baselineConfig = {
      speed: baselineConfig.speed,
      damping: baselineConfig.damping,
      strength: baselineConfig.strength,
      radius: baselineConfig.radius,
      turbulence: baselineConfig.turbulence,
      diffusion: baselineConfig.diffusion,
      depth: baselineConfig.depth,
      cameraSpin: baselineConfig.cameraSpin,
      perspective: baselineConfig.perspective,
      gridOpacity: baselineConfig.gridOpacity,
      trailOpacity: baselineConfig.trailOpacity,
      trailDecay: baselineConfig.trailDecay,
      trailExposure: baselineConfig.trailExposure,
      trailFormatMode: baselineConfig.trailFormatMode,
      trailResolutionScale: baselineConfig.trailResolutionScale,
      particleSize: baselineConfig.particleSize,
      pointerMode: baselineConfig.pointerMode,
      debugMode: baselineConfig.debugMode,
    };
    this.beginStep(0, now);
  }

  get currentParticleCount(): number {
    return this.steps[this.stepIndex];
  }

  record(now: number, stats: FrameStats): BenchmarkProgress {
    const elapsedMs = now - this.stepStartedAt;
    const phase = elapsedMs < BENCHMARK_WARMUP_MS ? "warmup" : "sample";
    const phaseElapsedMs = phase === "warmup" ? elapsedMs : elapsedMs - BENCHMARK_WARMUP_MS;
    const phaseDurationMs = phase === "warmup" ? BENCHMARK_WARMUP_MS : BENCHMARK_SAMPLE_MS;

    if (phase === "sample" && stats.particleCount === this.currentParticleCount) {
      this.samples.push({
        rafFrameMs: stats.rafFrameMs,
        cpuSubmitMs: stats.cpuSubmitMs,
      });
      this.currentTrailTarget = stats.trailTarget ? { ...stats.trailTarget } : null;
    }

    if (elapsedMs < BENCHMARK_WARMUP_MS + BENCHMARK_SAMPLE_MS) {
      return {
        running: true,
        label: this.describeProgress(phase),
        stepIndex: this.stepIndex,
        stepCount: this.steps.length,
        particleCount: this.currentParticleCount,
        phase,
        phaseProgress: clamp01(phaseElapsedMs / phaseDurationMs),
      };
    }

    const stepResult = this.finishStep();

    if (this.stepIndex >= this.steps.length - 1) {
      const report = this.createReport();
      return {
        running: false,
        label: `${formatParticleCount(report.maxStableParticleCount)} stable`,
        stepIndex: this.stepIndex,
        stepCount: this.steps.length,
        particleCount: this.currentParticleCount,
        phase: "complete",
        phaseProgress: 1,
        report,
        stepResult,
      };
    }

    this.beginStep(this.stepIndex + 1, now);

    return {
      running: true,
      label: this.describeProgress("warmup"),
      stepIndex: this.stepIndex,
      stepCount: this.steps.length,
      particleCount: this.currentParticleCount,
      phase: "warmup",
      phaseProgress: 0,
      stepResult,
    };
  }

  private beginStep(stepIndex: number, now: number): void {
    this.stepIndex = stepIndex;
    this.stepStartedAt = now;
    this.samples = [];
    this.currentTrailTarget = null;
  }

  private finishStep(): BenchmarkStepResult {
    const summary = summarizeFrameSamples(this.samples);
    const particleCount = this.currentParticleCount;
    const result = createStepResult(particleCount, summary, this.currentTrailTarget);
    this.results.push(result);
    return result;
  }

  private createReport(): BenchmarkReport {
    const maxStableParticleCount = this.results.reduce(
      (max, result) => result.stable60Hz ? Math.max(max, result.particleCount) : max,
      0,
    );
    const recommendedParticleCount =
      maxStableParticleCount > 0 ? maxStableParticleCount : this.results[0]?.particleCount ?? 0;

    return {
      schemaVersion: 1,
      app: "webgpu-particle-lab",
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      warmupMs: BENCHMARK_WARMUP_MS,
      sampleMs: BENCHMARK_SAMPLE_MS,
      device: this.device,
      baselineConfig: this.baselineConfig,
      steps: [...this.results],
      maxStableParticleCount,
      recommendedParticleCount,
      tier: tierForParticleCount(maxStableParticleCount),
    };
  }

  private describeProgress(phase: BenchmarkProgress["phase"]): string {
    return `${formatParticleCount(this.currentParticleCount)} ${phase}`;
  }
}

function createStepResult(
  particleCount: number,
  summary: FrameMetricSummary,
  trailTarget: TrailTargetInfo | null,
): BenchmarkStepResult {
  const stable60Hz =
    summary.sampleCount > 0
    && summary.p95FrameMs <= STABLE_P95_60HZ_MS
    && summary.over60HzBudgetRatio <= STABLE_OVER_BUDGET_RATIO;

  return {
    particleCount,
    durationMs: BENCHMARK_SAMPLE_MS,
    sampleCount: summary.sampleCount,
    averageFps: Number(summary.estimatedFps.toFixed(1)),
    averageFrameMs: Number(summary.averageFrameMs.toFixed(2)),
    p50FrameMs: Number(summary.p50FrameMs.toFixed(2)),
    p95FrameMs: Number(summary.p95FrameMs.toFixed(2)),
    maxFrameMs: Number(summary.maxFrameMs.toFixed(2)),
    averageCpuSubmitMs: Number(summary.averageCpuSubmitMs.toFixed(3)),
    p95CpuSubmitMs: Number(summary.p95CpuSubmitMs.toFixed(3)),
    over60HzBudgetRatio: Number(summary.over60HzBudgetRatio.toFixed(3)),
    stable60Hz,
    trailTarget,
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
