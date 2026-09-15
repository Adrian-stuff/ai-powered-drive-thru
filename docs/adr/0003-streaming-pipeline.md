# ADR-0003 — Streaming, cancellable pipeline with semantic endpointing

**Status:** Accepted

## Context

A request/response pipeline — record until silence, transcribe, generate,
synthesize, play — is far simpler to build. It also cannot hit the latency
target, because it serializes four stages that could overlap and it pays a fixed
silence timeout on every single turn.

Worse, it cannot handle barge-in. Customers talk over the system constantly,
and a system that keeps talking over the customer is one people describe as
"broken" regardless of its accuracy.

## Decision

Every stage streams, and every stage is cancellable.

- ASR emits partial hypotheses; the orchestrator speculatively prefills the LLM
  on stable partials and commits on the final.
- The LLM streams deltas; TTS begins synthesizing on the first complete
  sentence rather than the full response.
- TTS streams audio chunks; the first is playing while the tail synthesizes.
- **Endpointing is semantic**, combining VAD energy, ASR stability, and an
  utterance-completeness classifier — not a fixed silence timer.
- Every port method takes a `CallContext` with an `AbortSignal`. Barge-in
  cancels the in-flight LLM request and TTS stream within one audio frame.

## Consequences

**We accept:**
- Substantially more complex control flow: partial state, speculative work that
  gets thrown away, and cancellation paths that must actually be tested.
- Wasted compute on speculative prefills that miss (~25 %).
- Adapters must genuinely honor cancellation, which the conformance suite has
  to verify because vendors are inconsistent about it.

**We get:**
- ~500 ms p50 instead of ~1.5 s. This is the difference between a product and
  a demo.
- Barge-in that works, which is the single most-noticed quality signal.
- Natural turn-taking: fast acknowledgment of "yeah" without waiting out a
  silence timer.

## Why not the alternatives

**Fixed silence timeout.** Simple, and it costs 500–700 ms on every turn — more
than the entire rest of the budget. Set it short and you interrupt people
mid-sentence; set it long and every turn drags.

**Full-duplex speech-to-speech model.** Genuinely lower latency and the likely
future. Today it gives up the tool-calling reliability and the deterministic
order validation that ADR-0004 depends on, and there is no good local option.
Worth revisiting.

## Revisit if

A local speech-to-speech model with reliable tool calling becomes available.
The ports would need reshaping — a combined `VoiceProvider` — but the Order
Service and everything below it would be untouched.
