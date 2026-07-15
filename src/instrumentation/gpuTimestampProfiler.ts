import type { Diagnostics } from "../diagnostics";

export const GPU_PASS_IDS = [
  "compute",
  "directRender",
  "trailFade",
  "trailParticles",
  "trailComposite",
] as const;

export type GpuPassId = (typeof GPU_PASS_IDS)[number];
export type GpuRenderPath = "direct" | "trails";
export type GpuTimingAvailability = "available" | "disabled" | "unavailable";

export interface GpuFrameContext {
  particleCount: number;
  renderPath: GpuRenderPath;
  benchmarkStepId?: string;
}

export interface GpuFrameTimingSample extends GpuFrameContext {
  frameSequence: number;
  totalMs: number;
  passes: Partial<Record<GpuPassId, number>>;
}

export interface GpuPassTimingSummary {
  sampleCount: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface GpuTimingSummary extends GpuPassTimingSummary {
  supported: boolean;
  availability: GpuTimingAvailability;
  droppedFrames: number;
  passes: Partial<Record<GpuPassId, GpuPassTimingSummary>>;
}

interface ReadbackSlot {
  state: "idle" | "encoding" | "submitted" | "mapping";
  resolveBuffer: GPUBuffer;
  readbackBuffer: GPUBuffer;
  queryCount: number;
  passIds: GpuPassId[];
  context: GpuFrameContext;
  frameSequence: number;
}

export interface GpuPassTimestampWrites {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex: number;
  endOfPassWriteIndex: number;
}

const MAX_PASSES_PER_FRAME = 4;
const MAX_QUERIES_PER_FRAME = MAX_PASSES_PER_FRAME * 2;
const QUERY_BYTES_PER_FRAME = MAX_QUERIES_PER_FRAME * BigUint64Array.BYTES_PER_ELEMENT;
const READBACK_RING_SIZE = 3;

export class GpuTimestampProfiler {
  private readonly querySet: GPUQuerySet;
  private readonly slots: ReadbackSlot[];
  private readonly completedSamples: GpuFrameTimingSample[] = [];
  private frameSequence = 0;
  private droppedFrames = 0;
  private destroyed = false;

  private constructor(
    device: GPUDevice,
    private readonly diagnostics: Diagnostics,
  ) {
    this.querySet = device.createQuerySet({
      label: "frame GPU timestamp queries",
      type: "timestamp",
      count: MAX_QUERIES_PER_FRAME,
    });
    this.slots = Array.from({ length: READBACK_RING_SIZE }, (_, index) => ({
      state: "idle" as const,
      resolveBuffer: device.createBuffer({
        label: `GPU timestamp resolve ${index}`,
        size: QUERY_BYTES_PER_FRAME,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      }),
      readbackBuffer: device.createBuffer({
        label: `GPU timestamp readback ${index}`,
        size: QUERY_BYTES_PER_FRAME,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      queryCount: 0,
      passIds: [],
      context: { particleCount: 0, renderPath: "direct" as const },
      frameSequence: 0,
    }));
  }

  static async create(
    device: GPUDevice,
    diagnostics: Diagnostics,
    enabled = false,
  ): Promise<GpuTimestampProfiler | null> {
    if (!enabled) {
      diagnostics.log("gpuProfiler.disabled", {
        reason: "not requested; enable with ?gpuProfiler=on",
      });
      return null;
    }

    if (!device.features.has("timestamp-query")) {
      diagnostics.log("gpuProfiler.unavailable", { reason: "timestamp-query not enabled" });
      return null;
    }

    device.pushErrorScope("validation");
    let profiler: GpuTimestampProfiler | null = null;
    let thrownMessage: string | null = null;

    try {
      profiler = new GpuTimestampProfiler(device, diagnostics);
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }

    const scopedError = await device.popErrorScope().catch(() => null);
    const message = scopedError?.message ?? thrownMessage;

    if (message || !profiler) {
      profiler?.destroy();
      diagnostics.log("gpuProfiler.unavailable", {
        reason: message ?? "Profiler resource creation returned no result.",
      });
      return null;
    }

    diagnostics.log("gpuProfiler.ready", {
      maxPassesPerFrame: MAX_PASSES_PER_FRAME,
      readbackRingSize: READBACK_RING_SIZE,
    });
    return profiler;
  }

  beginFrame(context: GpuFrameContext): GpuFrameProfile | null {
    if (this.destroyed) {
      return null;
    }

    const slot = this.slots.find((candidate) => candidate.state === "idle");

    if (!slot) {
      this.droppedFrames += 1;
      return null;
    }

    slot.state = "encoding";
    slot.queryCount = 0;
    slot.passIds = [];
    slot.context = { ...context };
    slot.frameSequence = this.frameSequence;
    this.frameSequence += 1;
    return new GpuFrameProfile(this, slot);
  }

  drainSamples(): GpuFrameTimingSample[] {
    return this.completedSamples.splice(0);
  }

  getDroppedFrameCount(): number {
    return this.droppedFrames;
  }

  getPendingFrameCount(): number {
    return this.slots.filter((slot) => slot.state !== "idle").length;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.querySet.destroy();

    for (const slot of this.slots) {
      slot.resolveBuffer.destroy();
      slot.readbackBuffer.destroy();
    }

    this.completedSamples.length = 0;
  }

  timestampWrites(slot: ReadbackSlot, passId: GpuPassId): GpuPassTimestampWrites {
    if (slot.state !== "encoding") {
      throw new Error("GPU timestamps can only be assigned while a frame is encoding.");
    }

    if (slot.passIds.length >= MAX_PASSES_PER_FRAME) {
      throw new Error(`GPU profiler supports at most ${MAX_PASSES_PER_FRAME} passes per frame.`);
    }

    const beginningOfPassWriteIndex = slot.passIds.length * 2;
    slot.passIds.push(passId);
    slot.queryCount = slot.passIds.length * 2;

    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex,
      endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
    };
  }

  resolve(slot: ReadbackSlot, commandEncoder: GPUCommandEncoder): void {
    if (slot.state !== "encoding" || slot.queryCount === 0) {
      slot.state = "idle";
      return;
    }

    const byteLength = slot.queryCount * BigUint64Array.BYTES_PER_ELEMENT;
    commandEncoder.resolveQuerySet(this.querySet, 0, slot.queryCount, slot.resolveBuffer, 0);
    commandEncoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readbackBuffer, 0, byteLength);
    slot.state = "submitted";
  }

  afterSubmit(slot: ReadbackSlot): void {
    if (slot.state !== "submitted") {
      return;
    }

    slot.state = "mapping";
    const byteLength = slot.queryCount * BigUint64Array.BYTES_PER_ELEMENT;

    void slot.readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteLength)
      .then(() => {
        const values = new BigUint64Array(slot.readbackBuffer.getMappedRange(0, byteLength));
        const passes: Partial<Record<GpuPassId, number>> = {};
        let totalMs = 0;

        for (let index = 0; index < slot.passIds.length; index += 1) {
          const beginning = values[index * 2];
          const end = values[index * 2 + 1];
          const elapsedMs = end >= beginning ? Number(end - beginning) / 1_000_000 : 0;
          passes[slot.passIds[index]] = elapsedMs;
          totalMs += elapsedMs;
        }

        if (Number.isFinite(totalMs) && totalMs >= 0) {
          this.completedSamples.push({
            ...slot.context,
            frameSequence: slot.frameSequence,
            totalMs,
            passes,
          });
        }
      })
      .catch((error) => {
        if (!this.destroyed) {
          this.diagnostics.log("gpuProfiler.readbackFailed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (slot.readbackBuffer.mapState === "mapped") {
          slot.readbackBuffer.unmap();
        }

        slot.state = "idle";
      });
  }
}

export class GpuFrameProfile {
  constructor(
    private readonly profiler: GpuTimestampProfiler,
    private readonly slot: ReadbackSlot,
  ) {}

  timestampWrites(passId: GpuPassId): GpuPassTimestampWrites {
    return this.profiler.timestampWrites(this.slot, passId);
  }

  resolve(commandEncoder: GPUCommandEncoder): void {
    this.profiler.resolve(this.slot, commandEncoder);
  }

  afterSubmit(): void {
    this.profiler.afterSubmit(this.slot);
  }
}

export class RollingGpuTimingMetrics {
  private readonly samples: GpuFrameTimingSample[] = [];

  constructor(private readonly maxSamples = 180) {}

  record(
    newSamples: readonly GpuFrameTimingSample[],
    droppedFrames = 0,
  ): GpuTimingSummary {
    this.samples.push(...newSamples);

    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    return summarizeGpuTimings(this.samples, true, droppedFrames);
  }

  reset(): GpuTimingSummary {
    this.samples.length = 0;
    return summarizeGpuTimings(this.samples);
  }
}

export function summarizeGpuTimings(
  samples: readonly GpuFrameTimingSample[],
  supported = true,
  droppedFrames = 0,
  availability: GpuTimingAvailability = supported ? "available" : "unavailable",
): GpuTimingSummary {
  const totals = samples.map((sample) => sample.totalMs);
  const totalSummary = summarizeValues(totals);
  const passes: Partial<Record<GpuPassId, GpuPassTimingSummary>> = {};

  for (const passId of GPU_PASS_IDS) {
    const values = samples
      .map((sample) => sample.passes[passId])
      .filter((value): value is number => value !== undefined);

    if (values.length > 0) {
      passes[passId] = summarizeValues(values);
    }
  }

  return {
    supported,
    availability,
    droppedFrames,
    ...totalSummary,
    passes,
  };
}

function summarizeValues(values: readonly number[]): GpuPassTimingSummary {
  if (values.length === 0) {
    return { sampleCount: 0, averageMs: 0, p50Ms: 0, p95Ms: 0 };
  }

  return {
    sampleCount: values.length,
    averageMs: average(values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}
