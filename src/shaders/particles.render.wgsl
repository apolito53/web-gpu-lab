struct Particle {
  position: vec4f,
  velocity: vec4f,
  attrs: vec4f,
};

struct RenderParams {
  viewport: vec4f,
  style: vec4f,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) speed: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> renderParams: RenderParams;

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0),
  vec2f(1.0, -1.0),
  vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0),
  vec2f(1.0, 1.0),
);

fn palette(seed: f32) -> vec3f {
  let cool = vec3f(0.34, 0.67, 1.0);
  let mint = vec3f(0.45, 1.0, 0.76);
  let ember = vec3f(1.0, 0.64, 0.38);
  let a = mix(cool, mint, smoothstep(0.08, 0.72, seed));
  return mix(a, ember, smoothstep(0.72, 1.0, seed) * 0.42);
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let particle = particles[instanceIndex];
  let corner = QUAD[vertexIndex];
  let viewport = max(renderParams.viewport.xy, vec2f(1.0, 1.0));
  let speed = particle.velocity.w;
  let sizeJitter = particle.position.w;
  let baseSize = renderParams.viewport.w;
  let pixelSize = baseSize * sizeJitter * (1.0 + clamp(speed * 0.55, 0.0, 1.75));
  let clipOffset = corner * pixelSize * 2.0 / viewport;
  let debugMode = u32(renderParams.style.x + 0.5);
  var color = palette(particle.attrs.x);

  if (debugMode == 1u) {
    color = mix(vec3f(0.1, 0.45, 1.0), vec3f(1.0, 0.28, 0.12), clamp(speed * 1.6, 0.0, 1.0));
  }

  if (debugMode == 2u) {
    color = vec3f(0.72, 0.95, 1.0);
  }

  var output: VertexOutput;
  output.clipPosition = vec4f(particle.position.xy + clipOffset, 0.0, 1.0);
  output.local = corner;
  output.color = color;
  output.speed = speed;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let radius = length(input.local);

  if (radius > 1.0) {
    discard;
  }

  let debugMode = u32(renderParams.style.x + 0.5);
  let core = exp(-radius * radius * 3.2);
  let halo = exp(-radius * radius * 0.82) * 0.28;
  var alpha = core + halo;
  var color = input.color * (0.45 + input.speed * 1.2);

  if (debugMode == 2u) {
    alpha = smoothstep(1.0, 0.0, radius) * 0.16;
    color = vec3f(0.55, 0.85, 1.0);
  }

  return vec4f(color, alpha);
}
