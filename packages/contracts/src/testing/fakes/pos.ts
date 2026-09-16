import type { CallContext, HealthStatus } from '../../common.ts';
import { ProviderError } from '../../common.ts';
import type { OrderState } from '../../domain/order.ts';
import type { PosCapabilities, PosProvider, PosSyncResult, PosTicketRef } from '../../ports/pos.ts';

export interface FakePosOptions {
  readonly id?: string;
  readonly capabilities?: Partial<PosCapabilities>;
  /**
   * Cents added to the POS-side total, to exercise the reconciliation alert.
   * A real POS is the pricing authority and will sometimes disagree with us.
   */
  readonly totalDriftCents?: number;
  readonly rejectSkus?: readonly string[];
  readonly failWith?: ProviderError;
  /** Fail this many `syncOrder` calls before succeeding — exercises the outbox. */
  readonly failFirstNSyncs?: number;
}

const DEFAULT_CAPABILITIES: PosCapabilities = {
  supportsIncrementalSync: true,
  supportsVoid: true,
  supportsPriceOverride: false,
  authoritativePricing: true,
};

export interface FakeTicket {
  readonly ref: PosTicketRef;
  readonly syncs: OrderState[];
  committed: boolean;
  voidedReason?: string;
}

export class FakePosProvider implements PosProvider {
  readonly id: string;
  readonly capabilities: PosCapabilities;

  readonly tickets = new Map<string, FakeTicket>();
  initCount = 0;
  disposeCount = 0;

  #nextTicket = 1;
  #syncAttempts = 0;
  #options: FakePosOptions;

  constructor(options: FakePosOptions = {}) {
    this.#options = options;
    this.id = options.id ?? 'fake-pos';
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
  }

  async init(): Promise<void> {
    this.initCount += 1;
  }

  async health(): Promise<HealthStatus> {
    return { ok: this.disposeCount === 0 };
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }

  async openTicket(sessionId: string, _ctx: CallContext): Promise<PosTicketRef> {
    if (this.#options.failWith) throw this.#options.failWith;
    const n = this.#nextTicket++;
    const ref: PosTicketRef = { ticketId: `ticket-${sessionId}-${n}`, displayNumber: String(100 + n) };
    this.tickets.set(ref.ticketId, { ref, syncs: [], committed: false });
    return ref;
  }

  async syncOrder(ref: PosTicketRef, order: OrderState, _ctx: CallContext): Promise<PosSyncResult> {
    this.#syncAttempts += 1;
    if (this.#options.failWith) throw this.#options.failWith;
    if (this.#syncAttempts <= (this.#options.failFirstNSyncs ?? 0)) {
      throw new ProviderError('unavailable', 'fake POS is briefly unreachable', {
        provider: this.id,
        retryable: true,
        shouldTripBreaker: false,
      });
    }

    const ticket = this.#ticket(ref);
    // Idempotent on (ticketId, revision) — the outbox retries, and must not
    // produce a duplicate line on the expo screen.
    const alreadyApplied = ticket.syncs.some((s) => s.revision === order.revision);
    if (!alreadyApplied) ticket.syncs.push(order);

    const rejected = this.#options.rejectSkus ?? [];
    return {
      totalCents: order.totalCents + (this.#options.totalDriftCents ?? 0),
      rejectedLineIds: order.lines.filter((l) => rejected.includes(l.sku)).map((l) => l.lineId),
    };
  }

  async commitTicket(ref: PosTicketRef, _ctx: CallContext): Promise<PosSyncResult> {
    const ticket = this.#ticket(ref);
    ticket.committed = true;
    const last = ticket.syncs.at(-1);
    return {
      totalCents: (last?.totalCents ?? 0) + (this.#options.totalDriftCents ?? 0),
      rejectedLineIds: [],
    };
  }

  async voidTicket(ref: PosTicketRef, reason: string, _ctx: CallContext): Promise<void> {
    this.#ticket(ref).voidedReason = reason;
  }

  #ticket(ref: PosTicketRef): FakeTicket {
    const ticket = this.tickets.get(ref.ticketId);
    if (!ticket) {
      throw new ProviderError('invalid_request', `unknown ticket ${ref.ticketId}`, {
        provider: this.id,
        retryable: false,
        shouldTripBreaker: false,
      });
    }
    return ticket;
  }
}
