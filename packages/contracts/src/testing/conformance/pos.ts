import { ProviderError } from '../../common.ts';
import type { OrderState } from '../../domain/order.ts';
import type { PosProvider } from '../../ports/pos.ts';
import { createTestContext } from '../context.ts';
import { SAMPLE_ORDER } from '../fixtures/menu.ts';
import type { Check, ConformanceReport } from '../types.ts';
import { require, runChecks, skipCheck } from '../types.ts';
import { lifecycleChecks } from './provider.ts';

export interface PosConformanceOptions {
  create(): Promise<PosProvider> | PosProvider;
  /** Override when a vendor sandbox needs its own order shape. */
  readonly order?: OrderState;
}

export const POS_CHECK_NAMES = [
  'id_is_stable_and_non_empty',
  'capabilities_are_stable',
  'health_ok_after_init',
  'health_does_not_throw',
  'open_ticket_returns_a_usable_ref',
  'tickets_are_distinct',
  'sync_is_idempotent_on_revision',
  'sync_reports_a_non_negative_total',
  'commit_after_sync_succeeds',
  'unknown_ticket_is_a_typed_error',
  'void_is_supported_as_declared',
] as const;

function posChecks(options: PosConformanceOptions): readonly Check<PosProvider>[] {
  const order = options.order ?? (SAMPLE_ORDER as unknown as OrderState);

  return [
    ...lifecycleChecks<PosProvider>(),
    {
      name: 'open_ticket_returns_a_usable_ref',
      obligation: 'The display number goes on the customer screen and the expo ticket.',
      async run(p) {
        const { ctx } = createTestContext();
        const ref = await p.openTicket('session-a', ctx);
        require(ref.ticketId.length > 0, 'ticketId is empty');
        require(ref.displayNumber.length > 0, 'displayNumber is empty');
      },
    },
    {
      name: 'tickets_are_distinct',
      obligation: 'Two cars must not share a ticket.',
      async run(p) {
        const { ctx } = createTestContext();
        const a = await p.openTicket('session-a', ctx);
        const b = await p.openTicket('session-b', ctx);
        require(a.ticketId !== b.ticketId, 'two sessions received the same ticketId');
      },
    },
    {
      name: 'sync_is_idempotent_on_revision',
      obligation:
        'The outbox retries. Re-syncing the same revision must not duplicate lines or change the total.',
      async run(p) {
        const { ctx } = createTestContext();
        const ref = await p.openTicket('session-idem', ctx);
        const first = await p.syncOrder(ref, order, ctx);
        const second = await p.syncOrder(ref, order, ctx);
        require(
          first.totalCents === second.totalCents,
          `re-syncing revision ${order.revision} changed the total ` +
            `(${first.totalCents} → ${second.totalCents}) — lines were duplicated`,
        );
      },
    },
    {
      name: 'sync_reports_a_non_negative_total',
      obligation: 'The POS is the pricing authority; we reconcile our total against this one.',
      async run(p) {
        const { ctx } = createTestContext();
        const ref = await p.openTicket('session-total', ctx);
        const result = await p.syncOrder(ref, order, ctx);
        require(result.totalCents >= 0, `totalCents is negative: ${result.totalCents}`);
        require(Array.isArray(result.rejectedLineIds), 'rejectedLineIds must be an array');
      },
    },
    {
      name: 'commit_after_sync_succeeds',
      obligation: 'Commit is what puts the order in front of the kitchen.',
      async run(p) {
        const { ctx } = createTestContext();
        const ref = await p.openTicket('session-commit', ctx);
        await p.syncOrder(ref, order, ctx);
        const result = await p.commitTicket(ref, ctx);
        require(result.totalCents >= 0, `commit returned a negative total: ${result.totalCents}`);
      },
    },
    {
      name: 'unknown_ticket_is_a_typed_error',
      obligation:
        'The breaker and outbox decide from ProviderError.kind. A raw vendor error is undecidable.',
      async run(p) {
        const { ctx } = createTestContext();
        let thrown: unknown;
        try {
          await p.syncOrder({ ticketId: 'definitely-not-a-ticket', displayNumber: '000' }, order, ctx);
        } catch (error) {
          thrown = error;
        }
        require(thrown !== undefined, 'syncing an unknown ticket did not throw');
        require(
          thrown instanceof ProviderError,
          `threw ${(thrown as Error)?.name ?? typeof thrown}, not a ProviderError — ` +
            'the adapter must translate vendor errors',
        );
        require(
          thrown.options.retryable === false,
          'an unknown ticket is not retryable; retrying it will never succeed',
        );
      },
    },
    {
      name: 'void_is_supported_as_declared',
      obligation: 'A voided order must clear from the expo screen, or crew work from a stale ticket.',
      async run(p) {
        if (!p.capabilities.supportsVoid) skipCheck('supportsVoid is false');
        const { ctx } = createTestContext();
        const ref = await p.openTicket('session-void', ctx);
        await p.syncOrder(ref, order, ctx);
        await p.voidTicket(ref, 'customer drove away', ctx);
      },
    },
  ];
}

export async function runPosConformance(
  options: PosConformanceOptions,
): Promise<ConformanceReport> {
  const probe = await options.create();
  await probe.init();

  const isolated = posChecks(options).map<Check<PosProvider>>((check) => ({
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

  const report = await runChecks('pos', probe.id, probe, isolated);
  await probe.dispose();
  return report;
}
