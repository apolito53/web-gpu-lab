# WebGPU Particle Lab

Raw WebGPU particle wind tunnel for learning compute passes, storage buffers, explicit bind group layouts, and WGSL without hiding the machinery behind Three.js.

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
- Each slider has a hover/focus `?` tooltip with a short explanation.

## Diagnostics

`npm.cmd run dev` starts the app and the local diagnostics server.

- Health: `http://127.0.0.1:5188/health`
- Recent events: `http://127.0.0.1:5188/events`
- Retained log file: `logs/events.ndjson`

The browser emits `app.boot`, `webgpu.ready`, `webgpu.deviceLost`, `webgpu.uncapturedError`, `simulation.reset`, `control.changed`, `debug.mode`, and periodic `render.frameSample` events.

## Timing

- `FPS` is based on the browser's `requestAnimationFrame` interval, so it reflects display/browser cadence.
- `RAF ms` is the averaged time between animation callbacks.
- `CPU submit` is the JavaScript-side command encoding/submission time. It is not GPU execution time.
- True GPU timing needs timestamp queries and is intentionally left for a later profiling pass.

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
