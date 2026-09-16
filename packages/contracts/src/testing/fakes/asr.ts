import type { AudioFrame, HealthStatus } from '../../common.ts';
import { ProviderError } from '../../common.ts';
import type { AsrCapabilities, AsrProvider, AsrRequest, Transcript } from '../../ports/asr.ts';
import type { CallContext } from '../../common.ts';
import { sleep } from '../context.ts';

export interface FakeAsrOptions {
  readonly id?: string;
  readonly capabilities?: Partial<AsrCapabilities>;
  /** One utterance per `transcribe()` call, in order. Repeats the last when exhausted. */
  readonly script?: readonly string[];
  /** Delay between emitted hypotheses. Raise it to make cancellation observable. */
  readonly chunkDelayMs?: number;
  readonly finalConfidence?: number;
  readonly partialConfidence?: number;
  readonly failWith?: ProviderError;

  /**
   * Contract violations, for testing the conformance kit itself. Production
   * fakes leave these off; `test/conformance-kit.test.ts` turns them on to
   * prove each check actually catches what it claims to.
   */
  readonly violations?: {
    /** Complete the stream without ever emitting `isFinal: true`. */
    readonly neverFinal?: boolean;
    /** Keep yielding after the final hypothesis. */
    readonly yieldAfterFinal?: boolean;
    /** Report confidence outside 0..1. */
    readonly confidenceOutOfRange?: boolean;
    /** Ignore `ctx.signal` and keep streaming. */
    readonly ignoreAbort?: boolean;
    /** Claim partial support but only ever emit the final. */
    readonly noPartials?: boolean;
  };
}

const DEFAULT_CAPABILITIES: AsrCapabilities = {
  supportsPartials: true,
  supportsEndpointing: false,
  supportsVocabularyBias: true,
  supportsWordTimestamps: true,
  locales: ['en-US'],
  sampleRates: [16_000],
};

/**
 * Scripted ASR. Emits cumulative word-by-word partials then a final, so
 * orchestrator tests can exercise speculative prefill without a GPU.
 */
export class FakeAsrProvider implements AsrProvider {
  readonly id: string;
  readonly capabilities: AsrCapabilities;

  /** Assertion surface for tests. */
  readonly calls: { vocabularyBias?: readonly string[]; framesConsumed: number }[] = [];
  initCount = 0;
  disposeCount = 0;

  #script: readonly string[];
  #callIndex = 0;
  #options: FakeAsrOptions;

  constructor(options: FakeAsrOptions = {}) {
    this.#options = options;
    this.id = options.id ?? 'fake-asr';
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.#script = options.script ?? ['i will take a number three with a coke'];
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

  /** Queue a transcript for the next `transcribe()` call. */
  enqueue(utterance: string): void {
    this.#script = [...this.#script, utterance];
  }

  async *transcribe(req: AsrRequest, ctx: CallContext): AsyncIterable<Transcript> {
    const violations = this.#options.violations ?? {};
    const delayMs = this.#options.chunkDelayMs ?? 0;
    const index = Math.min(this.#callIndex, this.#script.length - 1);
    this.#callIndex += 1;

    const call = {
      ...(req.vocabularyBias ? { vocabularyBias: req.vocabularyBias } : {}),
      framesConsumed: 0,
    };
    this.calls.push(call);

    if (this.#options.failWith) throw this.#options.failWith;

    // Consume input concurrently so the caller's stream is actually drained,
    // the way a real streaming adapter would.
    const drain = (async () => {
      for await (const _frame of req.audio as AsyncIterable<AudioFrame>) {
        call.framesConsumed += 1;
        if (ctx.signal.aborted && !violations.ignoreAbort) break;
      }
    })();
    void drain.catch(() => undefined);

    const utterance = this.#script[index] ?? '';
    const words = utterance.split(' ').filter(Boolean);

    if (this.capabilities.supportsPartials && !violations.noPartials) {
      for (let i = 1; i <= words.length; i += 1) {
        if (ctx.signal.aborted && !violations.ignoreAbort) return;
        if (delayMs > 0) await sleep(delayMs);
        yield {
          text: words.slice(0, i).join(' '),
          isFinal: false,
          confidence: violations.confidenceOutOfRange
            ? 1.4
            : (this.#options.partialConfidence ?? 0.7),
        };
      }
    }

    if (ctx.signal.aborted && !violations.ignoreAbort) return;
    if (delayMs > 0) await sleep(delayMs);

    if (violations.neverFinal) return;

    yield {
      text: utterance,
      isFinal: true,
      confidence: violations.confidenceOutOfRange ? -0.2 : (this.#options.finalConfidence ?? 0.94),
      latencyMs: 40,
      ...(this.capabilities.supportsWordTimestamps
        ? {
            words: words.map((text, i) => ({
              text,
              startMs: i * 120,
              endMs: (i + 1) * 120,
              confidence: 0.9,
            })),
          }
        : {}),
    };

    if (violations.yieldAfterFinal) {
      yield { text: 'trailing garbage', isFinal: false, confidence: 0.5 };
    }
  }
}

export function asrUnavailable(providerId = 'fake-asr'): ProviderError {
  return new ProviderError('unavailable', 'fake ASR is down', {
    provider: providerId,
    retryable: true,
    shouldTripBreaker: true,
  });
}
