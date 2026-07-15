# WebGPU Particle Lab

Raw WebGPU particle wind tunnel for learning compute passes, storage buffers, offscreen render targets, explicit bind group layouts, WGSL, and cheap 3D projection without hiding the machinery behind Three.js.

## Run

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5187/`.

## Ports

| Service | Port |
| --- | ---: |
| Vite app | `5187` |
| Diagnostics receiver | `5188` |
| Preview | `4187` |

## Controls

- `Pause` freezes the compute step while keeping the app alive.
- `Reset` reseeds the GPU buffers.
- Particle count switches between `16k`, `64k`, and `256k`.
- Pointer modes switch the mouse/touch field between attract, repel, and orbit.
- Strength, radius, speed, damping, and turbulence tune the compute shader uniforms.
- Diffusion adds a small per-particle phase break that reduces dense attractor banding without hiding the underlying flow.
- Depth controls the z-axis simulation volume.
- Spin rotates the render camera around the volume so the 3D shape is visible.
- Perspective controls near/far sprite scaling in the projected render pass.
- Grid controls the opacity of the 3D reference grid overlay.
- Trails controls offscreen trail opacity. Set it to `0` for the direct particle-to-canvas render path.
- Decay controls how quickly trail history fades between frames.
- Exposure controls history brightness before HDR tone mapping or 8-bit compositing.
- Target switches between the mobile-friendly `rgba8unorm` path and an HDR `rgba16float` path when supported.
- Trail res scales only the history targets to `0.5x`, `0.75x`, or `1x`; current particles and the grid remain full-resolution.
- Each slider has a hover/focus `?` tooltip with a short explanation.
- `Bench` runs a short calibration sweep from `16k` to `1.0m` particles, then restores the prior particle count and pause state.
- `Copy` writes the last benchmark report JSON to the clipboard.

## Diagnostics

`npm.cmd run dev` starts the app and the local diagnostics server.

- Health: `http://127.0.0.1:5188/health`
- Recent events: `http://127.0.0.1:5188/events`
- Retained log file: `logs/events.ndjson`

The browser emits `app.boot`, `webgpu.ready`, `webgpu.profile`, `webgpu.deviceLost`, `webgpu.uncapturedError`, `simulation.reset`, `trails.targets`, `control.changed`, `debug.mode`, periodic `render.frameSample`, and benchmark lifecycle events.

## Timing

- `FPS` is based on the browser's `requestAnimationFrame` interval, so it reflects display/browser cadence.
- `RAF ms` is the averaged time between animation callbacks.
- `p95 RAF` and `Over 60` are rolling RAF-window stats for spotting stutter and 60 Hz budget misses.
- `CPU submit` is the JavaScript-side command encoding/submission time. It is not GPU execution time.
- True GPU timing needs timestamp queries and is intentionally left for a later profiling pass.

## Benchmarking

The HUD benchmark is meant as a reusable device calibration harness for future WebGPU experiments. It records the adapter summary, selected WebGPU limits, user agent, DPR, viewport size, baseline simulation and camera settings, and per-count p50/p95 RAF plus CPU-submit timings.

Reports are saved to `localStorage` under `webgpu-particle-lab:lastBenchmark`, emitted as structured diagnostics, and can be copied from the HUD. Each step records the resolved trail format, scale, dimensions, and estimated allocation when trails are active.

## Trail Rendering

When `Trails` is above `0`, particles render through a multi-pass path:

- fade the previous trail texture into the write texture
- inject low-energy particle history normalized by the effective frame decay
- composite the trail texture to the canvas
- draw the current particles directly so the live frame stays crisp
- draw the grid overlay last so it stays crisp

The fullscreen passes preserve framebuffer orientation, so ping-pong history does not alternate or mirror between frames. The compatibility target uses `rgba8unorm`; the HDR target uses `rgba16float` with exponential tone mapping. HDR pipeline creation is isolated behind a validation scope, so unsupported devices keep the 8-bit path instead of failing boot. When `Trails` is `0`, the renderer skips trail textures and uses the direct canvas path.

Two ping-pong targets are allocated. Estimated trail memory is therefore `width * height * bytesPerPixel * 2`, before implementation-specific overhead: 4 bytes per pixel for 8-bit targets and 8 bytes per pixel for HDR targets.

## Validate

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke
```

Or run the combined pass:

```powershell
npm.cmd run validate
```

## Architecture

Start with [`CODEBASE_INDEX.md`](./CODEBASE_INDEX.md) for the fast map.
