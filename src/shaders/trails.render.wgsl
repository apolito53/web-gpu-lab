struct RenderParams {
  viewport: vec4f,
  style: vec4f,
  camera: vec4f,
  grid: vec4f,
  trail: vec4f,
};

struct FullscreenOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var trailTexture: texture_2d<f32>;
@group(0) @binding(1) var trailSampler: sampler;
@group(0) @binding(2) var<uniform> renderParams: RenderParams;

@vertex
fn fullscreenVertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));

  var output: FullscreenOutput;
  // WebGPU framebuffer rows run top-to-bottom while clip-space Y runs bottom-to-top.
  // Flip only the clip-space Y so sampled history keeps the same screen orientation.
  output.clipPosition = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  output.uv = uv;
  return output;
}

@fragment
fn fadeFragmentMain(input: FullscreenOutput) -> @location(0) vec4f {
  if (renderParams.trail.w > 0.5) {
    return vec4f(0.0);
  }

  let previous = textureSample(trailTexture, trailSampler, input.uv);
  let decay = pow(clamp(renderParams.trail.y, 0.0, 0.9999), max(renderParams.trail.z, 0.0));
  return vec4f(previous.rgb * decay, previous.a * decay);
}

@fragment
fn compositeFragmentMain(input: FullscreenOutput) -> @location(0) vec4f {
  let trail = textureSample(trailTexture, trailSampler, input.uv);
  let opacity = clamp(renderParams.trail.x, 0.0, 1.0);
  return vec4f(trail.rgb * opacity, 1.0);
}
