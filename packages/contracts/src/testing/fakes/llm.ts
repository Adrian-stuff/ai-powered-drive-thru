import type { CallContext, HealthStatus } from '../../common.ts';
import { ProviderError } from '../../common.ts';
import type {
  LlmCapabilities,
  LlmDelta,
  LlmProvider,
  LlmRequest,
  StopReason,
  ToolCall,
  TokenUsage,
} from '../../ports/llm.ts';
import { sleep } from '../context.ts';

export interface FakeLlmTurn {
  readonly text?: string;
  /** `id` is filled in automatically when omitted. */
  readonly toolCalls?: readonly (Omit<ToolCall, 'id'> & { id?: string })[];
  readonly usage?: Partial<TokenUsage>;
  readonly stopReason?: StopReason;
  readonly delayMs?: number;
}

export interface FakeLlmOptions {
  readonly id?: string;
  readonly capabilities?: Partial<LlmCapabilities>;
  /** Turns returned in order, one per `complete()` call. Last one repeats. */
  readonly script?: readonly FakeLlmTurn[];
  /**
   * Router keyed on the request — the useful mode for orchestrator tests, where
   * the response should depend on what the customer said. Wins over `script`.
   */
  readonly respond?: (req: LlmRequest) => FakeLlmTurn | undefined;
  /** ms per text delta. Raise it to make cancellation observable. */
  readonly tokenDelayMs?: number;
  readonly failWith?: ProviderError;

  /** See `FakeAsrOptions.violations`. */
  readonly violations?: {
    readonly noDoneDelta?: boolean;
    readonly twoDoneDeltas?: boolean;
    /** Emit `done` before the text, instead of last. */
    readonly doneNotLast?: boolean;
    /** Emit a tool call whose name is not in the request's tool list. */
    readonly hallucinateToolName?: boolean;
    /** Emit a tool call with a missing id — the "half a tool call" failure. */
    readonly toolCallMissingId?: boolean;
    readonly negativeUsage?: boolean;
    readonly ignoreAbort?: boolean;
  };
}

const DEFAULT_CAPABILITIES: LlmCapabilities = {
  supportsStreaming: true,
  supportsToolCalls: true,
  supportsStructuredOutput: true,
  supportsPrefixCaching: true,
  contextWindow: 32_768,
  maxOutputTokens: 1_024,
};

/**
 * Scripted LLM. The `respond` router is what makes end-to-end orchestrator
 * tests readable: map an utterance to the tool calls it should produce, then
 * assert on the resulting OrderState.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: LlmCapabilities;

  /** Every request received, for assertions about prompt construction. */
  readonly requests: LlmRequest[] = [];
  initCount = 0;
  disposeCount = 0;

  #callIndex = 0;
  #options: FakeLlmOptions;

  constructor(options: FakeLlmOptions = {}) {
    this.#options = options;
    this.id = options.id ?? 'fake-llm';
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

  async *complete(req: LlmRequest, ctx: CallContext): AsyncIterable<LlmDelta> {
    const violations = this.#options.violations ?? {};
    this.requests.push(req);

    if (this.#options.failWith) throw this.#options.failWith;

    const turn = this.#selectTurn(req);
    const usage: TokenUsage = {
      inputTokens: violations.negativeUsage ? -1 : (turn.usage?.inputTokens ?? 120),
      outputTokens: turn.usage?.outputTokens ?? 24,
      ...(turn.usage?.cachedInputTokens === undefined
        ? {}
        : { cachedInputTokens: turn.usage.cachedInputTokens }),
    };
    const stopReason: StopReason =
      turn.stopReason ?? (turn.toolCalls?.length ? 'tool_use' : 'stop');

    if (violations.doneNotLast) {
      yield { type: 'done', usage, stopReason };
    }

    if (turn.delayMs) await sleep(turn.delayMs);

    if (turn.text) {
      const delayMs = this.#options.tokenDelayMs ?? 0;
      for (const token of turn.text.split(/(?<=\s)/)) {
        if (ctx.signal.aborted && !violations.ignoreAbort) return;
        if (delayMs > 0) await sleep(delayMs);
        yield { type: 'text', text: token };
      }
    }

    for (const [i, call] of (turn.toolCalls ?? []).entries()) {
      if (ctx.signal.aborted && !violations.ignoreAbort) return;
      yield {
        type: 'tool_call',
        call: {
          id: violations.toolCallMissingId ? '' : (call.id ?? `call_${this.#callIndex}_${i}`),
          name: violations.hallucinateToolName ? 'definitely_not_a_real_tool' : call.name,
          arguments: call.arguments,
        },
      };
    }

    if (ctx.signal.aborted && !violations.ignoreAbort) return;
    // `doneNotLast` already emitted the done delta up front; emitting another
    // here would trip the "exactly one done" check instead of the ordering one.
    if (violations.noDoneDelta || violations.doneNotLast) return;

    yield { type: 'done', usage, stopReason };
    if (violations.twoDoneDeltas) {
      yield { type: 'done', usage, stopReason };
    }
  }

  #selectTurn(req: LlmRequest): FakeLlmTurn {
    const routed = this.#options.respond?.(req);
    if (routed) {
      this.#callIndex += 1;
      return routed;
    }
    const script = this.#options.script ?? [{ text: 'okay.' }];
    const turn = script[Math.min(this.#callIndex, script.length - 1)];
    this.#callIndex += 1;
    return turn ?? { text: 'okay.' };
  }
}

export function llmRateLimited(providerId = 'fake-llm'): ProviderError {
  return new ProviderError('rate_limited', 'fake LLM is rate limited', {
    provider: providerId,
    retryable: true,
    shouldTripBreaker: false,
    retryAfterMs: 1_000,
  });
}
