# 04 — Latency Budget

The target: **end-of-speech → first audible syllable, p50 ≤ 500 ms, p95 ≤ 900 ms.**

Past roughly one second the customer assumes they were not heard and starts
talking again, which forces a barge-in and costs a full turn. Latency is not a
polish item here; it is the difference between a system that works and one the
crew unplugs.

## Budget, local profile

| Stage | p50 | p95 | Notes |
| --- | --- | --- | --- |
| Endpoint detection | 120 ms | 250 ms | Semantic endpointing; a fixed silence timer would cost 500–700 ms alone |
| ASR finalization | 90 ms | 180 ms | Partials already streamed; only the tail is new work |
| Catalog resolution | 5 ms | 15 ms | In-memory, no model |
| LLM time-to-first-token | 140 ms | 280 ms | 8B, int8, prefix cache warm, ~900-token prompt |
| LLM tool call complete | 60 ms | 140 ms | Short structured output, grammar-constrained |
| Order Service validation | 3 ms | 10 ms | Pure computation |
| TTS time-to-first-audio | 70 ms | 150 ms | Piper streams; first chunk is ~40 ms of audio |
| Audio output buffer | 20 ms | 40 ms | |
| **Total** | **~510 ms** | **~1065 ms** | p95 is over budget — see mitigations |

The p50 lands where we want it. The p95 does not, and the honest answer is that
the tail is where this project will actually be won or lost.

## Where the p95 goes, and what to do about it

**1. Fast paths skip the model entirely.** "Yes", "no", "that's it", "make it
large", and single-item orders that resolve above the confidence threshold are
handled by the catalog resolver and a small intent classifier. That is ~40 % of
turns at roughly 180 ms total, which pulls the aggregate p95 down more than any
model optimization.

**2. Speculative prefill on partials.** The orchestrator starts the LLM prefill
on a stable partial transcript rather than waiting for the final. When the final
matches the partial (~75 % of the time), time-to-first-token effectively
disappears. When it does not, the speculative request is cancelled — which is
why every port's methods take an `AbortSignal`.

**3. Filler audio buys 300 ms.** Starting "okay, —" as soon as endpointing fires
is an honest acknowledgment, not a trick, and it is what humans do. It moves
perceived latency well below actual latency. Use sparingly: every turn gets
grating.

**4. Pin the model in VRAM.** No lazy loading, no unload-on-idle. A cold start
mid-rush is a 4-second turn, which is an abandoned order.

**5. Keep the prompt short and stable.** The system prompt and tool schema must
be byte-identical across turns so prefix caching actually hits. Put the volatile
part — order state, candidate SKUs — at the *end* of the prompt. Getting this
backwards silently costs ~100 ms per turn and is easy to do by accident.

## Cloud profile, for comparison

| Stage | p50 | p95 |
| --- | --- | --- |
| Endpoint + network out | 180 ms | 320 ms |
| Cloud ASR final | 140 ms | 300 ms |
| Cloud LLM TTFT | 320 ms | 700 ms |
| Cloud TTS first audio | 180 ms | 400 ms |
| Network in + jitter buffer | 60 ms | 180 ms |
| **Total** | **~880 ms** | **~1900 ms** |

Usable, clearly worse, and highly sensitive to the store's connection. This is
the trade the `cloud` profile makes explicit, and the reason `local` is default.

## Enforcement

Budgets are not comments. Each stage's deadline is a `timeoutMs` in
`config/providers.*.yaml`, and a breach is a circuit-breaker failure, not merely
a slow turn. Every stage emits a span; the p95 per stage per store is a
dashboard, and a regression is a release blocker.
