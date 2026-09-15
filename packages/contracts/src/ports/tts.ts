import type { AudioChunk, CallContext, Provider } from '../common.ts';

export interface TtsCapabilities {
  /** Streams audio before the full utterance is synthesized. Required for L0 latency. */
  readonly supportsStreaming: boolean;
  /** Accepts SSML or equivalent markup for pacing and emphasis. */
  readonly supportsSsml: boolean;
  /** Can start synthesizing from a partial text stream (sentence-by-sentence). */
  readonly supportsIncrementalText: boolean;
  readonly voices: readonly VoiceDescriptor[];
  readonly outputEncodings: readonly AudioChunk['encoding'][];
}

export interface VoiceDescriptor {
  readonly id: string;
  readonly locale: string;
  readonly displayName: string;
}

export interface TtsRequest {
  /**
   * Either the whole utterance, or a stream of text fragments when the
   * orchestrator is piping LLM output straight through (saves ~200 ms).
   */
  readonly text: string | AsyncIterable<string>;
  readonly voiceId: string;
  /** 1.0 = natural. Drive-thru audio is usually clearer slightly slowed. */
  readonly speakingRate?: number;
}

export interface TtsProvider extends Provider<TtsCapabilities> {
  /**
   * Yields audio chunks. Must abandon synthesis immediately on abort — a
   * barge-in that keeps talking over the customer is worse than no TTS.
   */
  synthesize(req: TtsRequest, ctx: CallContext): AsyncIterable<AudioChunk>;
}
