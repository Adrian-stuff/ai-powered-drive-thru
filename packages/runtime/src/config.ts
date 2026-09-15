/**
 * Provider wiring. A profile is the whole difference between running local,
 * cloud, or hybrid — see docs/02-swappability.md §4.
 */

export interface AdapterConfig {
  /** Key in the adapter registry, e.g. "faster-whisper", "anthropic", "piper". */
  readonly adapter: string;
  readonly options?: Record<string, unknown>;
  /** Used automatically when the primary's circuit breaker opens. */
  readonly fallback?: AdapterConfig;
  /**
   * Run in parallel on live traffic, discard the output, record the diff.
   * How a candidate provider gets evaluated before it ever speaks to a customer.
   */
  readonly shadow?: AdapterConfig;
}

export type PortName = 'asr' | 'llm' | 'tts' | 'vad' | 'pos' | 'menu' | 'telemetry' | 'sessionStore';

export interface ResiliencePolicy {
  /** Hard deadline, from docs/04-latency-budget.md. */
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly breaker: {
    /** Consecutive failures before the breaker opens. */
    readonly failureThreshold: number;
    /** p95 latency breach (ms) that also counts as a failure. */
    readonly latencyThresholdMs: number;
    readonly resetAfterMs: number;
  };
}

export interface RuntimeConfig {
  readonly profile: string;
  readonly storeId: string;
  readonly providers: Readonly<Record<PortName, AdapterConfig>>;
  readonly resilience: Readonly<Partial<Record<PortName, ResiliencePolicy>>>;
}
