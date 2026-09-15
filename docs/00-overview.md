# 00 — Overview & Scope

## The job to be done

A car pulls up to a menu board. A voice greets them. They order, change their
mind twice, ask whether the sauce is spicy, add a kid's meal, and pull forward.
The order is on the POS and on the expo screen before they reach the window.

That is the whole product. Everything below serves it.

## Success criteria

| Metric | Target | Why this number |
| --- | --- | --- |
| End-of-speech → first TTS audio | p50 ≤ 500 ms, p95 ≤ 900 ms | Beyond ~1 s the customer starts repeating themselves and talks over us. |
| Order accuracy (item + size + mods) | ≥ 98.5 % of line items | Below this, remakes and refunds eat the labor savings. |
| Containment (no human takeover) | ≥ 85 % of orders | The business case is one crew member freed per shift. |
| Lane availability | ≥ 99.9 % | Failure must degrade to a human headset, never to a stalled car. |
| Cost per order | ≤ $0.02 amortized | Compare against ~$0.35–0.60/order in headset labor. |

## In scope (v1)

- Single-lane, single-language (en-US) ordering at the menu board
- Full menu: items, sizes, modifiers, combos, substitutions, removals
- Order edits mid-conversation ("actually make that a large", "drop the onions")
- Clarification questions when confidence is low
- Menu-aware upsell, at most once per order, suppressible per franchise
- Confirmation read-back + customer-facing order display
- One-touch handoff to a human headset, at any moment
- POS write-through, so the window and kitchen see a normal order

## Explicitly out of scope (v1)

- Payment (handled at the window, as today)
- Multi-lane arbitration and vehicle re-identification across lanes
- Loyalty account linking by voice
- Languages beyond en-US (Spanish is v2 — the ASR/LLM ports already take a locale)
- Anything at the pickup window

## Non-negotiable constraints

These shape the architecture more than anything else:

1. **The LLM never mutates the order.** It proposes tool calls; a deterministic
   Order Service validates them against the catalog and owns state. See
   [ADR-0004](adr/0004-order-state-machine.md).
2. **The network may be down.** Full ordering must work with the WAN unplugged.
   Only POS sync, telemetry, and OTA updates may queue.
3. **Every model is temporary.** ASR, LLM, TTS, and VAD all sit behind ports.
   Swapping one is a config change and an adapter, never a refactor.
4. **A human can always take over,** within one button press and under 2 s.

## The stakeholders you will hear from

- **Crew** — will hate it if it barges into their headset traffic or produces
  orders they have to fix. They are the ones who will unplug it.
- **Franchisee** — cares about cost per order and remake rate, nothing else.
- **Corporate brand** — cares about the voice persona, upsell compliance, and
  never saying anything embarrassing.
- **IT** — cares that it is one box they can reimage, not a science project.
