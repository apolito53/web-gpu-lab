export const WORKGROUP_SIZE = 256;
export const PARTICLE_FLOATS = 12;
export const PARTICLE_STRIDE_BYTES = PARTICLE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const SIM_UNIFORM_FLOATS = 20;
export const RENDER_UNIFORM_FLOATS = 20;
export const GRID_VERTEX_COUNT = 82;
export const TRAIL_FORMAT: GPUTextureFormat = "rgba8unorm";
export const PARTICLE_COUNTS = [16_384, 65_536, 262_144] as const;

export type PointerMode = "attract" | "repel" | "orbit";
export type DebugMode = "beauty" | "velocity" | "density";

export interface SimulationConfig {
  particleCount: number;
  paused: boolean;
  speed: number;
  damping: number;
  strength: number;
  radius: number;
  turbulence: number;
  diffusion: number;
  depth: number;
  cameraSpin: number;
  perspective: number;
  gridOpacity: number;
  trailOpacity: number;
  trailDecay: number;
  noiseScale: number;
  flowSpeed: number;
  pointerMode: PointerMode;
  debugMode: DebugMode;
  particleSize: number;
}

export interface PointerState {
  x: number;
  y: number;
  active: boolean;
  locked: boolean;
}

export interface FrameStats {
  fps: number;
  rafFrameMs: number;
  cpuSubmitMs: number;
  particleCount: number;
  dispatchSize: number;
  canvasWidth: number;
  canvasHeight: number;
  pointerMode: PointerMode;
  debugMode: DebugMode;
  paused: boolean;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  particleCount: PARTICLE_COUNTS[1],
  paused: false,
  speed: 0.75,
  damping: 0.982,
  strength: 1.25,
  radius: 0.42,
  turbulence: 0.18,
  diffusion: 0.018,
  depth: 1.35,
  cameraSpin: 0.16,
  perspective: 1.35,
  gridOpacity: 0.42,
  trailOpacity: 0.72,
  trailDecay: 0.965,
  noiseScale: 3.2,
  flowSpeed: 0.28,
  pointerMode: "orbit",
  debugMode: "beauty",
  particleSize: 3.2,
};

export function pointerModeIndex(mode: PointerMode): number {
  switch (mode) {
    case "attract":
      return 0;
    case "repel":
      return 1;
    case "orbit":
      return 2;
  }
}

export function debugModeIndex(mode: DebugMode): number {
  switch (mode) {
    case "beauty":
      return 0;
    case "velocity":
      return 1;
    case "density":
      return 2;
  }
}
