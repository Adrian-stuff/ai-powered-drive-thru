import type { AudioFrame, HealthStatus } from '../../common.ts';
import type {
  VadCapabilities,
  VadDetector,
  VadEvent,
  VadOptions,
  VadProvider,
} from '../../ports/vad.ts';
import { frameEnergy } from '../audio.ts';

export interface FakeVadOptions {
  readonly id?: string;
  readonly capabilities?: Partial<VadCapabilities>;
  /** Consecutive silent frames before `speech_end`. */
  readonly hangoverFrames?: number;

  /** See `FakeAsrOptions.violations`. */
  readonly violations?: {
    /** Emit `speech_end` without a preceding `speech_start`. */
    readonly endWithoutStart?: boolean;
    /** Emit `barge_in` even when TTS is not playing. */
    readonly bargeInWithoutDucking?: boolean;
    /** `reset()` does nothing. */
    readonly resetIsNoop?: boolean;
  };
}

const DEFAULT_CAPABILITIES: VadCapabilities = {
  supportsSemanticEndpointing: false,
  frameDurationsMs: [10, 20, 30],
};

/**
 * Energy-threshold VAD over `patternFrames` input. Real enough to drive
 * pipeline tests: `'..####....'` produces speech_start then speech_end.
 */
export class FakeVadProvider implements VadProvider {
  readonly id: string;
  readonly capabilities: VadCapabilities;

  initCount = 0;
  disposeCount = 0;

  #options: FakeVadOptions;

  constructor(options: FakeVadOptions = {}) {
    this.#options = options;
    this.id = options.id ?? 'fake-vad';
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
  }

  async init(): Promise<void> {
    this.initCount += 1;
  }

  async health(): Promise<HealthStatus> {
    return { ok: this.disposeCount === 0, latencyMs: 0 };
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }

  createDetector(options: VadOptions): VadDetector {
    return new FakeVadDetector(options, this.#options);
  }
}

class FakeVadDetector implements VadDetector {
  #inSpeech = false;
  #silentRun = 0;
  #bargedIn = false;

  constructor(
    private readonly options: VadOptions,
    private readonly fake: FakeVadOptions,
  ) {}

  push(frame: AudioFrame): readonly VadEvent[] {
    const violations = this.fake.violations ?? {};
    const hangover = this.fake.hangoverFrames ?? 3;
    const events: VadEvent[] = [];
    const isSpeech = frameEnergy(frame) >= this.options.speechThreshold;

    if (isSpeech) {
      this.#silentRun = 0;

      const ducking = this.options.duckingActive();
      if ((ducking || violations.bargeInWithoutDucking) && !this.#bargedIn) {
        this.#bargedIn = true;
        events.push({ type: 'barge_in', timestampMs: frame.timestampMs });
      }

      if (!this.#inSpeech) {
        this.#inSpeech = true;
        if (!violations.endWithoutStart) {
          events.push({ type: 'speech_start', timestampMs: frame.timestampMs });
        }
      }
    } else if (this.#inSpeech || violations.endWithoutStart) {
      this.#silentRun += 1;
      if (this.#silentRun >= hangover) {
        this.#inSpeech = false;
        this.#silentRun = 0;
        events.push({ type: 'speech_end', timestampMs: frame.timestampMs, confidence: 0.9 });
      }
    }

    return events;
  }

  reset(): void {
    if (this.fake.violations?.resetIsNoop) return;
    this.#inSpeech = false;
    this.#silentRun = 0;
    this.#bargedIn = false;
  }
}
