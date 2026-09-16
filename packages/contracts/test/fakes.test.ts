/**
 * Behavior of the fakes themselves — the parts that exist to make *other*
 * tests expressive, and so are not covered by the conformance suites.
 */
import { describe, expect, test } from 'bun:test';

import type { MenuSnapshot, OrderState, VadEvent } from '../src/index.ts';
import {
  FakeAsrProvider,
  FakeLlmProvider,
  FakeMenuSource,
  FakePosProvider,
  FakeTtsProvider,
  FakeVadProvider,
  SAMPLE_ORDER,
  TEST_MENU,
  collect,
  createTestContext,
  patternFrames,
} from '../src/testing/index.ts';

const order = SAMPLE_ORDER as unknown as OrderState;

describe('FakeAsrProvider', () => {
  test('emits cumulative partials then the scripted final', async () => {
    const asr = new FakeAsrProvider({ script: ['two apple pies'] });
    await asr.init();
    const { ctx } = createTestContext();
    const results = await collect(asr.transcribe({ audio: patternFrames('..###') }, ctx));

    expect(results.map((r) => r.text)).toEqual([
      'two',
      'two apple',
      'two apple pies',
      'two apple pies',
    ]);
    expect(results.at(-1)?.isFinal).toBe(true);
  });

  test('records the vocabulary bias it was given, for prompt-construction assertions', async () => {
    const asr = new FakeAsrProvider();
    await asr.init();
    const { ctx } = createTestContext();
    await collect(
      asr.transcribe({ audio: patternFrames('###'), vocabularyBias: ['number three'] }, ctx),
    );
    expect(asr.calls[0]?.vocabularyBias).toEqual(['number three']);
  });

  test('drains the caller audio stream, as a streaming adapter would', async () => {
    const asr = new FakeAsrProvider();
    await asr.init();
    const { ctx } = createTestContext();
    await collect(asr.transcribe({ audio: patternFrames('......####......') }, ctx));
    // Give the concurrent drain a tick to finish.
    await new Promise((r) => setTimeout(r, 10));
    expect(asr.calls[0]?.framesConsumed).toBeGreaterThan(0);
  });
});

describe('FakeLlmProvider', () => {
  test('the respond router keys off the request, so orders map to tool calls', async () => {
    const llm = new FakeLlmProvider({
      respond: (req) => {
        const said = req.messages.at(-1)?.content ?? '';
        if (said.includes('pie')) {
          return { toolCalls: [{ name: 'add_item', arguments: { sku: 'apple_pie', quantity: 2 } }] };
        }
        return { text: 'sorry, what was that? ' };
      },
    });
    await llm.init();
    const { ctx } = createTestContext();

    const ordered = await collect(
      llm.complete({ messages: [{ role: 'user', content: 'two apple pies' }] }, ctx),
    );
    const call = ordered.find((d) => d.type === 'tool_call');
    expect(call?.call.name).toBe('add_item');
    expect(call?.call.arguments).toEqual({ sku: 'apple_pie', quantity: 2 });

    const confused = await collect(
      llm.complete({ messages: [{ role: 'user', content: 'mmhmm' }] }, ctx),
    );
    expect(confused.some((d) => d.type === 'tool_call')).toBe(false);
  });

  test('records every request, so prompt structure can be asserted', async () => {
    const llm = new FakeLlmProvider();
    await llm.init();
    const { ctx } = createTestContext();
    await collect(llm.complete({ messages: [{ role: 'system', content: 'you are a drive-thru' }] }, ctx));
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.messages[0]?.role).toBe('system');
  });

  test('a script advances one turn per call and holds on the last', async () => {
    const llm = new FakeLlmProvider({ script: [{ text: 'first ' }, { text: 'second ' }] });
    await llm.init();
    const { ctx } = createTestContext();
    const say = async () =>
      (await collect(llm.complete({ messages: [{ role: 'user', content: 'x' }] }, ctx)))
        .filter((d) => d.type === 'text')
        .map((d) => d.text)
        .join('');

    expect(await say()).toBe('first ');
    expect(await say()).toBe('second ');
    expect(await say()).toBe('second ');
  });
});

describe('FakeTtsProvider', () => {
  test('resolves incremental text into the spoken log', async () => {
    const tts = new FakeTtsProvider();
    await tts.init();
    const { ctx } = createTestContext();
    async function* fragments() {
      yield 'Okay, ';
      yield 'anything else?';
    }
    await collect(tts.synthesize({ text: fragments(), voiceId: 'fake-voice' }, ctx));
    expect(tts.spoken).toEqual(['Okay, anything else?']);
  });
});

describe('FakeVadProvider', () => {
  async function eventsFor(pattern: string, ducking = false): Promise<VadEvent[]> {
    const vad = new FakeVadProvider();
    await vad.init();
    const detector = vad.createDetector({
      speechThreshold: 0.2,
      silenceTimeoutMs: 550,
      duckingActive: () => ducking,
    });
    const events: VadEvent[] = [];
    for (const frame of await collect(patternFrames(pattern))) events.push(...detector.push(frame));
    return events;
  }

  test('a tone burst produces speech_start then speech_end', async () => {
    const events = await eventsFor('..####......');
    expect(events.map((e) => e.type)).toEqual(['speech_start', 'speech_end']);
  });

  test('silence alone produces nothing', async () => {
    expect(await eventsFor('..........')).toEqual([]);
  });

  test('speech during playback produces barge_in before speech_start', async () => {
    const events = await eventsFor('..####......', true);
    expect(events[0]?.type).toBe('barge_in');
    expect(events.map((e) => e.type)).toContain('speech_start');
  });
});

describe('FakeMenuSource', () => {
  test('subscribe yields the current snapshot, then each publish', async () => {
    const menu = new FakeMenuSource();
    await menu.init();
    const controller = new AbortController();

    const received: MenuSnapshot[] = [];
    const reader = (async () => {
      for await (const snapshot of menu.subscribe('test-store', controller.signal)) {
        received.push(snapshot);
        if (received.length === 2) break;
      }
    })();

    await new Promise((r) => setTimeout(r, 5));
    menu.setUnavailable(['milkshake', 'apple_pie']);
    await reader;
    controller.abort();

    expect(received[0]?.unavailableSkus).toEqual(['milkshake']);
    expect(received[1]?.unavailableSkus).toEqual(['milkshake', 'apple_pie']);
  });
});

describe('FakePosProvider', () => {
  test('re-syncing the same revision does not duplicate lines', async () => {
    const pos = new FakePosProvider();
    await pos.init();
    const { ctx } = createTestContext();
    const ref = await pos.openTicket('s1', ctx);

    await pos.syncOrder(ref, order, ctx);
    await pos.syncOrder(ref, order, ctx);

    expect(pos.tickets.get(ref.ticketId)?.syncs).toHaveLength(1);
  });

  test('failFirstNSyncs models a POS reboot the outbox must ride out', async () => {
    const pos = new FakePosProvider({ failFirstNSyncs: 2 });
    await pos.init();
    const { ctx } = createTestContext();
    const ref = await pos.openTicket('s1', ctx);

    await expect(pos.syncOrder(ref, order, ctx)).rejects.toThrow();
    await expect(pos.syncOrder(ref, order, ctx)).rejects.toThrow();
    const result = await pos.syncOrder(ref, order, ctx);
    expect(result.totalCents).toBe(order.totalCents);
  });

  test('totalDriftCents exercises the price reconciliation alert', async () => {
    const pos = new FakePosProvider({ totalDriftCents: 25 });
    await pos.init();
    const { ctx } = createTestContext();
    const ref = await pos.openTicket('s1', ctx);
    const result = await pos.syncOrder(ref, order, ctx);
    expect(result.totalCents).toBe(order.totalCents + 25);
  });
});

describe('TEST_MENU fixture', () => {
  test('every combo slot references items that exist', () => {
    const skus = new Set(TEST_MENU.items.map((i) => i.sku));
    for (const combo of TEST_MENU.combos) {
      for (const slot of combo.slots) {
        expect(slot.eligibleSkus.every((s) => skus.has(s))).toBe(true);
        expect(slot.eligibleSkus).toContain(slot.defaultSku);
      }
    }
  });

  test('every alias and modifier group reference resolves', () => {
    const skus = new Set(TEST_MENU.items.map((i) => i.sku));
    const groups = new Set(TEST_MENU.modifierGroups.map((g) => g.id));
    for (const alias of TEST_MENU.aliasIndex) expect(skus.has(alias.targetSku)).toBe(true);
    for (const item of TEST_MENU.items) {
      for (const id of item.modifierGroupIds) expect(groups.has(id)).toBe(true);
    }
  });

  test('sized items declare exactly one default size', () => {
    for (const item of TEST_MENU.items) {
      if (item.sizes.length === 0) continue;
      expect(item.sizes.filter((s) => s.isDefault)).toHaveLength(1);
    }
  });

  test('unavailable skus are real items, so the 86 path is reachable', () => {
    const skus = new Set(TEST_MENU.items.map((i) => i.sku));
    for (const sku of TEST_MENU.unavailableSkus) expect(skus.has(sku)).toBe(true);
  });
});
