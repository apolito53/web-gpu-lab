struct Particle {
  position: vec4f,
  velocity: vec4f,
  attrs: vec4f,
};

struct RenderParams {
  viewport: vec4f,
  style: vec4f,
  camera: vec4f,
  grid: vec4f,
  trail: vec4f,
  trailOutput: vec4f,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) speed: f32,
  @location(3) depthFade: f32,
};

struct GridOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) color: vec4f,
};

struct ProjectedPoint {
  clipCenter: vec2f,
  clipDepth: f32,
  depthRatio: f32,
  perspectiveScale: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> renderParams: RenderParams;

const GRID_DIVISIONS = 12u;

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

fn rotateY(pos: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}

fn rotateX(pos: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

fn projectPoint(worldPosition: vec3f) -> ProjectedPoint {
  let viewport = max(renderParams.viewport.xy, vec2f(1.0, 1.0));
  let aspect = viewport.x / viewport.y;
  let elapsed = renderParams.camera.x;
  let cameraSpin = renderParams.camera.y;
  let depth = max(renderParams.camera.z, 0.1);
  let perspective = max(renderParams.camera.w, 0.1);
  let yaw = elapsed * cameraSpin;
  let pitch = 0.38 + sin(elapsed * cameraSpin * 0.43) * 0.08;
  let rotated = rotateX(rotateY(worldPosition, yaw), pitch);
  let cameraDistance = 3.0 + depth * 1.15;
  let viewDepth = max(cameraDistance - rotated.z, 0.2);
  let perspectiveScale = clamp(perspective * cameraDistance / viewDepth, 0.36, 2.65);
  let projected = rotated.xy * perspectiveScale * 0.72;

  var output: ProjectedPoint;
  output.clipCenter = vec2f(projected.x / aspect, projected.y);
  output.clipDepth = clamp(viewDepth / (cameraDistance + depth + 1.5), 0.0, 1.0);
  output.depthRatio = clamp(rotated.z / depth * 0.5 + 0.5, 0.0, 1.0);
  output.perspectiveScale = perspectiveScale;
  return output;
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
  let projected = projectPoint(particle.position.xyz);
  let pixelSize = baseSize * sizeJitter * (1.0 + clamp(speed * 0.55, 0.0, 1.75)) * projected.perspectiveScale;
  let clipOffset = corner * pixelSize * 2.0 / viewport;
  let depthFade = mix(0.38, 1.18, projected.depthRatio);
  let debugMode = u32(renderParams.style.x + 0.5);
  var color = palette(particle.attrs.x) * mix(0.58, 1.22, projected.depthRatio);

  if (debugMode == 1u) {
    color = mix(vec3f(0.1, 0.45, 1.0), vec3f(1.0, 0.28, 0.12), clamp(speed * 1.6, 0.0, 1.0));
  }

  if (debugMode == 2u) {
    color = mix(vec3f(0.2, 0.45, 1.0), vec3f(0.72, 0.95, 1.0), projected.depthRatio);
  }

  var output: VertexOutput;
  output.clipPosition = vec4f(projected.clipCenter + clipOffset, projected.clipDepth, 1.0);
  output.local = corner;
  output.color = color;
  output.speed = speed;
  output.depthFade = depthFade;
  return output;
}

fn signedExtent(index: u32, extent: f32) -> f32 {
  return select(-extent, extent, index == 1u);
}

fn gridLineEndpoint(lineId: u32, endpoint: u32, bounds: f32, depth: f32) -> vec3f {
  let floorLineCount = (GRID_DIVISIONS + 1u) * 2u;

  if (lineId < floorLineCount) {
    let floorIndex = lineId / 2u;
    let direction = lineId % 2u;
    let t = f32(floorIndex) / f32(GRID_DIVISIONS);

    if (direction == 0u) {
      let z = mix(-depth, depth, t);
      let x = signedExtent(endpoint, bounds);
      return vec3f(x, -bounds, z);
    }

    let x = mix(-bounds, bounds, t);
    let z = signedExtent(endpoint, depth);
    return vec3f(x, -bounds, z);
  }

  let boxLineId = lineId - floorLineCount;

  if (boxLineId < 4u) {
    let y = signedExtent(boxLineId & 1u, bounds);
    let z = signedExtent(boxLineId / 2u, depth);
    let x = signedExtent(endpoint, bounds);
    return vec3f(x, y, z);
  }

  if (boxLineId < 8u) {
    let localId = boxLineId - 4u;
    let x = signedExtent(localId & 1u, bounds);
    let z = signedExtent(localId / 2u, depth);
    let y = signedExtent(endpoint, bounds);
    return vec3f(x, y, z);
  }

  if (boxLineId < 12u) {
    let localId = boxLineId - 8u;
    let x = signedExtent(localId & 1u, bounds);
    let y = signedExtent(localId / 2u, bounds);
    let z = signedExtent(endpoint, depth);
    return vec3f(x, y, z);
  }

  let axisId = boxLineId - 12u;

  if (axisId == 0u) {
    return vec3f(signedExtent(endpoint, bounds), 0.0, 0.0);
  }

  if (axisId == 1u) {
    return vec3f(0.0, signedExtent(endpoint, bounds), 0.0);
  }

  return vec3f(0.0, 0.0, signedExtent(endpoint, depth));
}

fn gridLineColor(lineId: u32) -> vec4f {
  let opacity = clamp(renderParams.grid.x, 0.0, 1.0);
  let floorLineCount = (GRID_DIVISIONS + 1u) * 2u;

  if (lineId < floorLineCount) {
    let floorIndex = lineId / 2u;
    let major = floorIndex == 0u || floorIndex == GRID_DIVISIONS / 2u || floorIndex == GRID_DIVISIONS;
    let alpha = select(0.14, 0.34, major) * opacity;
    return vec4f(0.28, 0.7, 0.95, alpha);
  }

  let boxLineId = lineId - floorLineCount;

  if (boxLineId < 12u) {
    return vec4f(0.42, 0.78, 1.0, 0.32 * opacity);
  }

  let axisId = boxLineId - 12u;

  if (axisId == 0u) {
    return vec4f(0.72, 1.0, 0.82, 0.6 * opacity);
  }

  if (axisId == 1u) {
    return vec4f(0.54, 0.78, 1.0, 0.52 * opacity);
  }

  return vec4f(1.0, 0.7, 0.42, 0.54 * opacity);
}

@vertex
fn gridVertexMain(@builtin(vertex_index) vertexIndex: u32) -> GridOutput {
  let lineId = vertexIndex / 2u;
  let endpoint = vertexIndex % 2u;
  let bounds = max(renderParams.grid.y, 0.1);
  let depth = max(renderParams.camera.z, 0.1);
  let worldPosition = gridLineEndpoint(lineId, endpoint, bounds, depth);
  let projected = projectPoint(worldPosition);

  var output: GridOutput;
  output.clipPosition = vec4f(projected.clipCenter, projected.clipDepth + 0.002, 1.0);
  output.color = gridLineColor(lineId) * mix(0.58, 1.12, projected.depthRatio);
  return output;
}

@fragment
fn gridFragmentMain(input: GridOutput) -> @location(0) vec4f {
  return input.color;
}

fn particleFragmentColor(input: VertexOutput) -> vec4f {
  let radius = length(input.local);

  if (radius > 1.0) {
    discard;
  }

  let debugMode = u32(renderParams.style.x + 0.5);
  let core = exp(-radius * radius * 3.2);
  let halo = exp(-radius * radius * 0.82) * 0.28;
  var alpha = (core + halo) * input.depthFade * 0.72;
  var color = input.color * (0.45 + input.speed * 1.2);

  if (debugMode == 2u) {
    alpha = smoothstep(1.0, 0.0, radius) * 0.16 * input.depthFade;
    color = input.color;
  }

  return vec4f(color, alpha);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return particleFragmentColor(input);
}

@fragment
fn trailFragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let particleColor = particleFragmentColor(input);
  let frameDecay = pow(clamp(renderParams.trail.y, 0.0, 0.9999), max(renderParams.trail.z, 0.0));

  // Scale new history by the amount removed this frame. This keeps steady-state
  // trail energy roughly stable as decay changes instead of saturating rgba8.
  let historyGain = clamp(1.0 - frameDecay, 0.0001, 1.0);
  return vec4f(particleColor.rgb, particleColor.a * historyGain);
}
