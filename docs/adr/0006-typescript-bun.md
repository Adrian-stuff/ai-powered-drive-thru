# ADR-0006 — TypeScript on Bun for the orchestration tier

**Status:** Accepted

## Context

The orchestration tier — dialog management, order state machine, catalog,
adapters, POS integration — is I/O-bound coordination, not numerical work. The
inference tier (vLLM, faster-whisper, Piper) is Python and C++ regardless of
what we choose, and runs as separate processes behind HTTP/gRPC.

So the question is only what language coordinates them.

## Decision

TypeScript on Bun for the orchestration tier. Inference stays in its native
runtimes, reached over local HTTP.

Rationale:
- Structural typing expresses the capability-based port design in ADR-0001
  naturally — discriminated unions for `OrderCommand`, `LlmDelta`, and
  `VadEvent` give exhaustiveness checking where it matters most.
- `AsyncIterable` + `AbortSignal` are exactly the streaming and cancellation
  primitives ADR-0003 needs, built into the language.
- Bun gives fast startup, a built-in test runner, native TypeScript execution,
  and single-binary builds — which matters for shipping to store boxes.
- The customer display and crew UI are web already; sharing the contracts
  package across them is free.

## Consequences

**We accept:**
- A process boundary between orchestration and inference, costing a few ms of
  local HTTP per call. Acceptable against the budget in `docs/04`, and it buys
  independent restart and upgrade of the inference tier.
- Bun is younger than Node. Mitigated by staying close to web-standard APIs, so
  falling back to Node is a runtime swap rather than a rewrite.
- ML tooling is in Python, so eval tooling and any future training lives there.
  This is fine — it is offline work that shares only the data contracts.

**We get:**
- One language across orchestration, adapters, and UI, with shared types.
- Cancellation and streaming that are idiomatic rather than bolted on.
- Fast tests, which is what makes the Phase 1 gate in `docs/07` realistic.

## Why not the alternatives

**Python end to end.** One language with the ML ecosystem; weaker structural
typing for the port design, and `asyncio` cancellation is more error-prone than
`AbortSignal` in exactly the place we cannot afford errors (barge-in).

**Go.** Excellent concurrency and single-binary deploys. Weaker expression of
the discriminated-union-heavy domain model, and no shared types with the web UI.

**Rust.** Best latency and resource control. Slowest iteration, and this tier is
I/O-bound — the performance is not where the problem is. Reasonable for the
Audio Gateway specifically, where AEC and frame handling are real-time work;
that component is isolated enough to write in Rust later without disturbing
anything else.

## Revisit if

The Audio Gateway's real-time requirements outgrow the runtime. That component
is a separate process already, so it can be rewritten independently — which is
the intended answer rather than a language change for the whole tier.
