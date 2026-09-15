/**
 * Types shared by every port. Nothing vendor-specific may appear in this file
 * or in any sibling under `src/ports`.
 */

/** Raw PCM. Always mono; sample rate is negotiated by the AudioGateway. */
export interface AudioFrame {
  readonly pcm: Int16Array;
  readonly sampleRate: number;
  /** Monotonic ms since session start — the clock every span is measured against. */
  readonly timestampMs: number;
}

export interface AudioChunk {
  readonly bytes: Uint8Array;
  readonly encoding: 'pcm_s16le' | 'opus' | 'mp3';
  readonly sampleRate: number;
}

/**
 * Every port method that can block takes one of these. Cancellation is not
 * optional: barge-in must be able to kill an in-flight LLM call and an
 * in-flight TTS stream within one audio frame.
 */
export interface CallContext {
  readonly signal: AbortSignal;
  readonly sessionId: string;
  readonly turnId: string;
  /** Hard deadline from the latency budget. Adapters should honor it. */
  readonly deadlineMs: number;
  readonly locale: string;
}

/**
 * Normalized error taxonomy. Adapters translate vendor errors into these so the
 * circuit breaker and fallback chain can make decisions without knowing who
 * threw. `retryable` drives retry; `shouldTripBreaker` drives failover.
 */
export type ProviderErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'auth'
  | 'invalid_request'
  | 'content_filtered'
  | 'cancelled'
  | 'internal';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: {
      readonly provider: string;
      readonly retryable: boolean;
      readonly shouldTripBreaker: boolean;
      readonly cause?: unknown;
      readonly retryAfterMs?: number;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
  }
}

/** Implemented by every provider so the registry can health-check and report. */
export interface Provider<TCapabilities> {
  readonly id: string;
  readonly capabilities: TCapabilities;
  /** Load models, open sockets, warm caches. Called once at startup. */
  init(): Promise<void>;
  /** Cheap liveness probe. The Supervisor polls this; it must not allocate GPU. */
  health(): Promise<HealthStatus>;
  dispose(): Promise<void>;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly detail?: string;
  /** Round-trip of the probe itself, for dashboards. */
  readonly latencyMs?: number;
}
