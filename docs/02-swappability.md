# 02 — Swappability

The brief: *"make the architecture so some parts can be easily swapped in case we
upgrade or move to cloud providers."* This document is the answer.

## 1. The rule

> Anything whose implementation we might buy, rent, or replace sits behind a
> **port** — a narrow interface owned by us, in `packages/contracts`, with zero
> vendor types in its signature.

Vendor SDK types never cross into application code. Not `OpenAI.ChatCompletion`,
not `Deepgram.LiveTranscription`, not `whisper_full_params`. An adapter's job is
to translate, and to absorb the vendor's weirdness so nothing else has to.

## 2. The ports

| Port | Responsibility | Local default | Cloud option |
| --- | --- | --- | --- |
| `AsrProvider` | streaming audio → transcript hypotheses | `faster-whisper` (large-v3-turbo, int8) or NVIDIA Parakeet | Deepgram Nova, AssemblyAI, Google STT |
| `LlmProvider` | messages + tools → text / tool calls, streaming | vLLM or llama.cpp serving Qwen3-8B / Llama 3.1 8B | Claude, GPT, Gemini |
| `TtsProvider` | text → streaming audio, cancellable | Piper (fast) or Kokoro-82M (better prosody) | ElevenLabs, Cartesia, Azure TTS |
| `VadProvider` | frames → speech boundary events | Silero VAD | provider-native endpointing |
| `PosProvider` | confirmed order → POS ticket | — (always vendor-specific) | NCR, Oracle Micros, Toast, Qu |
| `MenuSource` | published menu → catalog snapshot | local JSON + file watch | chain menu API |
| `TelemetrySink` | spans, metrics, transcripts | local OTLP → disk buffer | vendor OTLP endpoint |
| `SessionStore` | live + recent session state | SQLite / embedded KV | Postgres, Redis |

Each port has three things and nothing more: a **capabilities descriptor**, a
**streaming method**, and a **cancellation contract**. See
[`packages/contracts/src`](../packages/contracts/src).

## 3. Capabilities, not feature flags

Providers differ in what they can do. Rather than branching on provider names —
`if (provider === 'deepgram')`, the thing that rots — every provider declares
capabilities, and callers branch on those:

```ts
const asr = registry.get('asr');
if (asr.capabilities.supportsPartials) {
  // pre-warm the LLM on partial hypotheses
} else {
  // wait for the final; budget an extra 120 ms
}
```

Adding a provider means implementing an interface and declaring what it can do.
It never means editing a switch statement in the orchestrator.

## 4. Profiles: swapping is a config change

`config/providers.*.yaml` wires ports to adapters. Nothing else changes.

```yaml
# config/providers.local.yaml — the default
profile: local
providers:
  asr:
    adapter: faster-whisper
    options: { model: large-v3-turbo, device: cuda, compute_type: int8_float16 }
  llm:
    adapter: openai-compatible          # vLLM speaks this; so does llama.cpp
    options: { base_url: http://127.0.0.1:8000/v1, model: qwen3-8b-instruct }
  tts:
    adapter: piper
    options: { voice: en_US-amy-medium }
```

```yaml
# config/providers.hybrid.yaml — local ears and mouth, cloud brain
profile: hybrid
providers:
  asr: { adapter: faster-whisper, options: { model: large-v3-turbo } }
  tts: { adapter: piper,          options: { voice: en_US-amy-medium } }
  llm:
    adapter: anthropic
    options: { model: claude-sonnet-5 }
    fallback:                            # breaker trips → local, automatically
      adapter: openai-compatible
      options: { base_url: http://127.0.0.1:8000/v1, model: qwen3-8b-instruct }
```

A GPU-less store runs `providers.cloud.yaml`. The same binary, the same order
logic, the same tests.

Note that the **local LLM adapter is `openai-compatible`**, not `llama-cpp`.
vLLM, llama.cpp's server, Ollama, TGI, and LM Studio all expose that wire
format, so one adapter covers the entire local-serving ecosystem and upgrading
the runtime is a URL change.

## 5. Resilience is a wrapper, not a provider's problem

Every adapter is wrapped by the runtime before the application sees it:

```
Application
   └── TimeoutWrapper      per-port deadline from the latency budget
       └── CircuitBreaker  open on error rate or p95 breach
           └── FallbackChain  primary → secondary → degraded response
               └── TelemetryWrapper  spans, token counts, audio duration
                   └── Adapter (vendor SDK lives only in here)
```

An adapter author writes the happy path and throws typed errors. Retries,
breakers, deadlines, and metrics are the runtime's job, applied uniformly. This
is also what makes a cloud fallback safe: the breaker owns the decision, not a
try/catch someone forgot to write.

## 6. What makes a swap actually cheap

Interfaces alone do not make a swap cheap. Three more things do:

**A conformance suite.** `packages/contracts` ships a test kit (built — see
[its README](../packages/contracts/README.md)). A new adapter proves it
satisfies the port — streaming order, cancellation mid-stream, capability
honesty, typed errors — before it is allowed in a profile. Swapping a provider
that passes the suite is boring, which is the goal.

The kit is itself tested: `test/conformance-kit.test.ts` breaks one obligation
at a time in a fake and asserts the matching check fails. A suite nobody has
tried to fool is a suite nobody should trust.

**A golden eval set.** 500 recorded orders with expected `OrderState` outcomes
(see [`docs/09-evaluation.md`](09-evaluation.md)). A candidate provider must
match or beat the incumbent on accuracy and latency. The decision to swap is
then data, not vibes.

**Shadow mode.** The runtime can run a second provider in parallel on live
traffic, discard its output, and record the diff. You learn how a new model
behaves on real drunk 1 a.m. customers before it ever speaks to one.

## 7. What is deliberately *not* swappable

Being honest about this matters as much as the ports:

- **The Order Service and its state machine.** This is our domain logic. It is
  the thing that must not vary. No plugin architecture, no rules engine, no
  LLM in the loop.
- **The `OrderEvent` schema.** Persisted, replayed, and consumed by POS, display,
  and analytics. Versioned and additive-only.
- **The tool schema the LLM sees.** It can gain tools; existing tool semantics
  are frozen, because prompts, evals, and fine-tunes all depend on them.

A seam everywhere is its own kind of mess. These three are load-bearing.
