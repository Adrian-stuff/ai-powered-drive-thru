# ADR-0002 — Local inference by default, cloud as a profile

**Status:** Accepted

## Context

Drive-thru ordering is latency-critical (`docs/04`), high-volume, and cannot
stop when the internet does. Cloud inference adds 150–400 ms each way, charges
per token at 300–600 orders/day/lane, and makes a restaurant's ability to sell
food depend on its ISP.

Against that: a GPU box is $2.5–3.5k per store plus IT overhead, local models
are somewhat weaker at reasoning over unusual orders, and some stores cannot
host hardware at all.

## Decision

**Local is the default profile.** ASR, LLM, TTS, and VAD run on an in-store GPU
box. The full ordering path works with the WAN unplugged; only POS sync,
telemetry, and OTA updates may queue.

Cloud is not excluded — it is a profile (`hybrid`, `cloud`) selected per store,
and a `fallback:` target when a local provider's breaker opens.

## Consequences

**We accept:**
- Hardware capex, fleet management, physical installs, and an IT support burden.
- Weaker reasoning than a frontier model on genuinely unusual orders. Mitigated
  by keeping the LLM's job narrow: it maps utterances to tool calls; it does not
  do the reasoning that matters for correctness.
- Model updates become a fleet-rollout problem rather than a vendor's.

**We get:**
- The p50 latency target is achievable at all, which it is not over WAN.
- Marginal cost per order near zero once deployed.
- Customer voice never leaves the building by default, which makes the privacy
  posture in `docs/03` §5 straightforward rather than a negotiation.
- Genuine offline operation.

## Why not the alternatives

**Cloud-only.** Simpler ops, better models, and a p95 near 1.9 s with a hard
dependency on store connectivity. For a business where the cost of a slow lane
is measured in cars per hour, that is the wrong trade — but it is right for some
stores, which is why the profile exists.

**Local-only, no cloud path.** Cheaper to build, and it strands GPU-less stores
while leaving us no recourse when a local model is inadequate for a hard case.

## Revisit if

Cloud TTFT and network latency drop enough to fit the p95 budget, or GPU supply
economics change sharply. The ports mean this is a profile change, not a
rewrite — which is exactly the point of pairing this ADR with ADR-0001.
