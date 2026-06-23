# WebGPU Particle Lab Codebase Index

Purpose: a compact routing map for the raw WebGPU particle wind tunnel. Keep this file focused on where to make changes and how to validate them.

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
- `src/particles/buffers.ts`: CPU seeding, ping-pong storage buffers, uniform buffers, and bind groups.
- `src/particles/pipelines.ts`: explicit bind group layouts and compute/render pipeline creation.
- `src/particles/frame.ts`: per-frame uniform writes, compute dispatch, render draw, and buffer swapping.
- `src/main.ts`: owns RAF cadence timing; `src/particles/frame.ts` owns CPU command-submit timing.
- `src/particles/types.ts`: shared config, pointer, stats, and constants.
- `src/ui/controls.ts`: HUD, buttons, sliders, segmented modes, and status/stats updates.
- `src/shaders/particles.compute.wgsl`: velocity integration, pointer force, turbulence, diffusion, damping, and wrapping.
- `src/shaders/particles.render.wgsl`: instanced quad expansion and soft particle fragment coloring.

## Common Changes

- Particle physics feel: start in `src/shaders/particles.compute.wgsl`, then expose knobs through `src/ui/controls.ts` and `src/particles/types.ts`. `Diffusion` is the anti-banding phase-break knob for dense attractor stress tests.
- Visual particle style: edit `src/shaders/particles.render.wgsl`.
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
- The smoke script verifies app and diagnostics health, not real GPU rendering. Use a browser pass for visual confidence.
- HUD `FPS` is RAF cadence, while `CPU submit` is command encoding/submission time. Do not use CPU submit as display FPS or GPU time.
