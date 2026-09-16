import type { AudioFrame } from '../common.ts';

export const DEFAULT_SAMPLE_RATE = 16_000;
export const DEFAULT_FRAME_MS = 20;

export interface FrameStreamOptions {
  readonly sampleRate?: number;
  readonly frameMs?: number;
  /** Wall-clock pacing. Leave 0 for fast tests; set it to observe cancellation. */
  readonly realtimeFactor?: number;
  readonly startTimestampMs?: number;
}

function samplesPerFrame(sampleRate: number, frameMs: number): number {
  return Math.round((sampleRate * frameMs) / 1000);
}

export function silenceFrame(index: number, options: FrameStreamOptions = {}): AudioFrame {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  return {
    pcm: new Int16Array(samplesPerFrame(sampleRate, frameMs)),
    sampleRate,
    timestampMs: (options.startTimestampMs ?? 0) + index * frameMs,
  };
}

/** A frame with energy in it — the fake VAD reads this as speech. */
export function toneFrame(index: number, options: FrameStreamOptions = {}): AudioFrame {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const count = samplesPerFrame(sampleRate, frameMs);
  const pcm = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    pcm[i] = Math.round(12_000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  return {
    pcm,
    sampleRate,
    timestampMs: (options.startTimestampMs ?? 0) + index * frameMs,
  };
}

/**
 * `pattern` is a string of `.` (silence) and `#` (speech), one char per frame —
 * e.g. `'..####..'`. Readable test audio without WAV fixtures.
 */
export async function* patternFrames(
  pattern: string,
  options: FrameStreamOptions = {},
): AsyncIterable<AudioFrame> {
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const realtimeFactor = options.realtimeFactor ?? 0;
  for (let i = 0; i < pattern.length; i += 1) {
    if (realtimeFactor > 0) {
      await new Promise((resolve) => setTimeout(resolve, frameMs * realtimeFactor));
    }
    yield pattern[i] === '#' ? toneFrame(i, options) : silenceFrame(i, options);
  }
}

export async function* silenceFrames(
  count: number,
  options: FrameStreamOptions = {},
): AsyncIterable<AudioFrame> {
  yield* patternFrames('.'.repeat(count), options);
}

export async function* speechFrames(
  count: number,
  options: FrameStreamOptions = {},
): AsyncIterable<AudioFrame> {
  yield* patternFrames('#'.repeat(count), options);
}

/**
 * Never ends until the signal aborts. Used by the cancellation checks: a
 * provider that only stops because its input ran out has not proven anything.
 */
export async function* endlessFrames(options: FrameStreamOptions = {}): AsyncIterable<AudioFrame> {
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const realtimeFactor = options.realtimeFactor ?? 1;
  for (let i = 0; ; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, frameMs * realtimeFactor)));
    yield toneFrame(i, options);
  }
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

/** Peak absolute amplitude, normalized 0..1. The fake VAD's energy measure. */
export function frameEnergy(frame: AudioFrame): number {
  let peak = 0;
  for (const sample of frame.pcm) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak / 32_768;
}
