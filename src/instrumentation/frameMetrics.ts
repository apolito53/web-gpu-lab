import type { FrameStats } from "../particles/types";

export interface FrameMetricSummary {
  sampleCount: number;
  averageFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  averageCpuSubmitMs: number;
  p95CpuSubmitMs: number;
  estimatedFps: number;
  over60HzBudgetRatio: number;
}

interface FrameSample {
  rafFrameMs: number;
  cpuSubmitMs: number;
}

const SIXTY_HZ_BUDGET_MS = 1000 / 60;
const BUDGET_GRACE_MULTIPLIER = 1.15;

export class RollingFrameMetrics {
  private readonly samples: FrameSample[] = [];

  constructor(private readonly maxSamples = 180) {}

  record(stats: FrameStats): FrameMetricSummary {
    this.samples.push({
      rafFrameMs: stats.rafFrameMs,
      cpuSubmitMs: stats.cpuSubmitMs,
    });

    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    return summarizeFrameSamples(this.samples);
  }
}

export function summarizeFrameSamples(samples: readonly FrameSample[]): FrameMetricSummary {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      averageFrameMs: 0,
      p50FrameMs: 0,
      p95FrameMs: 0,
      maxFrameMs: 0,
      averageCpuSubmitMs: 0,
      p95CpuSubmitMs: 0,
      estimatedFps: 0,
      over60HzBudgetRatio: 0,
    };
  }

  const rafFrameMs = samples.map((sample) => sample.rafFrameMs);
  const cpuSubmitMs = samples.map((sample) => sample.cpuSubmitMs);
  const averageFrameMs = average(rafFrameMs);
  const overBudgetFrames = rafFrameMs.filter(
    (frameMs) => frameMs > SIXTY_HZ_BUDGET_MS * BUDGET_GRACE_MULTIPLIER,
  ).length;

  return {
    sampleCount: samples.length,
    averageFrameMs,
    p50FrameMs: percentile(rafFrameMs, 0.5),
    p95FrameMs: percentile(rafFrameMs, 0.95),
    maxFrameMs: Math.max(...rafFrameMs),
    averageCpuSubmitMs: average(cpuSubmitMs),
    p95CpuSubmitMs: percentile(cpuSubmitMs, 0.95),
    estimatedFps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
    over60HzBudgetRatio: overBudgetFrames / samples.length,
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}
