import type { AudioFrame, Provider } from '../common.ts';

export interface VadCapabilities {
  /** Emits a semantic "the utterance is complete" signal, not just silence. */
  readonly supportsSemanticEndpointing: boolean;
  readonly frameDurationsMs: readonly number[];
}

export type VadEvent =
  | { readonly type: 'speech_start'; readonly timestampMs: number }
  | { readonly type: 'speech_end'; readonly timestampMs: number; readonly confidence: number }
  /** Speech detected while our own TTS is playing. Cancels the turn. */
  | { readonly type: 'barge_in'; readonly timestampMs: number };

export interface VadProvider extends Provider<VadCapabilities> {
  /** Stateful per session; the runtime creates one detector per lane session. */
  createDetector(options: VadOptions): VadDetector;
}

export interface VadOptions {
  /** 0..1. Higher in noisy lanes (traffic, rain, idling diesel). */
  readonly speechThreshold: number;
  /** Silence before `speech_end` when semantic endpointing is unavailable. */
  readonly silenceTimeoutMs: number;
  /** True while TTS is playing, so the detector can emit `barge_in`. */
  readonly duckingActive: () => boolean;
}

export interface VadDetector {
  push(frame: AudioFrame): readonly VadEvent[];
  reset(): void;
}
