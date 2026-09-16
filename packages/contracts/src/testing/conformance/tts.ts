import type { AudioChunk } from '../../common.ts';
import type { TtsProvider } from '../../ports/tts.ts';
import { createTestContext, measureCancellation, sleep } from '../context.ts';
import type { Check, ConformanceReport } from '../types.ts';
import { require, runChecks, skipCheck } from '../types.ts';
import { lifecycleChecks } from './provider.ts';

export interface TtsConformanceOptions {
  create(): Promise<TtsProvider> | TtsProvider;
  /**
   * Tighter than the other ports by default: TTS cancellation *is* barge-in.
   * Audio that keeps playing after abort is the customer being talked over.
   */
  readonly cancellationBudgetMs?: number;
}

async function drain(stream: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

export const TTS_CHECK_NAMES = [
  'id_is_stable_and_non_empty',
  'capabilities_are_stable',
  'health_ok_after_init',
  'health_does_not_throw',
  'declares_voices_and_encodings',
  'yields_non_empty_audio',
  'encoding_is_declared',
  'sample_rate_is_positive',
  'accepts_incremental_text',
  'stops_promptly_on_abort',
] as const;

function firstVoice(p: TtsProvider): string {
  const voice = p.capabilities.voices[0];
  require(voice !== undefined, 'capabilities.voices is empty');
  return voice.id;
}

function ttsChecks(options: TtsConformanceOptions): readonly Check<TtsProvider>[] {
  const budgetMs = options.cancellationBudgetMs ?? 150;

  return [
    ...lifecycleChecks<TtsProvider>(),
    {
      name: 'declares_voices_and_encodings',
      obligation: 'The orchestrator picks a voice and the AudioGateway decodes by encoding.',
      async run(p) {
        require(p.capabilities.voices.length > 0, 'capabilities.voices is empty');
        require(p.capabilities.outputEncodings.length > 0, 'capabilities.outputEncodings is empty');
      },
    },
    {
      name: 'yields_non_empty_audio',
      obligation: 'Silence in response to a customer is indistinguishable from a broken lane.',
      async run(p) {
        const { ctx } = createTestContext();
        const chunks = await drain(
          p.synthesize({ text: 'Okay, one classic burger.', voiceId: firstVoice(p) }, ctx),
        );
        require(chunks.length > 0, 'synthesize() yielded no audio chunks');
        require(
          chunks.some((c) => c.bytes.byteLength > 0),
          'every chunk was empty',
        );
      },
    },
    {
      name: 'encoding_is_declared',
      obligation:
        'The AudioGateway is configured from capabilities. An undeclared encoding plays as noise.',
      async run(p) {
        const { ctx } = createTestContext();
        const declared = new Set<AudioChunk['encoding']>(p.capabilities.outputEncodings);
        const chunks = await drain(p.synthesize({ text: 'Anything else?', voiceId: firstVoice(p) }, ctx));
        for (const c of chunks) {
          require(declared.has(c.encoding), `emitted undeclared encoding "${c.encoding}"`);
        }
      },
    },
    {
      name: 'sample_rate_is_positive',
      obligation: 'The output resampler divides by it.',
      async run(p) {
        const { ctx } = createTestContext();
        const chunks = await drain(p.synthesize({ text: 'Anything else?', voiceId: firstVoice(p) }, ctx));
        for (const c of chunks) require(c.sampleRate > 0, `sampleRate is ${c.sampleRate}`);
      },
    },
    {
      name: 'accepts_incremental_text',
      obligation:
        'Piping LLM text straight through saves ~200 ms. A provider declaring it must consume the stream.',
      async run(p) {
        if (!p.capabilities.supportsIncrementalText) skipCheck('supportsIncrementalText is false');
        const { ctx } = createTestContext();
        async function* fragments(): AsyncIterable<string> {
          yield 'Okay, ';
          await sleep(5);
          yield 'one classic burger.';
        }
        const chunks = await drain(p.synthesize({ text: fragments(), voiceId: firstVoice(p) }, ctx));
        require(chunks.length > 0, 'yielded no audio for incremental text input');
      },
    },
    {
      name: 'stops_promptly_on_abort',
      obligation:
        'This is barge-in. Audio emitted after abort is the system talking over the customer — ADR-0003.',
      async run(p) {
        const { ctx, abort } = createTestContext();
        const stream = p.synthesize(
          {
            text: 'Okay, that is one classic burger, a large fries, and a medium cola. Anything else for you today?',
            voiceId: firstVoice(p),
          },
          ctx,
        );
        const { msToStop, itemsAfterAbort } = await measureCancellation(stream, abort, {
          abortAfterItems: 1,
        });
        require(
          itemsAfterAbort === 0,
          `emitted ${itemsAfterAbort} audio chunk(s) after abort — this talks over the customer`,
        );
        require(
          msToStop <= budgetMs,
          `took ${msToStop.toFixed(0)}ms to stop after abort (budget ${budgetMs}ms)`,
        );
      },
    },
  ];
}

export async function runTtsConformance(
  options: TtsConformanceOptions,
): Promise<ConformanceReport> {
  const probe = await options.create();
  await probe.init();

  const isolated = ttsChecks(options).map<Check<TtsProvider>>((check) => ({
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

  const report = await runChecks('tts', probe.id, probe, isolated);
  await probe.dispose();
  return report;
}
