# ADR-0001 — Ports and adapters for every model-shaped dependency

**Status:** Accepted

## Context

ASR, LLM, and TTS are the three components most likely to be replaced, and the
three we have least control over. The state of the art moves in months. Vendors
deprecate endpoints. Some stores will have a GPU and some will not. The brief
explicitly asks that parts be swappable for upgrades or a move to cloud
providers.

The default failure mode is vendor types leaking into application code —
`OpenAI.ChatCompletionChunk` in the orchestrator, `whisper_full_params` in the
audio path — after which a "swap" is a rewrite.

## Decision

Every model-shaped dependency sits behind a port: a narrow interface we own, in
`packages/contracts`, with **no vendor types in any signature**. Adapters
translate, and absorb vendor weirdness so nothing else has to.

Callers branch on **declared capabilities**, never on provider identity. There
is no `if (provider === 'deepgram')` anywhere, because that is the line that
rots first.

Each port has exactly three obligations: a capabilities descriptor, a streaming
method, and a cancellation contract.

## Consequences

**We accept:**
- An indirection layer to read through, and a translation cost per adapter.
- Lowest-common-denominator pressure: a vendor's unique feature is only usable
  if it fits the port or is expressed as a capability.
- Adapters must be written and maintained, each with a conformance run.

**We get:**
- A provider swap is an adapter plus a config line.
- The whole pipeline is testable from WAV files with fake providers.
- Local and cloud are the same code path, so the cloud profile is not a
  second-class citizen that breaks silently.
- Vendor lock-in is bounded to one directory.

## Why not the alternatives

**A vendor-neutral SDK (LiteLLM, LangChain).** Trades our abstraction for
someone else's, which is itself a dependency with its own churn, and it does not
cover ASR/TTS/VAD/POS coherently. Our port surface is small enough that owning
it is cheaper than tracking a framework's.

**Direct vendor SDKs, refactor when needed.** Faster for the first month. The
refactor never fits in a sprint when it finally matters, which is usually during
a deprecation deadline.

## Revisit if

Adapters start needing escape hatches to expose vendor-specific behavior. That
means the port is modeling the problem wrong, and the fix is to redesign the
port — not to add a `raw` field.
