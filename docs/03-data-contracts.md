# 03 — Data Contracts

Three contracts are load-bearing and versioned: the **tool schema** the LLM
sees, the **`OrderCommand`/`OrderEvent`** pair, and the **menu snapshot**. The
TypeScript source of truth is [`packages/contracts/src/domain`](../packages/contracts/src/domain).

## 1. The tool schema

This is the LLM's entire API surface. It is deliberately small — every tool is
a verb the Order Service already supports, with no free-text fields that could
smuggle unvalidated data into the order.

| Tool | Arguments | Notes |
| --- | --- | --- |
| `add_item` | `sku`, `quantity`, `size_id?`, `modifier_option_ids?` | `sku` must exist in the catalog; the model picks from candidates given in the prompt |
| `add_combo` | `combo_id`, `slot_selections?` | Unfilled slots take defaults; the orchestrator asks about drinks |
| `set_quantity` | `line_id`, `quantity` | `quantity: 0` is rejected — use `remove_line`, so intent is explicit |
| `set_size` | `line_id`, `size_id` | |
| `add_modifier` / `remove_modifier` | `line_id`, `option_id` | |
| `remove_line` | `line_id` | |
| `clear_order` | — | Requires spoken confirmation before it applies |
| `ask_clarification` | `question`, `candidate_skus` | The model's way of saying "I'm not sure" |
| `finalize_order` | — | Triggers read-back, not the POS write |

Two rules make this safe:

**No free-form SKUs.** The model chooses from a candidate list the orchestrator
injects into the prompt, drawn from the catalog resolver's top-k matches on the
transcript. It cannot invent `sku: "mcrib_deluxe"` because that string is not
in front of it.

**Validation is not advisory.** Every tool call goes through the Order Service,
which re-checks the SKU, the daypart, the 86 list, the modifier group limits,
and the price. A hallucinated call produces a `CommandRejection`, which the
orchestrator turns into "sorry, we don't have that" — a normal conversational
turn, not an error.

## 2. Order commands and events

`OrderCommand` in, `OrderEvent` out, revision number monotonic. The event log is
the integration point for the customer display, the POS outbox, and the
analytics pipeline; none of them read order state directly.

Versioning rules:
- Fields may be **added** to events. Consumers ignore unknown fields.
- Fields are never removed or retyped. A breaking change gets a new event type.
- New `OrderCommand` variants are fine; existing variants' semantics are frozen,
  because prompts, evals, and any fine-tune depend on them.

## 3. Menu snapshot

Published by the chain, consumed by the store. Two independent cadences:

- **`version`** — the full menu, published weekly-ish by marketing. A version
  change triggers a catalog rebuild, an ASR vocabulary-bias refresh, and an
  alias-index rebuild.
- **`unavailableSkus`** — the 86 list, changing hourly during service. Applied
  in place, without a rebuild, because a store cannot wait 30 seconds to stop
  selling milkshakes.

### The alias index earns its keep

`MenuAlias` maps what people say to what we sell. It is seeded from menu data
and then grown from production transcripts, and after the first month it is
where most accuracy improvement comes from — considerably more than swapping in
a bigger model. The loop:

```
transcripts → unresolved-phrase report → human review (5 min/week)
           → new aliases → catalog rebuild → ASR vocabulary bias refresh
```

Treat it as a product surface with an owner, not a config file.

## 4. Session record

Written at session end, queued for upload. One row per car:

```
sessionId, storeId, laneId, startedAt, endedAt
orderState (final), orderEvents[], turns[] { transcript, confidence,
  toolCalls, rejections, latencies{ asr, llm, tts, total } }
outcome: completed | handed_off | abandoned | voided
audioRef (retained per §5)
```

This is the input to [evaluation](09-evaluation.md). Without it there is no way
to tell whether a model swap helped, so it ships in v1, not later.

## 5. Privacy and retention

Voice is biometric data in several US states (Illinois BIPA most sharply) and
personal data under GDPR. The design assumes the strictest regime:

- **Audio** is retained only when a session is flagged for eval (low confidence,
  handoff, or random 1 % sample), max 30 days, then deleted.
- **Transcripts** are redacted for names, phone numbers, and card fragments
  before leaving the store.
- **No voice fingerprinting, no speaker identification, no cross-visit linkage.**
  We do not identify returning customers by voice, even though we could.
- Signage at the menu board discloses recording, as required.
- Default retention config ships **restrictive**; loosening it is a deliberate,
  per-chain, logged decision — not a default someone forgets to change.
