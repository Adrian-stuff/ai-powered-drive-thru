import type { CallContext, Provider } from '../common.ts';

export interface LlmCapabilities {
  readonly supportsStreaming: boolean;
  /** Native tool/function calling. Without it, the adapter must emulate via JSON mode. */
  readonly supportsToolCalls: boolean;
  /** Can constrain output to a JSON schema / grammar. Local llama.cpp and vLLM can. */
  readonly supportsStructuredOutput: boolean;
  /** Prompt caching or prefix reuse — worth ~100 ms/turn when present. */
  readonly supportsPrefixCaching: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
}

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  readonly role: Role;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. Frozen per tool version — see docs/02-swappability.md §7. */
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface LlmRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Forces schema-valid output where the provider supports it. */
  readonly responseSchema?: Record<string, unknown>;
}

export type LlmDelta =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | { readonly type: 'done'; readonly usage: TokenUsage; readonly stopReason: StopReason };

export type StopReason = 'stop' | 'length' | 'tool_use' | 'content_filter' | 'cancelled';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
}

export interface LlmProvider extends Provider<LlmCapabilities> {
  /**
   * Streams deltas. Must emit exactly one `done` delta unless aborted. Tool
   * calls are emitted whole — the adapter is responsible for accumulating
   * partial JSON from providers that stream arguments token by token, so the
   * orchestrator never sees half a tool call.
   */
  complete(req: LlmRequest, ctx: CallContext): AsyncIterable<LlmDelta>;
}
