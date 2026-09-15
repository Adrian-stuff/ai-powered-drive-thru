import type { CallContext, Provider } from '../common.ts';
import type { OrderState } from '../domain/order.ts';

export interface PosCapabilities {
  /** Can push line items as they are added, so the window sees a live order. */
  readonly supportsIncrementalSync: boolean;
  readonly supportsVoid: boolean;
  readonly supportsPriceOverride: boolean;
  /** POS is the pricing authority; we must reconcile against its totals. */
  readonly authoritativePricing: boolean;
}

export interface PosTicketRef {
  readonly ticketId: string;
  readonly displayNumber: string;
}

export interface PosProvider extends Provider<PosCapabilities> {
  openTicket(sessionId: string, ctx: CallContext): Promise<PosTicketRef>;
  /** Idempotent on (ticketId, order.revision) — the outbox may retry. */
  syncOrder(ref: PosTicketRef, order: OrderState, ctx: CallContext): Promise<PosSyncResult>;
  commitTicket(ref: PosTicketRef, ctx: CallContext): Promise<PosSyncResult>;
  voidTicket(ref: PosTicketRef, reason: string, ctx: CallContext): Promise<void>;
}

export interface PosSyncResult {
  /** POS-computed total in minor units. Divergence from ours is an alert. */
  readonly totalCents: number;
  readonly rejectedLineIds: readonly string[];
}
