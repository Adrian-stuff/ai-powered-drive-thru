/**
 * The authoritative order model. Owned by the Order Service, never mutated by
 * the LLM, and versioned additively because POS, display, and analytics all
 * read it. See docs/adr/0004-order-state-machine.md.
 */

export interface OrderState {
  readonly orderId: string;
  readonly sessionId: string;
  /** Increments on every applied command. The POS outbox keys idempotency on it. */
  readonly revision: number;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLine[];
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  /** Set when the Order Service needs the customer to disambiguate. */
  readonly pendingClarification?: Clarification;
}

export type OrderStatus = 'draft' | 'confirming' | 'confirmed' | 'sent_to_pos' | 'abandoned' | 'voided';

export interface OrderLine {
  readonly lineId: string;
  readonly sku: string;
  readonly displayName: string;
  readonly quantity: number;
  readonly sizeId?: string;
  readonly modifiers: readonly AppliedModifier[];
  readonly comboId?: string;
  readonly unitPriceCents: number;
  readonly totalPriceCents: number;
  /** How confident the resolver was. Low-confidence lines get read back explicitly. */
  readonly resolutionConfidence: number;
}

export interface AppliedModifier {
  readonly optionId: string;
  readonly displayName: string;
  readonly priceDeltaCents: number;
}

export interface Clarification {
  readonly question: string;
  readonly candidates: readonly ClarificationCandidate[];
  readonly forLineId?: string;
}

export interface ClarificationCandidate {
  readonly sku: string;
  readonly spokenName: string;
  readonly confidence: number;
}

/**
 * The only way to change an order. Produced by the orchestrator from LLM tool
 * calls or from the deterministic fast path, then validated before it applies.
 */
export type OrderCommand =
  | { readonly type: 'add_item'; readonly sku: string; readonly quantity: number; readonly sizeId?: string; readonly modifierOptionIds?: readonly string[] }
  | { readonly type: 'add_combo'; readonly comboId: string; readonly slotSelections?: Readonly<Record<string, string>> }
  | { readonly type: 'set_quantity'; readonly lineId: string; readonly quantity: number }
  | { readonly type: 'set_size'; readonly lineId: string; readonly sizeId: string }
  | { readonly type: 'add_modifier'; readonly lineId: string; readonly optionId: string }
  | { readonly type: 'remove_modifier'; readonly lineId: string; readonly optionId: string }
  | { readonly type: 'remove_line'; readonly lineId: string }
  | { readonly type: 'clear_order' }
  | { readonly type: 'resolve_clarification'; readonly chosenSku: string }
  | { readonly type: 'confirm' };

/** Emitted after a command applies. Append-only; consumers may ignore unknown types. */
export type OrderEvent =
  | { readonly type: 'line_added'; readonly line: OrderLine; readonly revision: number }
  | { readonly type: 'line_changed'; readonly line: OrderLine; readonly revision: number }
  | { readonly type: 'line_removed'; readonly lineId: string; readonly revision: number }
  | { readonly type: 'clarification_raised'; readonly clarification: Clarification; readonly revision: number }
  | { readonly type: 'order_confirmed'; readonly order: OrderState; readonly revision: number }
  | { readonly type: 'order_voided'; readonly reason: string; readonly revision: number };

/** A command the Order Service refused. The orchestrator turns this into speech. */
export interface CommandRejection {
  readonly reason:
    | 'unknown_sku'
    | 'item_unavailable'      // 86'd — "sorry, we're out of those tonight"
    | 'invalid_size'
    | 'invalid_modifier'
    | 'modifier_limit_exceeded'
    | 'unknown_line'
    | 'not_available_this_daypart'
    | 'order_already_confirmed';
  readonly message: string;
  /** What to offer instead, when the catalog has a near match. */
  readonly suggestions?: readonly string[];
}
