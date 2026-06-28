import type { ParticleLayouts } from "./pipelines";
import {
  PARTICLE_FLOATS,
  RENDER_UNIFORM_FLOATS,
  SIM_UNIFORM_FLOATS,
} from "./types";

export interface ParticleResources {
  particleCount: number;
  particleBuffers: [GPUBuffer, GPUBuffer];
  simUniformBuffer: GPUBuffer;
  renderUniformBuffer: GPUBuffer;
  computeBindGroups: [GPUBindGroup, GPUBindGroup];
  renderBindGroups: [GPUBindGroup, GPUBindGroup];
}

export function createParticleResources(
  device: GPUDevice,
  layouts: ParticleLayouts,
  particleCount: number,
  seed: number,
): ParticleResources {
  const seededParticles = createSeededParticles(particleCount, seed);
  const particleBuffers: [GPUBuffer, GPUBuffer] = [
    createParticleBuffer(device, seededParticles, "particle buffer A"),
    createParticleBuffer(device, seededParticles, "particle buffer B"),
  ];
  const simUniformBuffer = device.createBuffer({
    label: "simulation uniforms",
    size: SIM_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderUniformBuffer = device.createBuffer({
    label: "render uniforms",
    size: RENDER_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  return {
    particleCount,
    particleBuffers,
    simUniformBuffer,
    renderUniformBuffer,
    computeBindGroups: [
      createComputeBindGroup(device, layouts, particleBuffers[0], particleBuffers[1], simUniformBuffer, "A to B"),
      createComputeBindGroup(device, layouts, particleBuffers[1], particleBuffers[0], simUniformBuffer, "B to A"),
    ],
    renderBindGroups: [
      createRenderBindGroup(device, layouts, particleBuffers[0], renderUniformBuffer, "render A"),
      createRenderBindGroup(device, layouts, particleBuffers[1], renderUniformBuffer, "render B"),
    ],
  };
}

export function destroyParticleResources(resources: ParticleResources): void {
  resources.particleBuffers[0].destroy();
  resources.particleBuffers[1].destroy();
  resources.simUniformBuffer.destroy();
  resources.renderUniformBuffer.destroy();
}

function createParticleBuffer(
  device: GPUDevice,
  data: Float32Array,
  label: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });

  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();

  return buffer;
}

function createComputeBindGroup(
  device: GPUDevice,
  layouts: ParticleLayouts,
  input: GPUBuffer,
  output: GPUBuffer,
  uniforms: GPUBuffer,
  label: string,
): GPUBindGroup {
  return device.createBindGroup({
    label: `particle compute bind group ${label}`,
    layout: layouts.compute,
    entries: [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: output } },
      { binding: 2, resource: { buffer: uniforms } },
    ],
  });
}

function createRenderBindGroup(
  device: GPUDevice,
  layouts: ParticleLayouts,
  particles: GPUBuffer,
  uniforms: GPUBuffer,
  label: string,
): GPUBindGroup {
  return device.createBindGroup({
    label: `particle render bind group ${label}`,
    layout: layouts.render,
    entries: [
      { binding: 0, resource: { buffer: particles } },
      { binding: 1, resource: { buffer: uniforms } },
    ],
  });
}

function createSeededParticles(particleCount: number, seed: number): Float32Array {
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  const random = mulberry32(seed);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * PARTICLE_FLOATS;
    const angle = random() * Math.PI * 2;
    const zUnit = random() * 2 - 1;
    const shellRadius = Math.cbrt(random()) * 0.92;
    const ringRadius = Math.sqrt(Math.max(1 - zUnit * zUnit, 0));
    const x = Math.cos(angle) * ringRadius * shellRadius;
    const y = Math.sin(angle) * ringRadius * shellRadius;
    const z = zUnit * shellRadius * 1.15;
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);
    const tangentZ = (random() - 0.5) * 0.42;
    const drift = 0.02 + random() * 0.075;
    const jitter = 0.65 + random() * 0.9;
    const hueSeed = random();
    const life = 4 + random() * 8;
    const particleSeed = random() * 10_000;

    data[offset + 0] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = jitter;
    data[offset + 4] = tangentX * drift;
    data[offset + 5] = tangentY * drift;
    data[offset + 6] = tangentZ * drift;
    data[offset + 7] = drift;
    data[offset + 8] = hueSeed;
    data[offset + 9] = random() * life;
    data[offset + 10] = life;
    data[offset + 11] = particleSeed;
  }

  return data;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
