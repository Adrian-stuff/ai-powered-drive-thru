import type { AudioChunk, CallContext, HealthStatus } from '../../common.ts';
import { ProviderError } from '../../common.ts';
import type { TtsCapabilities, TtsProvider, TtsRequest } from '../../ports/tts.ts';
import { sleep } from '../context.ts';

export interface FakeTtsOptions {
  readonly id?: string;
  readonly capabilities?: Partial<TtsCapabilities>;
  /** Audio chunks emitted per utterance. */
  readonly chunkCount?: number;
  /** ms per chunk. Raise it to make barge-in cancellation observable. */
  readonly chunkDelayMs?: number;
  readonly failWith?: ProviderError;

  /** See `FakeAsrOptions.violations`. */
  readonly violations?: {
    /** Emit an encoding not in `capabilities.outputEncodings`. */
    readonly undeclaredEncoding?: boolean;
    readonly emptyChunks?: boolean;
    readonly zeroSampleRate?: boolean;
    /** Keep talking over the customer after abort — the barge-in failure. */
    readonly ignoreAbort?: boolean;
  };
}

const DEFAULT_CAPABILITIES: TtsCapabilities = {
  supportsStreaming: true,
  supportsSsml: false,
  supportsIncrementalText: true,
  voices: [{ id: 'fake-voice', locale: 'en-US', displayName: 'Fake Voice' }],
  outputEncodings: ['pcm_s16le'],
};

export class FakeTtsProvider implements TtsProvider {
  readonly id: string;
  readonly capabilities: TtsCapabilities;

  /** Text passed to each call, resolved to a string even in incremental mode. */
  readonly spoken: string[] = [];
  initCount = 0;
  disposeCount = 0;

  #options: FakeTtsOptions;

  constructor(options: FakeTtsOptions = {}) {
    this.#options = options;
    this.id = options.id ?? 'fake-tts';
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

  async *synthesize(req: TtsRequest, ctx: CallContext): AsyncIterable<AudioChunk> {
    const violations = this.#options.violations ?? {};
    const chunkCount = this.#options.chunkCount ?? 3;
    const delayMs = this.#options.chunkDelayMs ?? 0;

    if (this.#options.failWith) throw this.#options.failWith;

    let text = '';
    if (typeof req.text === 'string') {
      text = req.text;
    } else {
      for await (const fragment of req.text) {
        text += fragment;
        if (ctx.signal.aborted && !violations.ignoreAbort) break;
      }
    }
    this.spoken.push(text);

    const declared = this.capabilities.outputEncodings[0] ?? 'pcm_s16le';
    for (let i = 0; i < chunkCount; i += 1) {
      if (ctx.signal.aborted && !violations.ignoreAbort) return;
      if (delayMs > 0) await sleep(delayMs);
      yield {
        bytes: violations.emptyChunks ? new Uint8Array(0) : new Uint8Array(640),
        encoding: violations.undeclaredEncoding ? 'mp3' : declared,
        sampleRate: violations.zeroSampleRate ? 0 : 16_000,
      };
    }
  }
}
