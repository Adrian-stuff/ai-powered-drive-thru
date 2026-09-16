import type { VadEvent, VadProvider } from '../../ports/vad.ts';
import { collect, patternFrames } from '../audio.ts';
import type { Check, ConformanceReport } from '../types.ts';
import { require, runChecks } from '../types.ts';
import { lifecycleChecks } from './provider.ts';

export interface VadConformanceOptions {
  create(): Promise<VadProvider> | VadProvider;
  /** Threshold the detector is created with. Defaults to a mid-scale value. */
  readonly speechThreshold?: number;
}

export const VAD_CHECK_NAMES = [
  'id_is_stable_and_non_empty',
  'capabilities_are_stable',
  'health_ok_after_init',
  'health_does_not_throw',
  'declares_frame_durations',
  'speech_end_follows_speech_start',
  'detects_speech_in_a_tone_burst',
  'timestamps_are_monotonic',
  'barge_in_only_while_ducking',
  'reset_clears_detector_state',
] as const;

/** `'..####....'` — two silent frames, a speech burst, then silence. */
const BURST = '..######....';

async function runPattern(
  provider: VadProvider,
  pattern: string,
  ducking: boolean,
  speechThreshold: number,
): Promise<VadEvent[]> {
  const detector = provider.createDetector({
    speechThreshold,
    silenceTimeoutMs: 550,
    duckingActive: () => ducking,
  });
  const events: VadEvent[] = [];
  for (const frame of await collect(patternFrames(pattern))) {
    events.push(...detector.push(frame));
  }
  return events;
}

function vadChecks(options: VadConformanceOptions): readonly Check<VadProvider>[] {
  const speechThreshold = options.speechThreshold ?? 0.2;

  return [
    ...lifecycleChecks<VadProvider>(),
    {
      name: 'declares_frame_durations',
      obligation: 'The AudioGateway sizes its frames from this.',
      async run(p) {
        require(p.capabilities.frameDurationsMs.length > 0, 'frameDurationsMs is empty');
        require(
          p.capabilities.frameDurationsMs.every((ms) => ms > 0),
          'frameDurationsMs contains a non-positive value',
        );
      },
    },
    {
      name: 'speech_end_follows_speech_start',
      obligation:
        'The orchestrator opens a turn on speech_start. An unpaired speech_end closes a turn that never opened.',
      async run(p) {
        const events = await runPattern(p, BURST, false, speechThreshold);
        let open = false;
        for (const e of events) {
          if (e.type === 'speech_start') {
            require(!open, 'speech_start emitted while already in speech');
            open = true;
          }
          if (e.type === 'speech_end') {
            require(open, 'speech_end emitted without a preceding speech_start');
            open = false;
          }
        }
      },
    },
    {
      name: 'detects_speech_in_a_tone_burst',
      obligation: 'A detector that never fires makes the lane deaf.',
      async run(p) {
        const events = await runPattern(p, BURST, false, speechThreshold);
        require(
          events.some((e) => e.type === 'speech_start'),
          'no speech_start for a clear tone burst above threshold',
        );
      },
    },
    {
      name: 'timestamps_are_monotonic',
      obligation: 'Every latency span is measured against these.',
      async run(p) {
        const events = await runPattern(p, BURST, false, speechThreshold);
        let previous = -1;
        for (const e of events) {
          require(e.timestampMs >= previous, `timestamp went backwards at ${e.type}`);
          previous = e.timestampMs;
        }
      },
    },
    {
      name: 'barge_in_only_while_ducking',
      obligation:
        'barge_in means "speech during our own playback". Firing it otherwise cancels turns at random.',
      async run(p) {
        const quiet = await runPattern(p, BURST, false, speechThreshold);
        require(
          !quiet.some((e) => e.type === 'barge_in'),
          'emitted barge_in while duckingActive() was false',
        );
        const ducked = await runPattern(p, BURST, true, speechThreshold);
        require(
          ducked.some((e) => e.type === 'barge_in'),
          'no barge_in for speech during playback — barge-in would not work',
        );
      },
    },
    {
      name: 'reset_clears_detector_state',
      obligation: 'Detectors are reused across turns; leftover state corrupts the next one.',
      async run(p) {
        const detector = p.createDetector({
          speechThreshold,
          silenceTimeoutMs: 550,
          duckingActive: () => false,
        });
        // Drive it into the middle of an utterance, then reset.
        for (const frame of await collect(patternFrames('..####'))) detector.push(frame);
        detector.reset();

        const after: VadEvent[] = [];
        for (const frame of await collect(patternFrames(BURST))) after.push(...detector.push(frame));
        const first = after[0];
        require(first !== undefined, 'detector produced no events after reset');
        require(
          first.type === 'speech_start',
          `after reset the first event was "${first.type}" — state leaked from the previous turn`,
        );
      },
    },
  ];
}

export async function runVadConformance(
  options: VadConformanceOptions,
): Promise<ConformanceReport> {
  const probe = await options.create();
  await probe.init();

  const isolated = vadChecks(options).map<Check<VadProvider>>((check) => ({
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

  const report = await runChecks('vad', probe.id, probe, isolated);
  await probe.dispose();
  return report;
}
