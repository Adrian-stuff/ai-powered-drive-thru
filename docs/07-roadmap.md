# 07 — Roadmap

Sequenced so that the riskiest assumption is tested first and nothing is built
on an unvalidated foundation. Durations assume 2–3 engineers.

## Phase 0 — Prove the latency (3 weeks)

**Question: can we hit sub-second on affordable hardware?** Everything else is
wasted if the answer is no.

- Buy one target box. Wire VAD → ASR → LLM → TTS end to end, crudely.
- Record 100 real drive-thru utterances (a phone in a car at an actual lane).
- Measure each stage's p50/p95. Compare against `docs/04-latency-budget.md`.

**Gate:** p95 under 1.2 s on a naive implementation. If not, either the hardware
budget or the model sizing is wrong, and that must be resolved before anything
else is built.

## Phase 1 — The deterministic core (4 weeks)

No models. Prove the order logic in isolation, where it is fast to test.

- `Order Service` + state machine + pricing and combo rules
- `Menu Catalog` + resolver + alias index
- Contract conformance test kit in `packages/contracts`
- 200 hand-written command sequences with expected `OrderState`

**Gate:** every command sequence produces the right order, deterministically.

## Phase 2 — Local pipeline (5 weeks)

- Adapters: `silero`, `faster-whisper`, `openai-compatible`, `piper`
- Audio Gateway with AEC and barge-in
- Dialog Orchestrator: prompt, tool loop, fast paths, clarification
- Semantic endpointer v1
- Runtime resilience stack (timeout, breaker, fallback, telemetry)

**Gate:** 50 scripted orders end to end in a lab, ≥95 % accuracy, p95 in budget.

## Phase 3 — Store integration (4 weeks)

- POS adapter for the first chain + durable outbox
- Customer display, crew headset integration, takeover button, **L5 hardware relay**
- Supervisor, degradation ladder, session recording
- Menu publishing pipeline and 86 handling

**Gate:** a full shift in one store, staff-only, no real customers.

## Phase 4 — Pilot (8 weeks)

- One store, off-peak, crew supervising every order with takeover ready
- Eval harness + golden set built from real traffic
- Weekly alias-index review loop
- Tune thresholds; expand fast-path coverage

**Gate:** ≥85 % containment, ≥98.5 % line accuracy, remake rate no worse than
human baseline. This is the real go/no-go for the product.

## Phase 5 — Swappability, proven (3 weeks)

The point of the architecture, demonstrated rather than asserted.

- Cloud adapters: `anthropic`, `deepgram`, `cartesia`
- `hybrid` and `cloud` profiles running in real stores
- Shadow-mode runner and the provider A/B report
- **Swap the LLM provider in production via config, with zero code changes.**

**Gate:** a provider swap takes under an hour, including the eval that justifies
it. If it takes longer, the abstraction is not carrying its weight and should be
revisited.

## Phase 6 — Fleet (ongoing)

- GitOps config, staged rollout, automatic rollback
- Per-store dashboards and alerting
- Second chain's POS adapter — the real test of the `PosProvider` port
- Spanish (the ports already take a locale; the work is data and evals)

## Deliberately deferred

| Deferred | Until |
| --- | --- |
| Fine-tuning a domain LLM | The golden set exists and prompt engineering has plateaued |
| Multi-lane arbitration | Single lane is proven at >85 % containment |
| Voice-linked loyalty | Privacy review, and the retention posture in `docs/03` is settled |
| Custom ASR training | Alias index and vocabulary bias stop yielding gains |

Fine-tuning in particular is a trap to avoid early: it is the intuitive next
step, and it is almost always beaten by better menu aliases and a shorter,
better-structured prompt — for a fraction of the effort and with none of the
lock-in.
