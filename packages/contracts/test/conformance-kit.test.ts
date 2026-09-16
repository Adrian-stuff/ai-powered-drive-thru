/**
 * Tests the conformance kit itself.
 *
 * A suite that passes everything is worthless. Each case here breaks one
 * contract obligation in a fake and asserts that the matching check — and
 * ideally only it — goes red. This is what lets us claim that "the adapter
 * passes conformance" means something.
 */
import { describe, expect, test } from 'bun:test';

import {
  FakeAsrProvider,
  FakeLlmProvider,
  FakeTtsProvider,
  FakeVadProvider,
  runAsrConformance,
  runLlmConformance,
  runTtsConformance,
  runVadConformance,
  type ConformanceReport,
} from '../src/testing/index.ts';

function failed(report: ConformanceReport): string[] {
  return report.results.filter((r) => !r.ok).map((r) => r.name);
}

describe('ASR checks catch violations', () => {
  test('a provider that never emits a final fails yields_a_final_transcript', async () => {
    const report = await runAsrConformance({
      create: () => new FakeAsrProvider({ violations: { neverFinal: true } }),
    });
    expect(failed(report)).toContain('yields_a_final_transcript');
    expect(report.ok).toBe(false);
  });

  test('a provider that yields after the final fails final_is_the_last_hypothesis', async () => {
    const report = await runAsrConformance({
      create: () => new FakeAsrProvider({ violations: { yieldAfterFinal: true } }),
    });
    expect(failed(report)).toContain('final_is_the_last_hypothesis');
  });

  test('out-of-range confidence fails confidence_within_zero_to_one', async () => {
    const report = await runAsrConformance({
      create: () => new FakeAsrProvider({ violations: { confidenceOutOfRange: true } }),
    });
    expect(failed(report)).toContain('confidence_within_zero_to_one');
  });

  test('claiming partials without emitting them fails emits_partials_before_final', async () => {
    const report = await runAsrConformance({
      create: () => new FakeAsrProvider({ violations: { noPartials: true } }),
    });
    expect(failed(report)).toContain('emits_partials_before_final');
  });

  test('ignoring the abort signal fails stops_promptly_on_abort', async () => {
    const report = await runAsrConformance({
      create: () =>
        new FakeAsrProvider({
          chunkDelayMs: 20,
          script: ['a b c d e f g h i j k l m n o p q r s t u v w x y z'],
          violations: { ignoreAbort: true },
        }),
      cancellationBudgetMs: 60,
    });
    expect(failed(report)).toContain('stops_promptly_on_abort');
  });
});

describe('LLM checks catch violations', () => {
  test('no done delta fails emits_exactly_one_done_delta', async () => {
    const report = await runLlmConformance({
      create: () => new FakeLlmProvider({ violations: { noDoneDelta: true } }),
    });
    expect(failed(report)).toContain('emits_exactly_one_done_delta');
  });

  test('two done deltas fails emits_exactly_one_done_delta', async () => {
    const report = await runLlmConformance({
      create: () => new FakeLlmProvider({ violations: { twoDoneDeltas: true } }),
    });
    expect(failed(report)).toContain('emits_exactly_one_done_delta');
  });

  test('done emitted first fails done_delta_is_last', async () => {
    const report = await runLlmConformance({
      create: () =>
        new FakeLlmProvider({
          script: [{ text: 'trailing text after done' }],
          violations: { doneNotLast: true },
        }),
    });
    expect(failed(report)).toContain('done_delta_is_last');
  });

  test('negative token usage fails reports_non_negative_usage', async () => {
    const report = await runLlmConformance({
      create: () => new FakeLlmProvider({ violations: { negativeUsage: true } }),
    });
    expect(failed(report)).toContain('reports_non_negative_usage');
  });

  test('a tool call with no id fails tool_calls_are_emitted_whole', async () => {
    const report = await runLlmConformance({
      create: () =>
        new FakeLlmProvider({
          respond: () => ({ toolCalls: [{ name: 'add_item', arguments: { sku: 'fries', quantity: 1 } }] }),
          violations: { toolCallMissingId: true },
        }),
    });
    expect(failed(report)).toContain('tool_calls_are_emitted_whole');
  });

  test('an invented tool name fails tool_call_names_come_from_the_request', async () => {
    const report = await runLlmConformance({
      create: () =>
        new FakeLlmProvider({
          respond: () => ({ toolCalls: [{ name: 'add_item', arguments: { sku: 'fries', quantity: 1 } }] }),
          violations: { hallucinateToolName: true },
        }),
    });
    expect(failed(report)).toContain('tool_call_names_come_from_the_request');
  });

  test('ignoring the abort signal fails stops_promptly_on_abort', async () => {
    const report = await runLlmConformance({
      create: () =>
        new FakeLlmProvider({
          tokenDelayMs: 20,
          script: [{ text: 'we have burgers and fries and drinks and pies and much much more today ' }],
          violations: { ignoreAbort: true },
        }),
      cancellationBudgetMs: 60,
    });
    expect(failed(report)).toContain('stops_promptly_on_abort');
  });
});

describe('TTS checks catch violations', () => {
  test('an undeclared encoding fails encoding_is_declared', async () => {
    const report = await runTtsConformance({
      create: () => new FakeTtsProvider({ violations: { undeclaredEncoding: true } }),
    });
    expect(failed(report)).toContain('encoding_is_declared');
  });

  test('empty audio chunks fail yields_non_empty_audio', async () => {
    const report = await runTtsConformance({
      create: () => new FakeTtsProvider({ violations: { emptyChunks: true } }),
    });
    expect(failed(report)).toContain('yields_non_empty_audio');
  });

  test('a zero sample rate fails sample_rate_is_positive', async () => {
    const report = await runTtsConformance({
      create: () => new FakeTtsProvider({ violations: { zeroSampleRate: true } }),
    });
    expect(failed(report)).toContain('sample_rate_is_positive');
  });

  test('audio after abort fails stops_promptly_on_abort — the barge-in failure', async () => {
    const report = await runTtsConformance({
      create: () =>
        new FakeTtsProvider({ chunkCount: 40, chunkDelayMs: 15, violations: { ignoreAbort: true } }),
      cancellationBudgetMs: 50,
    });
    expect(failed(report)).toContain('stops_promptly_on_abort');
  });
});

describe('VAD checks catch violations', () => {
  test('speech_end without speech_start fails speech_end_follows_speech_start', async () => {
    const report = await runVadConformance({
      create: () => new FakeVadProvider({ violations: { endWithoutStart: true } }),
    });
    expect(failed(report)).toContain('speech_end_follows_speech_start');
  });

  test('barge_in outside playback fails barge_in_only_while_ducking', async () => {
    const report = await runVadConformance({
      create: () => new FakeVadProvider({ violations: { bargeInWithoutDucking: true } }),
    });
    expect(failed(report)).toContain('barge_in_only_while_ducking');
  });

  test('a no-op reset fails reset_clears_detector_state', async () => {
    const report = await runVadConformance({
      create: () => new FakeVadProvider({ violations: { resetIsNoop: true } }),
    });
    expect(failed(report)).toContain('reset_clears_detector_state');
  });
});

describe('report semantics', () => {
  test('a skipped check is reported as skipped, not as a pass', async () => {
    const report = await runAsrConformance({
      create: () =>
        new FakeAsrProvider({
          capabilities: { supportsPartials: false, supportsWordTimestamps: false },
        }),
    });
    const partials = report.results.find((r) => r.name === 'emits_partials_before_final');
    expect(partials?.skipped).toBe(true);
    // A skip does not fail the suite, but it is distinguishable from a pass.
    expect(report.ok).toBe(true);
    expect(report.results.filter((r) => r.skipped && !r.detail)).toHaveLength(0);
  });

  test('a healthy fake passes every check', async () => {
    const report = await runAsrConformance({ create: () => new FakeAsrProvider() });
    expect(failed(report)).toEqual([]);
  });
});
