struct Particle {
  position: vec4f,
  velocity: vec4f,
  attrs: vec4f,
};

struct SimParams {
  timing: vec4f,
  controls: vec4f,
  attractor: vec4f,
  field: vec4f,
  flow: vec4f,
};

@group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(2) var<uniform> sim: SimParams;

fn wrappedPosition(pos: vec2f, bounds: f32) -> vec2f {
  var wrapped = pos;
  let span = bounds * 2.0;

  if (wrapped.x < -bounds) {
    wrapped.x = wrapped.x + span;
  }

  if (wrapped.x > bounds) {
    wrapped.x = wrapped.x - span;
  }

  if (wrapped.y < -bounds) {
    wrapped.y = wrapped.y + span;
  }

  if (wrapped.y > bounds) {
    wrapped.y = wrapped.y - span;
  }

  return wrapped;
}

fn turbulenceDirection(pos: vec2f, seed: f32, elapsed: f32, noiseScale: f32, flowSpeed: f32) -> vec2f {
  let scaled = pos * max(noiseScale, 0.001);
  let phaseA = sin(dot(scaled, vec2f(12.9898, 78.233)) + elapsed * flowSpeed + seed * 0.017);
  let phaseB = cos(dot(scaled.yx, vec2f(39.3467, 11.1351)) - elapsed * flowSpeed * 0.73 + seed * 0.011);
  let angle = (phaseA + phaseB) * 3.14159265;
  return vec2f(cos(angle), sin(angle));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  let particleCount = u32(sim.timing.z);

  if (index >= particleCount) {
    return;
  }

  var particle = particlesIn[index];
  var pos = particle.position.xy;
  var vel = particle.velocity.xy;

  let dt = min(sim.timing.x, 0.033);
  let elapsed = sim.timing.y;
  let speed = sim.controls.x;
  let damping = clamp(sim.controls.y, 0.0, 1.0);
  let bounds = sim.controls.z;
  let pointer = sim.attractor.xy;
  let strength = sim.attractor.z;
  let radius = max(sim.attractor.w, 0.0001);
  let pointerActive = sim.field.x > 0.5;
  let mode = u32(sim.field.y + 0.5);
  let turbulence = sim.field.z;
  let noiseScale = sim.field.w;
  let flowSpeed = sim.flow.x;

  if (pointerActive) {
    let toPointer = pointer - pos;
    let distanceToPointer = length(toPointer);

    if (distanceToPointer < radius && distanceToPointer > 0.0001) {
      let direction = toPointer / distanceToPointer;
      let falloff = pow(1.0 - distanceToPointer / radius, 1.45);
      var force = direction * strength * falloff;

      if (mode == 1u) {
        force = -direction * strength * falloff;
      }

      if (mode == 2u) {
        let orbit = vec2f(-direction.y, direction.x);
        force = (orbit * 1.35 + direction * 0.18) * strength * falloff;
      }

      vel = vel + force * dt;
    }
  }

  let drift = turbulenceDirection(pos, particle.attrs.w, elapsed, noiseScale, flowSpeed);
  vel = vel + drift * turbulence * dt;

  let drag = pow(damping, dt * 60.0);
  vel = vel * drag;

  let speedLimit = 2.8;
  let currentSpeed = length(vel);

  if (currentSpeed > speedLimit) {
    vel = normalize(vel) * speedLimit;
  }

  pos = wrappedPosition(pos + vel * dt * speed, bounds);

  particle.position = vec4f(pos, particle.position.z, particle.position.w);
  particle.velocity = vec4f(vel, 0.0, length(vel));
  particle.attrs = vec4f(particle.attrs.x, particle.attrs.y + dt, particle.attrs.z, particle.attrs.w);
  particlesOut[index] = particle;
}
