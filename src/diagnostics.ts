export type DiagnosticValue =
  | string
  | number
  | boolean
  | null
  | DiagnosticValue[]
  | { [key: string]: DiagnosticValue };
export type DiagnosticPayload = Record<string, DiagnosticValue>;

export interface FrameDiagnosticSample extends DiagnosticPayload {
  fps: number;
  rafFrameMs: number;
  cpuSubmitMs: number;
  particleCount: number;
  dispatchSize: number;
  canvasWidth: number;
  canvasHeight: number;
  paused: boolean;
}

export class Diagnostics {
  private readonly endpoint = "http://127.0.0.1:5188/events";
  private lastFrameLog = 0;

  installGlobalErrorHandlers(): void {
    window.addEventListener("error", (event) => {
      this.log("error.window", {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.log("error.unhandledRejection", {
        reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
      });
    });
  }

  log(event: string, payload: DiagnosticPayload = {}): void {
    const body = JSON.stringify({
      event,
      payload,
      href: window.location.href,
      visibility: document.visibilityState,
      at: new Date().toISOString(),
    });

    fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Diagnostics are useful, not load-bearing. The lab should keep running without the log server.
    });
  }

  logFrameSample(now: number, sample: FrameDiagnosticSample): void {
    if (now - this.lastFrameLog < 5000) {
      return;
    }

    this.lastFrameLog = now;
    this.log("render.frameSample", {
      fps: Number(sample.fps.toFixed(1)),
      rafFrameMs: Number(sample.rafFrameMs.toFixed(2)),
      cpuSubmitMs: Number(sample.cpuSubmitMs.toFixed(2)),
      particleCount: sample.particleCount,
      dispatchSize: sample.dispatchSize,
      canvasWidth: sample.canvasWidth,
      canvasHeight: sample.canvasHeight,
      paused: sample.paused,
    });
  }
}
