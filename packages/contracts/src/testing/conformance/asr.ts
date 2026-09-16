import type { AsrProvider, Transcript } from '../../ports/asr.ts';
import { endlessFrames, patternFrames, silenceFrames } from '../audio.ts';
import { createTestContext, measureCancellation } from '../context.ts';
import type { Check, ConformanceReport } from '../types.ts';
import { require, runChecks, skipCheck } from '../types.ts';
import { lifecycleChecks } from './provider.ts';

export interface AsrConformanceOptions {
  /** A fresh, already-initialized provider. Called once per check. */
  create(): Promise<AsrProvider> | AsrProvider;
  /**
   * Budget for stopping after abort. Barge-in depends on this; the default is
   * one 20 ms frame plus generous slack.
   */
  readonly cancellationBudgetMs?: number;
}

async function drain(
  stream: AsyncIterable<Transcript>,
): Promise<Transcript[]> {
  const out: Transcript[] = [];
  for await (const t of stream) out.push(t);
  return out;
}

export const ASR_CHECK_NAMES = [
  'id_is_stable_and_non_empty',
  'capabilities_are_stable',
  'health_ok_after_init',
  'health_does_not_throw',
  'declares_locales_and_sample_rates',
  'yields_a_final_transcript',
  'final_is_the_last_hypothesis',
  'confidence_within_zero_to_one',
  'emits_partials_before_final',
  'word_timestamps_are_monotonic',
  'tolerates_vocabulary_bias',
  'empty_audio_terminates',
  'stops_promptly_on_abort',
] as const;

function asrChecks(options: AsrConformanceOptions): readonly Check<AsrProvider>[] {
  const budgetMs = options.cancellationBudgetMs ?? 250;

  return [
    ...lifecycleChecks<AsrProvider>(),
    {
      name: 'declares_locales_and_sample_rates',
      obligation: 'The AudioGateway negotiates sample rate from capabilities; empty lists are unusable.',
      async run(p) {
        require(p.capabilities.locales.length > 0, 'capabilities.locales is empty');
        require(p.capabilities.sampleRates.length > 0, 'capabilities.sampleRates is empty');
      },
    },
    {
      name: 'yields_a_final_transcript',
      obligation:
        'transcribe() must yield at least one isFinal:true before completing — the orchestrator blocks on it.',
      async run(p) {
        const { ctx } = createTestContext();
        const results = await drain(p.transcribe({ audio: patternFrames('..####..') }, ctx));
        require(results.some((t) => t.isFinal), 'stream completed without any isFinal:true transcript');
      },
    },
    {
      name: 'final_is_the_last_hypothesis',
      obligation:
        'Nothing may follow the final. The orchestrator commits the turn on it and stops reading.',
      async run(p) {
        const { ctx } = createTestContext();
        const results = await drain(p.transcribe({ audio: patternFrames('..####..') }, ctx));
        const last = results.at(-1);
        require(last !== undefined, 'stream yielded nothing');
        require(last.isFinal, `last hypothesis was not final: ${JSON.stringify(last)}`);
      },
    },
    {
      name: 'confidence_within_zero_to_one',
      obligation:
        'The orchestrator thresholds on confidence to decide whether to ask for confirmation.',
      async run(p) {
        const { ctx } = createTestContext();
        const results = await drain(p.transcribe({ audio: patternFrames('..####..') }, ctx));
        for (const t of results) {
          require(
            Number.isFinite(t.confidence) && t.confidence >= 0 && t.confidence <= 1,
            `confidence ${t.confidence} is outside 0..1`,
          );
        }
      },
    },
    {
      name: 'emits_partials_before_final',
      obligation:
        'A provider declaring supportsPartials must actually emit them — speculative prefill depends on it.',
      async run(p) {
        if (!p.capabilities.supportsPartials) skipCheck('supportsPartials is false');
        const { ctx } = createTestContext();
        const results = await drain(p.transcribe({ audio: patternFrames('..####..') }, ctx));
        const firstFinal = results.findIndex((t) => t.isFinal);
        require(firstFinal > 0, 'declared supportsPartials but emitted no non-final hypothesis first');
      },
    },
    {
      name: 'word_timestamps_are_monotonic',
      obligation: 'Word timings drive barge-in attribution and eval alignment.',
      async run(p) {
        if (!p.capabilities.supportsWordTimestamps) skipCheck('supportsWordTimestamps is false');
        const { ctx } = createTestContext();
        const results = await drain(p.transcribe({ audio: patternFrames('..####..') }, ctx));
        const final = results.find((t) => t.isFinal);
        require(final?.words !== undefined, 'declared word timestamps but final has no words');
        let previousEnd = -1;
        for (const w of final.words) {
          require(w.startMs >= previousEnd, `word "${w.text}" starts before the previous word ends`);
          require(w.endMs >= w.startMs, `word "${w.text}" ends before it starts`);
          previousEnd = w.endMs;
        }
      },
    },
    {
      name: 'tolerates_vocabulary_bias',
      obligation:
        'The orchestrator always sends menu vocabulary. A provider that cannot use it must ignore it, not fail.',
      async run(p) {
        const { ctx } = createTestContext();
        const results = await drain(
          p.transcribe(
            { audio: patternFrames('..####..'), vocabularyBias: ['McFlurry', 'Baconator', 'combo three'] },
            ctx,
          ),
        );
        require(results.some((t) => t.isFinal), 'vocabulary bias suppressed the final transcript');
      },
    },
    {
      name: 'empty_audio_terminates',
      obligation: 'A car that pulls away mid-turn yields no frames. The stream must end, not hang.',
      async run(p) {
        const { ctx } = createTestContext();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const finished = await Promise.race([
            drain(p.transcribe({ audio: silenceFrames(0) }, ctx)).then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), 2_000);
            }),
          ]);
          require(finished, 'transcribe() did not terminate within 2s on empty audio');
        } finally {
          // Leaving this pending keeps the runner's event loop warm for 2s per check.
          if (timer !== undefined) clearTimeout(timer);
        }
      },
    },
    {
      name: 'stops_promptly_on_abort',
      obligation:
        'Barge-in aborts ctx.signal. The provider must stop within one frame — see ADR-0003.',
      async run(p) {
        const { ctx, abort } = createTestContext();
        const stream = p.transcribe({ audio: endlessFrames({ realtimeFactor: 1 }) }, ctx);
        const { msToStop, itemsAfterAbort } = await measureCancellation(stream, abort, {
          abortAfterItems: 1,
        });
        require(
          itemsAfterAbort === 0,
          `yielded ${itemsAfterAbort} transcript(s) after abort — the provider ignored the signal`,
        );
        require(
          msToStop <= budgetMs,
          `took ${msToStop.toFixed(0)}ms to stop after abort (budget ${budgetMs}ms)`,
        );
      },
    },
  ];
}

export async function runAsrConformance(
  options: AsrConformanceOptions,
): Promise<ConformanceReport> {
  const probe = await options.create();
  await probe.init();
  const checks = asrChecks(options);

  // Each check gets a fresh provider: scripted fakes and real adapters alike
  // carry per-call state, and a check must not be able to poison the next one.
  const isolated = checks.map<Check<AsrProvider>>((check) => ({
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

  const report = await runChecks('asr', probe.id, probe, isolated);
  await probe.dispose();
  return report;
}

