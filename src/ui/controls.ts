import type { BenchmarkProgress, BenchmarkReport } from "../instrumentation/benchmark";
import type { FrameMetricSummary } from "../instrumentation/frameMetrics";
import {
  DEFAULT_CONFIG,
  type DebugMode,
  type FrameStats,
  PARTICLE_COUNTS,
  type PointerMode,
  type SimulationConfig,
} from "../particles/types";

export interface ControlEvents {
  onConfigChanged: (config: SimulationConfig, key: string) => void;
  onReset: () => void;
  onPointerLockChanged: (locked: boolean) => void;
  onBenchmarkStart: () => void;
  onBenchmarkCopy: () => void;
}

interface ButtonSet<T extends string> {
  value: T;
  buttons: Map<T, HTMLButtonElement>;
}

export class Controls {
  readonly config: SimulationConfig = { ...DEFAULT_CONFIG };
  private readonly statusValue: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly rafFrameValue: HTMLElement;
  private readonly cpuSubmitValue: HTMLElement;
  private readonly p95FrameValue: HTMLElement;
  private readonly overBudgetValue: HTMLElement;
  private readonly particleValue: HTMLElement;
  private readonly dispatchValue: HTMLElement;
  private readonly pointerValue: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly lockButton: HTMLButtonElement;
  private readonly benchmarkValue: HTMLElement;
  private readonly stableValue: HTMLElement;
  private readonly tierValue: HTMLElement;
  private readonly benchmarkProgress: HTMLElement;
  private readonly runBenchmarkButton: HTMLButtonElement;
  private readonly copyBenchmarkButton: HTMLButtonElement;
  private readonly countButtons: ButtonSet<string>;
  private readonly modeButtons: ButtonSet<PointerMode>;
  private readonly debugButtons: ButtonSet<DebugMode>;

  constructor(root: HTMLElement, private readonly events: ControlEvents) {
    root.replaceChildren();

    const panel = document.createElement("section");
    panel.className = "hud-panel";

    const title = document.createElement("div");
    title.className = "hud-title";
    title.textContent = "WebGPU Particle Lab";
    panel.append(title);

    const status = createMetric("Status", "Booting");
    const fps = createMetric("FPS", "--");
    const rafFrame = createMetric("RAF ms", "--");
    const cpuSubmit = createMetric("CPU submit", "--");
    const p95Frame = createMetric("p95 RAF", "--");
    const overBudget = createMetric("Over 60", "--");
    const particles = createMetric("Particles", this.formatCount(this.config.particleCount));
    const dispatch = createMetric("Dispatch", "--");
    const pointer = createMetric("Pointer", "idle");

    this.statusValue = status.value;
    this.fpsValue = fps.value;
    this.rafFrameValue = rafFrame.value;
    this.cpuSubmitValue = cpuSubmit.value;
    this.p95FrameValue = p95Frame.value;
    this.overBudgetValue = overBudget.value;
    this.particleValue = particles.value;
    this.dispatchValue = dispatch.value;
    this.pointerValue = pointer.value;

    const metrics = document.createElement("div");
    metrics.className = "metric-grid";
    metrics.append(
      status.row,
      fps.row,
      rafFrame.row,
      cpuSubmit.row,
      p95Frame.row,
      overBudget.row,
      particles.row,
      dispatch.row,
      pointer.row,
    );
    panel.append(metrics);

    const primaryActions = document.createElement("div");
    primaryActions.className = "control-row";
    this.pauseButton = createButton("Pause", () => {
      this.config.paused = !this.config.paused;
      this.syncPauseButton();
      this.emitChange("paused");
    });
    const resetButton = createButton("Reset", () => this.events.onReset());
    this.lockButton = createButton("Lock", () => {
      const locked = this.lockButton.dataset.active !== "true";
      this.lockButton.dataset.active = String(locked);
      this.lockButton.textContent = locked ? "Unlock" : "Lock";
      this.events.onPointerLockChanged(locked);
    });
    primaryActions.append(this.pauseButton, resetButton, this.lockButton);
    panel.append(primaryActions);

    this.countButtons = this.createSegmentedButtons(
      "Count",
      PARTICLE_COUNTS.map((count) => String(count)),
      String(this.config.particleCount),
      (value) => {
        this.setParticleCount(Number(value));
        this.emitChange("particleCount");
      },
      (value) => this.formatCount(Number(value)),
    );
    panel.append(this.countButtonsElement("Count", this.countButtons));

    this.modeButtons = this.createSegmentedButtons(
      "Mode",
      ["attract", "repel", "orbit"],
      this.config.pointerMode,
      (value) => {
        this.config.pointerMode = value;
        this.emitChange("pointerMode");
      },
      titleCase,
    );
    panel.append(this.countButtonsElement("Mode", this.modeButtons));

    this.debugButtons = this.createSegmentedButtons(
      "View",
      ["beauty", "velocity", "density"],
      this.config.debugMode,
      (value) => {
        this.config.debugMode = value;
        this.emitChange("debugMode");
      },
      titleCase,
    );
    panel.append(this.countButtonsElement("View", this.debugButtons));

    const benchmark = createMetric("Bench", "idle");
    const stable = createMetric("Stable", "--");
    const tier = createMetric("Tier", "--");
    this.benchmarkValue = benchmark.value;
    this.stableValue = stable.value;
    this.tierValue = tier.value;
    this.benchmarkProgress = document.createElement("span");
    this.benchmarkProgress.className = "benchmark-progress-fill";
    const benchmarkProgressTrack = document.createElement("div");
    benchmarkProgressTrack.className = "benchmark-progress-track";
    benchmarkProgressTrack.append(this.benchmarkProgress);
    this.runBenchmarkButton = createButton("Bench", () => this.events.onBenchmarkStart());
    this.copyBenchmarkButton = createButton("Copy", () => this.events.onBenchmarkCopy());
    this.copyBenchmarkButton.disabled = true;
    const benchmarkActions = document.createElement("div");
    benchmarkActions.className = "control-row";
    benchmarkActions.append(this.runBenchmarkButton, this.copyBenchmarkButton);
    const benchmarkPanel = document.createElement("div");
    benchmarkPanel.className = "benchmark-panel";
    const benchmarkMetrics = document.createElement("div");
    benchmarkMetrics.className = "metric-grid";
    benchmarkMetrics.append(benchmark.row, stable.row, tier.row);
    benchmarkPanel.append(benchmarkMetrics, benchmarkProgressTrack, benchmarkActions);
    panel.append(benchmarkPanel);

    panel.append(
      createSlider(
        "Speed",
        "Scales how far particles move each frame after forces are applied.",
        0.05,
        2,
        0.01,
        this.config.speed,
        (value) => {
          this.config.speed = value;
          this.emitChange("speed");
        },
      ),
      createSlider(
        "Damping",
        "Controls velocity decay. Lower values bleed energy faster.",
        0.9,
        0.998,
        0.001,
        this.config.damping,
        (value) => {
          this.config.damping = value;
          this.emitChange("damping");
        },
      ),
      createSlider(
        "Strength",
        "Sets how hard the pointer field pushes or pulls particles.",
        0,
        4,
        0.01,
        this.config.strength,
        (value) => {
          this.config.strength = value;
          this.emitChange("strength");
        },
      ),
      createSlider(
        "Radius",
        "Sets the pointer field reach. Higher values affect more particles.",
        0.05,
        1.2,
        0.01,
        this.config.radius,
        (value) => {
          this.config.radius = value;
          this.emitChange("radius");
        },
      ),
      createSlider(
        "Turbulence",
        "Adds smooth flow-field drift on top of the pointer force.",
        0,
        1.5,
        0.01,
        this.config.turbulence,
        (value) => {
          this.config.turbulence = value;
          this.emitChange("turbulence");
        },
      ),
      createSlider(
        "Diffusion",
        "Adds tiny per-particle phase noise to break dense bands.",
        0,
        0.08,
        0.001,
        this.config.diffusion,
        (value) => {
          this.config.diffusion = value;
          this.emitChange("diffusion");
        },
      ),
      createSlider(
        "Depth",
        "Sets the z-axis volume that particles can occupy.",
        0.15,
        2.4,
        0.01,
        this.config.depth,
        (value) => {
          this.config.depth = value;
          this.emitChange("depth");
        },
      ),
      createSlider(
        "Spin",
        "Rotates the camera around the particle volume.",
        0,
        0.8,
        0.01,
        this.config.cameraSpin,
        (value) => {
          this.config.cameraSpin = value;
          this.emitChange("cameraSpin");
        },
      ),
      createSlider(
        "Perspective",
        "Controls how strongly near particles scale against far particles.",
        0.55,
        2.4,
        0.01,
        this.config.perspective,
        (value) => {
          this.config.perspective = value;
          this.emitChange("perspective");
        },
      ),
      createSlider(
        "Grid",
        "Controls the opacity of the 3D reference grid.",
        0,
        1,
        0.01,
        this.config.gridOpacity,
        (value) => {
          this.config.gridOpacity = value;
          this.emitChange("gridOpacity");
        },
      ),
      createSlider(
        "Size",
        "Sets particle sprite diameter in screen pixels before velocity boost.",
        1,
        8,
        0.1,
        this.config.particleSize,
        (value) => {
          this.config.particleSize = value;
          this.emitChange("particleSize");
        },
      ),
    );

    root.append(panel);
    this.countButtons.value = String(this.config.particleCount);
    this.modeButtons.value = this.config.pointerMode;
    this.debugButtons.value = this.config.debugMode;
    this.syncPauseButton();
  }

  updateStatus(status: string): void {
    this.statusValue.textContent = status;
  }

  updateStats(stats: FrameStats): void {
    this.fpsValue.textContent = stats.fps.toFixed(0);
    this.rafFrameValue.textContent = `${stats.rafFrameMs.toFixed(2)} ms`;
    this.cpuSubmitValue.textContent = `${stats.cpuSubmitMs.toFixed(2)} ms`;
    this.particleValue.textContent = this.formatCount(stats.particleCount);
    this.dispatchValue.textContent = String(stats.dispatchSize);
  }

  updatePerformance(summary: FrameMetricSummary): void {
    if (summary.sampleCount < 12) {
      this.p95FrameValue.textContent = "--";
      this.overBudgetValue.textContent = "--";
      return;
    }

    this.p95FrameValue.textContent = `${summary.p95FrameMs.toFixed(2)} ms`;
    this.overBudgetValue.textContent = `${Math.round(summary.over60HzBudgetRatio * 100)}%`;
  }

  updateBenchmark(progress: BenchmarkProgress): void {
    this.benchmarkValue.textContent = progress.running
      ? `${progress.stepIndex + 1}/${progress.stepCount} ${progress.label}`
      : progress.label;
    this.benchmarkProgress.style.transform = `scaleX(${progress.phaseProgress})`;
    this.runBenchmarkButton.disabled = progress.running;
    this.copyBenchmarkButton.disabled = progress.running || !progress.report;

    if (progress.report) {
      this.stableValue.textContent = this.formatCount(progress.report.maxStableParticleCount);
      this.tierValue.textContent = progress.report.tier;
    }
  }

  updateBenchmarkCopyStatus(label: string, report: BenchmarkReport | null): void {
    this.benchmarkValue.textContent = label;
    this.copyBenchmarkButton.disabled = !report;
  }

  updatePointer(active: boolean, locked: boolean): void {
    this.pointerValue.textContent = locked ? "locked" : active ? "live" : "idle";
  }

  setParticleCount(count: number): void {
    this.config.particleCount = count;
    this.particleValue.textContent = this.formatCount(count);

    if (this.countButtons) {
      this.countButtons.value = String(count);
      this.syncSegmentedButtons(this.countButtons);
    }
  }

  setPaused(paused: boolean): void {
    this.config.paused = paused;
    this.syncPauseButton();
  }

  private createSegmentedButtons<T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    onSelected: (value: T) => void,
    format: (value: T) => string,
  ): ButtonSet<T> {
    const buttons = new Map<T, HTMLButtonElement>();
    const set: ButtonSet<T> = { value: current, buttons };

    for (const value of values) {
      const button = createButton(format(value), () => {
        set.value = value;
        this.syncSegmentedButtons(set);
        onSelected(value);
      });
      button.dataset.segment = label;
      buttons.set(value, button);
    }

    this.syncSegmentedButtons(set);
    return set;
  }

  private countButtonsElement<T extends string>(label: string, set: ButtonSet<T>): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "segmented-control";
    const text = document.createElement("span");
    text.className = "control-label";
    text.textContent = label;
    const buttons = document.createElement("div");
    buttons.className = "segmented-buttons";

    for (const button of set.buttons.values()) {
      buttons.append(button);
    }

    wrapper.append(text, buttons);
    return wrapper;
  }

  private syncPauseButton(): void {
    this.pauseButton.textContent = this.config.paused ? "Resume" : "Pause";
    this.pauseButton.dataset.active = String(this.config.paused);
  }

  private syncSegmentedButtons<T extends string>(set: ButtonSet<T>): void {
    for (const [value, button] of set.buttons) {
      button.dataset.active = String(value === set.value);
    }
  }

  private emitChange(key: string): void {
    if (key === "debugMode") {
      this.events.onConfigChanged({ ...this.config }, key);
      return;
    }

    this.events.onConfigChanged({ ...this.config }, key);
  }

  private formatCount(value: number): string {
    return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
  }
}

function createMetric(label: string, initial: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement("div");
  row.className = "metric";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = initial;
  row.append(name, value);
  return { row, value };
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createSlider(
  label: string,
  helpText: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "slider-control";
  const top = document.createElement("span");
  top.className = "slider-top";
  const nameWrap = document.createElement("span");
  nameWrap.className = "slider-name-wrap";
  const name = document.createElement("span");
  name.textContent = label;
  const help = document.createElement("button");
  help.type = "button";
  help.className = "help-chip";
  help.textContent = "?";
  help.dataset.tooltip = helpText;
  help.setAttribute("aria-label", `${label}: ${helpText}`);
  const readout = document.createElement("strong");
  readout.textContent = value.toFixed(step < 0.01 ? 3 : 2);
  nameWrap.append(name, help);
  top.append(nameWrap, readout);

  const input = document.createElement("input");
  input.type = "range";
  input.setAttribute("aria-label", label);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const numericValue = Number(input.value);
    readout.textContent = numericValue.toFixed(step < 0.01 ? 3 : 2);
    onInput(numericValue);
  });

  wrapper.append(top, input);
  return wrapper;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
