import type { CallContext } from '../common.ts';

export interface TestContextHandle {
  readonly ctx: CallContext;
  /** Fires `ctx.signal`, exactly as a barge-in would. */
  abort(): void;
}

export function createTestContext(overrides: Partial<CallContext> = {}): TestContextHandle {
  const controller = new AbortController();
  const ctx: CallContext = {
    signal: controller.signal,
    sessionId: overrides.sessionId ?? 'test-session',
    turnId: overrides.turnId ?? 'test-turn',
    deadlineMs: overrides.deadlineMs ?? 5_000,
    locale: overrides.locale ?? 'en-US',
  };
  return { ctx, abort: () => controller.abort() };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drains an async iterable but aborts partway through, and reports how long the
 * provider took to actually stop. This is the barge-in measurement: a provider
 * that keeps yielding after abort is one that talks over the customer.
 */
export async function measureCancellation<T>(
  stream: AsyncIterable<T>,
  abort: () => void,
  options: { abortAfterItems?: number; abortAfterMs?: number } = {},
): Promise<{ msToStop: number; itemsAfterAbort: number; threw: unknown }> {
  const abortAfterItems = options.abortAfterItems ?? 1;
  let seen = 0;
  let abortedAt: number | undefined;
  let itemsAfterAbort = 0;
  let threw: unknown;

  const timer =
    options.abortAfterMs === undefined
      ? undefined
      : setTimeout(() => {
          abortedAt ??= performance.now();
          abort();
        }, options.abortAfterMs);

  try {
    for await (const _ of stream) {
      seen += 1;
      if (abortedAt !== undefined) {
        itemsAfterAbort += 1;
      } else if (options.abortAfterMs === undefined && seen >= abortAfterItems) {
        abortedAt = performance.now();
        abort();
      }
    }
  } catch (error) {
    threw = error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (abortedAt === undefined) {
    // The stream ended before we could abort — not a cancellation measurement.
    return { msToStop: 0, itemsAfterAbort: 0, threw };
  }
  return { msToStop: performance.now() - abortedAt, itemsAfterAbort, threw };
}
