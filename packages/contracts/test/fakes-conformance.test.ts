/**
 * The fakes must satisfy the same contracts real adapters do. If a fake could
 * drift from the port, every test built on it would be testing a fiction.
 */
import {
  describeAsrConformance,
  describeLlmConformance,
  describePosConformance,
  describeTtsConformance,
  describeVadConformance,
} from '../src/testing/bun.ts';
import {
  FakeAsrProvider,
  FakeLlmProvider,
  FakePosProvider,
  FakeTtsProvider,
  FakeVadProvider,
} from '../src/testing/index.ts';

describeAsrConformance('FakeAsrProvider', {
  create: () => new FakeAsrProvider({ chunkDelayMs: 5 }),
});

describeLlmConformance('FakeLlmProvider', {
  create: () =>
    new FakeLlmProvider({
      tokenDelayMs: 5,
      respond: (req) =>
        req.tools?.length
          ? { toolCalls: [{ name: 'add_item', arguments: { sku: 'burger_classic', quantity: 1 } }] }
          : { text: 'okay, anything else? ' },
    }),
});

describeTtsConformance('FakeTtsProvider', {
  create: () => new FakeTtsProvider({ chunkDelayMs: 5, chunkCount: 8 }),
});

describeVadConformance('FakeVadProvider', {
  create: () => new FakeVadProvider(),
});

describePosConformance('FakePosProvider', {
  create: () => new FakePosProvider(),
});
