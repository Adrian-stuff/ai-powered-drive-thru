import type { AudioFrame, CallContext, Provider } from '../common.ts';

export interface AsrCapabilities {
  /** Can emit interim hypotheses. Without this, budget ~120 ms more per turn. */
  readonly supportsPartials: boolean;
  /** Has usable built-in endpointing, so we can skip the separate VAD port. */
  readonly supportsEndpointing: boolean;
  /** Accepts a per-request vocabulary bias (menu items, LTO names). Big accuracy win. */
  readonly supportsVocabularyBias: boolean;
  readonly supportsWordTimestamps: boolean;
  readonly locales: readonly string[];
  readonly sampleRates: readonly number[];
}

export interface Transcript {
  readonly text: string;
  readonly isFinal: boolean;
  /** 0..1. The orchestrator uses this to decide whether to ask for confirmation. */
  readonly confidence: number;
  readonly words?: readonly TranscriptWord[];
  /** Measured from end-of-speech to emission, for the latency budget. */
  readonly latencyMs?: number;
}

export interface TranscriptWord {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
}

export interface AsrRequest {
  readonly audio: AsyncIterable<AudioFrame>;
  /**
   * Menu items, modifier names, and active LTOs. Providers that support biasing
   * get a large accuracy lift on brand terms ("McFlurry", "Baconator").
   * Providers that do not must ignore this rather than fail.
   */
  readonly vocabularyBias?: readonly string[];
}

export interface AsrProvider extends Provider<AsrCapabilities> {
  /**
   * Consumes an audio stream and yields hypotheses. Must yield at least one
   * `isFinal: true` transcript before completing, and must stop promptly when
   * `ctx.signal` aborts.
   */
  transcribe(req: AsrRequest, ctx: CallContext): AsyncIterable<Transcript>;
}
