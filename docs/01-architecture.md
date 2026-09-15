# 01 — Architecture

## 1. Shape of the system

Three tiers. The store keeps working when the two above it disappear.

```
┌──────────────────────────────────────────────────────────────────────┐
│ TIER 3 — CLOUD (optional, never on the critical path)                │
│  Fleet config · Menu publishing · Telemetry lake · Eval harness      │
│  Model registry & OTA · Cloud model endpoints (failover / hybrid)    │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ queued, async, survives 24h offline
┌───────────────────────────────┴──────────────────────────────────────┐
│ TIER 2 — STORE BOX (one small GPU machine per restaurant)            │
│                                                                      │
│   ┌────────────┐   ┌──────────────────┐   ┌──────────────────┐       │
│   │ Audio I/O  │──▶│ Dialog           │──▶│ Order Service    │       │
│   │ Gateway    │   │ Orchestrator     │   │ (deterministic)  │       │
│   └────────────┘   └──────────────────┘   └──────────────────┘       │
│         │                   │                      │                 │
│         ▼                   ▼                      ▼                 │
│   ┌──────────┐      ┌──────────────┐      ┌────────────────┐         │
│   │ Inference│      │ Menu Catalog │      │ POS Adapter    │         │
│   │ Runtime  │      │ (read model) │      │ + outbox       │         │
│   └──────────┘      └──────────────┘      └────────────────┘         │
│    ASR·LLM·TTS·VAD                                                   │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ LAN / analog
┌───────────────────────────────┴──────────────────────────────────────┐
│ TIER 1 — LANE HARDWARE                                               │
│  Mic array · Speaker · Vehicle loop/radar · Customer display ·       │
│  Crew headset + takeover button                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. The conversation loop

The hot path, in the order audio moves through it:

```
mic ──▶ AudioGateway ──▶ VAD/endpointer ──▶ ASR (streaming partials)
                              │                      │
                              │ barge-in signal      │ final transcript
                              ▼                      ▼
                         TTS playback  ◀──── DialogOrchestrator
                              ▲                      │ tool calls
                              │                      ▼
                         TTS synth  ◀── response ── OrderService ──▶ Catalog
                                                     │
                                                     ▼
                                              OrderState (authoritative)
                                                     │
                                          ┌──────────┴──────────┐
                                          ▼                     ▼
                                   CustomerDisplay          POS outbox
```

### Why the turn feels fast

Three tricks, all of them structural rather than clever:

1. **Streaming everywhere.** ASR emits partial hypotheses; the orchestrator
   pre-warms the LLM prompt on partials and commits on the final. TTS streams
   its first audio chunk while still synthesizing the tail.
2. **Semantic endpointing, not silence timers.** A fixed 700 ms silence timer is
   the single largest avoidable latency. The endpointer combines VAD energy, ASR
   stability, and a lightweight "is this utterance complete?" classifier, so
   "I'll take a number three" ends the turn in ~200 ms while "and can I get, uh…"
   waits. See [ADR-0003](adr/0003-streaming-pipeline.md).
3. **Deterministic fast paths.** "Yes", "no", "that's it", and plain single-item
   orders resolve against the catalog without waking the LLM at all. Roughly 40 %
   of turns never reach a model.

### Barge-in

The customer talking over our audio is the normal case, not an edge case. The
AudioGateway runs acoustic echo cancellation against the TTS output it is
currently playing, so the mic stream stays clean. When VAD sees speech above
threshold during playback, it fires `BARGE_IN`, the orchestrator cancels the
in-flight TTS stream and any in-flight LLM request, and the turn restarts. This
is why every port's methods are cancellable — see
[`packages/contracts`](../packages/contracts/src).

## 3. Components

### AudioGateway
Owns the sound card. Ring buffer, resampling, AEC, noise suppression, and the
`AudioFrame` stream. Presents the mic as a `ReadableStream<AudioFrame>` and the
speaker as a cancellable sink. This is the only component that knows about
hardware, and it is why the rest of the system is testable from WAV files.

### Endpointer (VAD)
Consumes frames, emits `SPEECH_START`, `SPEECH_END`, `BARGE_IN`. Behind the
`VadProvider` port — Silero locally, or a cloud ASR's built-in endpointing when
running the cloud profile.

### Dialog Orchestrator
The only stateful conversational component. It:
- maintains the dialog context (turn history, current order snapshot, pending
  clarification),
- decides fast-path vs. LLM,
- builds the prompt, calls the `LlmProvider` with the tool schema,
- executes returned tool calls against the Order Service,
- turns the result into speech.

It does *not* decide what is on the menu, what things cost, or whether an order
is valid. That would make it un-testable and would put correctness at the mercy
of whichever model is loaded this month.

### Order Service — the deterministic core
The authoritative order state machine. Every mutation arrives as a validated
command (`AddItem`, `SetSize`, `AddModifier`, `RemoveLine`, `Confirm`…). It
validates against the Menu Catalog, applies pricing and combo rules, and emits
`OrderEvent`s. Given the same command sequence it produces the same order,
forever, regardless of model.

This is the single most important boundary in the design. See
[ADR-0004](adr/0004-order-state-machine.md).

### Menu Catalog
A read-optimized projection of the published menu: items, sizes, modifiers,
combo rules, availability (86'd items), prices, and — critically — a **phonetic
alias index**. "Coke", "coca cola", "a coke zero", "diet" all resolve to SKUs
with a confidence score. Built at menu-publish time, loaded in memory, rebuilt
on the fly when the store 86's an item.

### POS Adapter + Outbox
Writes the confirmed order to whatever POS the chain runs. Behind the
`PosProvider` port because every chain has a different one and it is the single
least portable part of the system. All writes go through a durable outbox, so a
POS reboot mid-rush loses nothing.

### Supervisor
Watchdog and safety net. Owns the circuit breakers, the takeover button, model
health checks, and the degradation ladder (§5).

## 4. Data flow of one order

```
VehicleArrive ──▶ session created, greeting synthesized
  turn 1  "yeah lemme get a number three with a coke"
          → ASR final → LLM → tools: [addCombo(#3), setDrink(coke)]
          → OrderService validates → OrderEvent[] → display + TTS read-back
  turn 2  "actually large"
          → fast path: size modifier on last-touched line
  turn 3  "and two apple pies"      → LLM → addItem(apple_pie, qty 2)
  turn 4  "that's it"               → fast path: intent=complete
          → read-back + total → Confirm → POS write → outbox flush
VehicleDepart ──▶ session sealed, transcript + audio queued for eval
```

## 5. Degradation ladder

The system never has a single failure state; it has a ladder it walks down.

| Level | Trigger | Behavior |
| --- | --- | --- |
| L0 Normal | — | Local ASR + local LLM + local TTS |
| L1 Model degraded | LLM p95 > budget, or breaker half-open | Drop to smaller local model or cloud LLM per profile; disable upsell to save a turn |
| L2 Understanding degraded | 2 consecutive low-confidence turns | Switch to constrained prompts: "I have a number three — is that right?" Yes/no grammar only |
| L3 Assist | 3 failed turns, or customer says "person" | Ring crew headset, AI stays on as transcriptionist |
| L4 Human | Crew presses takeover, or L1–L3 unavailable | Full handoff to headset. AI muted, session keeps recording for eval |
| L5 Bypass | Box unreachable | Hardware relay bonds mic↔headset directly. No software in the path |

L5 is a physical relay, deliberately. If the box is a brick, the lane still
takes orders. Any design where a software fault can stop a restaurant selling
food is the wrong design.

## 6. Why these boundaries

Each boundary exists because something on the other side of it changes at a
different rate:

| Boundary | Changes when… |
| --- | --- |
| Inference ports | A better model ships (months) |
| POS port | We onboard a new chain (per customer) |
| Menu Catalog | Marketing publishes (weekly) + 86's (hourly) |
| Order Service | The business changes how combos price (rarely) |
| Dialog Orchestrator | We learn how people actually talk (constantly) |

Things that change together live together; things that change at different rates
get an interface between them. That is the whole rule.
