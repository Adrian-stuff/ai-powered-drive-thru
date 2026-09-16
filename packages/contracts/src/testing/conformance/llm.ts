import type { LlmDelta, LlmProvider, ToolDefinition } from '../../ports/llm.ts';
import { createTestContext, measureCancellation } from '../context.ts';
import type { Check, ConformanceReport } from '../types.ts';
import { require, runChecks, skipCheck } from '../types.ts';
import { lifecycleChecks } from './provider.ts';

export interface LlmConformanceOptions {
  create(): Promise<LlmProvider> | LlmProvider;
  readonly cancellationBudgetMs?: number;
}

/** A stand-in for the real order tools, shaped the same way (see docs/03 §1). */
const TEST_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'add_item',
    description: 'Add a menu item to the order.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['sku', 'quantity'],
    },
  },
  {
    name: 'finalize_order',
    description: 'Read the order back and finish.',
    parameters: { type: 'object', properties: {} },
  },
];

const STOP_REASONS = new Set(['stop', 'length', 'tool_use', 'content_filter', 'cancelled']);

async function drain(stream: AsyncIterable<LlmDelta>): Promise<LlmDelta[]> {
  const out: LlmDelta[] = [];
  for await (const d of stream) out.push(d);
  return out;
}

const HELLO = { messages: [{ role: 'user' as const, content: 'hi' }] };

export const LLM_CHECK_NAMES = [
  'id_is_stable_and_non_empty',
  'capabilities_are_stable',
  'health_ok_after_init',
  'health_does_not_throw',
  'declares_positive_limits',
  'emits_exactly_one_done_delta',
  'done_delta_is_last',
  'reports_non_negative_usage',
  'stop_reason_is_valid',
  'tool_calls_are_emitted_whole',
  'tool_call_names_come_from_the_request',
  'text_deltas_are_strings',
  'stops_promptly_on_abort',
] as const;

function llmChecks(options: LlmConformanceOptions): readonly Check<LlmProvider>[] {
  const budgetMs = options.cancellationBudgetMs ?? 250;

  return [
    ...lifecycleChecks<LlmProvider>(),
    {
      name: 'declares_positive_limits',
      obligation: 'The orchestrator sizes prompts against contextWindow and maxOutputTokens.',
      async run(p) {
        require(p.capabilities.contextWindow > 0, 'contextWindow must be positive');
        require(p.capabilities.maxOutputTokens > 0, 'maxOutputTokens must be positive');
      },
    },
    {
      name: 'emits_exactly_one_done_delta',
      obligation:
        'complete() must emit exactly one done delta unless aborted — the turn ends on it.',
      async run(p) {
        const { ctx } = createTestContext();
        const deltas = await drain(p.complete(HELLO, ctx));
        const done = deltas.filter((d) => d.type === 'done');
        require(done.length === 1, `expected exactly 1 done delta, got ${done.length}`);
      },
    },
    {
      name: 'done_delta_is_last',
      obligation: 'Nothing may follow done; the orchestrator stops reading once it arrives.',
      async run(p) {
        const { ctx } = createTestContext();
        const deltas = await drain(p.complete(HELLO, ctx));
        const last = deltas.at(-1);
        require(last !== undefined, 'stream yielded nothing');
        require(last.type === 'done', `last delta was "${last.type}", not "done"`);
      },
    },
    {
      name: 'reports_non_negative_usage',
      obligation: 'Token counts feed cost-per-order telemetry; negative values corrupt it.',
      async run(p) {
        const { ctx } = createTestContext();
        const deltas = await drain(p.complete(HELLO, ctx));
        const done = deltas.find((d) => d.type === 'done');
        require(done !== undefined, 'no done delta to read usage from');
        require(done.usage.inputTokens >= 0, `inputTokens is negative: ${done.usage.inputTokens}`);
        require(done.usage.outputTokens >= 0, `outputTokens is negative: ${done.usage.outputTokens}`);
      },
    },
    {
      name: 'stop_reason_is_valid',
      obligation: 'The orchestrator branches on stopReason; an unknown value is unhandleable.',
      async run(p) {
        const { ctx } = createTestContext();
        const deltas = await drain(p.complete(HELLO, ctx));
        const done = deltas.find((d) => d.type === 'done');
        require(done !== undefined, 'no done delta');
        require(STOP_REASONS.has(done.stopReason), `unknown stopReason "${done.stopReason}"`);
      },
    },
    {
      name: 'tool_calls_are_emitted_whole',
      obligation:
        'Adapters accumulate streamed argument JSON. The orchestrator must never see half a tool call.',
      async run(p) {
        if (!p.capabilities.supportsToolCalls) skipCheck('supportsToolCalls is false');
        const { ctx } = createTestContext();
        const deltas = await drain(
          p.complete(
            { messages: [{ role: 'user', content: 'one classic burger' }], tools: TEST_TOOLS },
            ctx,
          ),
        );
        const calls = deltas.filter((d) => d.type === 'tool_call');
        if (calls.length === 0) skipCheck('provider returned no tool calls for this prompt');
        for (const { call } of calls) {
          require(typeof call.id === 'string' && call.id.length > 0, 'tool call has an empty id');
          require(typeof call.name === 'string' && call.name.length > 0, 'tool call has an empty name');
          require(
            call.arguments !== null && typeof call.arguments === 'object' && !Array.isArray(call.arguments),
            `tool call "${call.name}" arguments is not an object — likely unparsed partial JSON`,
          );
        }
      },
    },
    {
      name: 'tool_call_names_come_from_the_request',
      obligation:
        'A call naming a tool we did not offer cannot be dispatched. Adapters must not invent names.',
      async run(p) {
        if (!p.capabilities.supportsToolCalls) skipCheck('supportsToolCalls is false');
        const { ctx } = createTestContext();
        const offered = new Set(TEST_TOOLS.map((t) => t.name));
        const deltas = await drain(
          p.complete(
            { messages: [{ role: 'user', content: 'one classic burger' }], tools: TEST_TOOLS },
            ctx,
          ),
        );
        const calls = deltas.filter((d) => d.type === 'tool_call');
        if (calls.length === 0) skipCheck('provider returned no tool calls for this prompt');
        for (const { call } of calls) {
          require(offered.has(call.name), `tool call "${call.name}" was not among the offered tools`);
        }
      },
    },
    {
      name: 'text_deltas_are_strings',
      obligation: 'Text deltas are concatenated straight into the TTS stream.',
      async run(p) {
        const { ctx } = createTestContext();
        const deltas = await drain(p.complete(HELLO, ctx));
        for (const d of deltas) {
          if (d.type === 'text') require(typeof d.text === 'string', 'text delta is not a string');
        }
      },
    },
    {
      name: 'stops_promptly_on_abort',
      obligation:
        'Barge-in must kill an in-flight generation. A provider that keeps going burns the turn.',
      async run(p) {
        const { ctx, abort } = createTestContext();
        const stream = p.complete(
          { messages: [{ role: 'user', content: 'tell me about the whole menu in detail' }], maxTokens: 512 },
          ctx,
        );
        const { msToStop, itemsAfterAbort } = await measureCancellation(stream, abort, {
          abortAfterItems: 1,
        });
        require(
          itemsAfterAbort === 0,
          `emitted ${itemsAfterAbort} delta(s) after abort — the provider ignored the signal`,
        );
        require(
          msToStop <= budgetMs,
          `took ${msToStop.toFixed(0)}ms to stop after abort (budget ${budgetMs}ms)`,
        );
      },
    },
  ];
}

export async function runLlmConformance(
  options: LlmConformanceOptions,
): Promise<ConformanceReport> {
  const probe = await options.create();
  await probe.init();

  const isolated = llmChecks(options).map<Check<LlmProvider>>((check) => ({
    name: check.name,
    obligation: check.obligation,
    async run() {
      const provider = await options.create();
      await provider.init();
      try {
        await check.run(provider);
      } finally {
        await provider.dispose();
      }
    },
  }));

  const report = await runChecks('llm', probe.id, probe, isolated);
  await probe.dispose();
  return report;
}

export { TEST_TOOLS };
