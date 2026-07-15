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
- `GPU off` reloads the lab with optional timestamp-query profiling enabled; use `GPU on` to return to the uninstrumented baseline.
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
- `Bench` runs the versioned Direct, Trails, and Stress scenarios from `16k` through `1.0m` particles, then restores the complete interactive state.
- `Copy` writes the last benchmark report JSON to the clipboard.

## Diagnostics

`npm.cmd run dev` starts the app and the local diagnostics server.

- Health: `http://127.0.0.1:5188/health`
- Recent events: `http://127.0.0.1:5188/events`
- Retained log file: `logs/events.ndjson`

The browser emits `app.boot`, `webgpu.ready`, `webgpu.profile`, `webgpu.deviceLost`, `webgpu.uncapturedError`, `simulation.reset`, `trails.targets`, `control.changed`, `debug.mode`, periodic `render.frameSample`, and benchmark lifecycle events. Profiling runs additionally emit `gpuProfiler.ready`, `gpu.frameSample`, and readback failures if they occur.

## Timing

- `FPS` is based on the browser's `requestAnimationFrame` interval, so it reflects display/browser cadence.
- `RAF ms` is the averaged time between animation callbacks.
- `p95 RAF` and `Over 60` are rolling RAF-window stats for spotting stutter and 60 Hz budget misses.
- `CPU submit` is the JavaScript-side command encoding/submission time. It is not GPU execution time.
- `GPU avg`, `GPU p50`, and `GPU p95` are true pass-duration sums from WebGPU timestamp queries. The profiler keeps three asynchronous readback slots and skips measurement frames instead of blocking RAF when every slot is busy.
- GPU timing is capability-aware and opt-in. Click `GPU off` or load `?gpuProfiler=on`; unsupported adapters show `unavailable`, while a supported but unrequested profiler shows `disabled`.
- Pass summaries distinguish `compute`, `directRender`, `trailFade`, `trailParticles`, and `trailComposite`. A direct frame reports only compute plus direct rendering, and a paused frame omits compute.
- Keep profiling off for canonical RAF baselines. Requesting an optional device feature and collecting timestamps can change the workload, so instrumented and uninstrumented results should be compared as separate runs.

## Benchmarking

The HUD benchmark is a reusable cross-device calibration harness. Scenario set v1 contains 15 steps: Direct, Trails, and Stress each run at `16k`, `66k`, `262k`, `524k`, and `1.0m` particles. Canonical trail scenarios use the full-resolution `rgba8unorm` compatibility path so desktop, integrated-GPU, and mobile reports share a common workload.

Every step starts from its scenario's versioned seed and complete configuration. The runner advances a fixed `1/60` simulation clock through 30 warmup frames and exactly 120 measured frames, with deterministic inactive, orbit-loop, or figure-eight pointer paths. RAF intervals remain real device measurements; fixed simulation time does not replace them. Interactive input is inert for the run.

The benchmark uses a temporary particle engine while the interactive engine remains parked with its buffers and trail textures intact. Completion restores the complete config, pointer state, pause/lock state, particles, and trail history instead of merely reconstructing equivalent controls.

Schema-v2 reports are saved to `localStorage` under `webgpu-particle-lab:lastBenchmark`, emitted as structured diagnostics, and copied from the HUD. They include scenario versions and seeds, complete resolved configs, scripted path versions, canvas backing resolution, render path, target format/scale, particle and trail allocation estimates, exact frame counts, RAF/CPU summaries, GPU timing availability, and per-pass timings when profiling is active. Disabled or unavailable GPU timing remains explicit and never substitutes RAF or CPU-submit values.

## Trail Rendering

When `Trails` is above `0`, particles render through a multi-pass path:

- fade the previous trail texture into the write texture
- inject low-energy particle history normalized by the effective frame decay
- composite the trail texture to the canvas
- draw the current particles directly so the live frame stays crisp
- draw the grid overlay last so it stays crisp

The fullscreen passes preserve framebuffer orientation, so ping-pong history does not alternate or mirror between frames. The compatibility target uses `rgba8unorm`; the HDR target uses `rgba16float` with exponential tone mapping. HDR pipeline creation is isolated behind a validation scope, so unsupported devices keep the 8-bit path instead of failing boot. When `Trails` is `0`, the renderer skips trail textures and uses the direct canvas path.

Two ping-pong targets are allocated. Estimated trail memory is therefore `width * height * bytesPerPixel * 2`, before implementation-specific overhead: 4 bytes per pixel for 8-bit targets and 8 bytes per pixel for HDR targets.

## Rendering Ownership

`ParticleEngine` remains the frame orchestrator. It selects direct or trail rendering, writes simulation and render uniforms, asks for the current target state, submits the command buffer, and advances particle state.

`src/particles/framePasses.ts` contains explicit command-recording functions for compute, direct rendering, trail fade, trail particle injection, composite, and grid draws. Pass order and timestamp labels stay visible without a generalized render graph.

`src/particles/renderTargets.ts` owns trail texture allocation, views, samplers, texture bind groups, resize/format/scale recreation, ping-pong indices, clear state, destruction, and memory metadata. `src/instrumentation/gpuTimestampProfiler.ts` independently owns optional queries and asynchronous readback.

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
