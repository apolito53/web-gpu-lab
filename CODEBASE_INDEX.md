# WebGPU Particle Lab Codebase Index

Purpose: a compact routing map for the raw WebGPU 3D particle wind tunnel. Keep this file focused on where to make changes and how to validate them.

## Entry Points

- `index.html` mounts the full-screen canvas, HUD root, and fallback root.
- `src/main.ts` owns boot order, UI wiring, pointer input, RAF, and shutdown behavior.
- `scripts/start-dev.mjs` starts Vite and the diagnostics receiver together on Windows-safe commands.
- `scripts/log-server.mjs` exposes `GET /health`, `GET /events`, and `POST /events` on port `5188`.
- `scripts/smoke.mjs` starts temporary local servers, probes the app shell, and verifies diagnostics retention.

## Source Map

- `src/diagnostics.ts`: browser-side structured event logging with optional log-server failure tolerance.
- `src/gpu/webgpu.ts`: adapter/device/context creation plus device-loss and uncaptured-error hooks.
- `src/gpu/resize.ts`: DPR-clamped canvas backing size and context reconfiguration.
- `src/instrumentation/frameMetrics.ts`: rolling RAF/CPU-submit summaries, p95 timing, and 60 Hz budget miss ratios.
- `src/instrumentation/gpuTimestampProfiler.ts`: optional timestamp-query pass instrumentation, three-slot asynchronous readback, dropped-sample accounting, and rolling GPU summaries.
- `src/instrumentation/benchmark.ts`: benchmark sweep counts, warm-up/sample windows, stable-tier scoring, and report shaping.
- `src/particles/buffers.ts`: CPU seeding into a 3D volume, ping-pong storage buffers, uniform buffers, and particle bind groups.
- `src/particles/trails.ts`: scaled 8-bit/HDR trail textures, sampler, texture bind groups, and allocation estimates.
- `src/particles/pipelines.ts`: explicit bind group layouts plus compute, particle, optional HDR trail, fade/composite, and generated grid pipeline creation.
- `src/particles/frame.ts`: per-frame 3D simulation/camera/grid/trail uniform writes, compute dispatch, direct or offscreen trail render flow, crisp live-particle composite, grid draw, and buffer swapping.
- `src/main.ts`: owns RAF cadence timing; `src/particles/frame.ts` owns CPU command-submit timing.
- `src/particles/types.ts`: shared config, pointer, stats, and constants.
- `src/ui/controls.ts`: HUD, buttons, sliders, slider help tooltips, segmented modes, and status/stats updates.
- `src/shaders/particles.compute.wgsl`: 3D velocity integration, spherical pointer force, orbit swirl, turbulence, diffusion, damping, and wrapping.
- `src/shaders/particles.render.wgsl`: projected 3D instanced quad expansion, depth scaling/tinting, soft particle coloring, decay-normalized trail injection, and generated 3D reference grid lines.
- `src/shaders/trails.render.wgsl`: orientation-correct fullscreen fade and composite passes for offscreen trail textures.

## Common Changes

- Particle physics feel: start in `src/shaders/particles.compute.wgsl`, then expose knobs through `src/ui/controls.ts` and `src/particles/types.ts`. `Diffusion` is the anti-banding phase-break knob for dense attractor stress tests; `Depth` sets the z-axis simulation volume.
- Visual particle style, camera projection, and grid overlay: edit `src/shaders/particles.render.wgsl`. `Spin`, `Perspective`, and `Grid` are render-side controls.
- Trail behavior and fullscreen compositing: edit `src/shaders/trails.render.wgsl`, `src/particles/trails.ts`, and the trail branch in `src/particles/frame.ts`. Target format pipelines live in `src/particles/pipelines.ts`; `Trails = 0` keeps the direct canvas path.
- Device calibration or reusable benchmark output: start in `src/instrumentation/benchmark.ts`, then wire HUD status in `src/ui/controls.ts` and diagnostics in `src/main.ts`. Pass-level GPU timing lives in `src/instrumentation/gpuTimestampProfiler.ts` and is attached in `src/particles/frame.ts`.
- WebGPU lifecycle: use `src/gpu/webgpu.ts` and `src/gpu/resize.ts`.
- Buffer layout changes: update `src/particles/buffers.ts`, `src/particles/pipelines.ts`, and both WGSL files together.
- Smoke/diagnostics changes: update `scripts/smoke.mjs`, `scripts/log-server.mjs`, and `src/diagnostics.ts`.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke
```

`npm.cmd run validate` runs the combined pass.

## Sharp Edges

- This project intentionally has no WebGL fallback. Missing WebGPU should render the fallback state and log `webgpu.unavailable`.
- Bind group layouts are explicit on purpose. Avoid `layout: "auto"` unless the goal changes.
- Particle buffers are recreated only when the particle count changes; resize should not touch simulation buffers.
- Trail textures are recreated on canvas backing-size, target mode, resolution scale, or render-uniform-buffer changes.
- The particle render pass uses additive blending without depth sorting. The grid is a reference overlay drawn after particles, so it prioritizes readability over physical occlusion.
- The 8-bit trail path is the compatibility default. HDR uses `rgba16float`, but optional pipeline failure must disable that control and retain 8-bit rendering.
- The smoke script verifies app and diagnostics health, not real GPU rendering. Use a browser pass for visual confidence.
- HUD `FPS` is RAF cadence, while `CPU submit` is command encoding/submission time. Do not use CPU submit as display FPS or GPU time.
- Timestamp-query profiling is deliberately opt-in through the HUD or `?gpuProfiler=on`. Keep it off for canonical RAF baselines, and treat its summed pass durations separately from end-to-end frame cadence.
- The profiler never waits inside RAF. It uses three readback slots and counts an unmeasured frame as dropped when all slots are occupied.
