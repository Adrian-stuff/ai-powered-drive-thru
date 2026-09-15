# 06 — Deployment & Operations

## Deployment model

Each store box runs a small set of containers under `podman` with systemd units.
No Kubernetes — one node does not need a scheduler, and IT has to be able to
reason about the box at 6 a.m. with no context.

```
drivethru-audio      privileged, owns the sound device
drivethru-runtime    orchestrator, order service, catalog, POS adapter
drivethru-inference  vLLM (or llama.cpp) — GPU
drivethru-asr        faster-whisper — GPU
drivethru-tts        piper — CPU
drivethru-supervisor watchdog, breakers, takeover, health
```

Images are pinned by digest. Model weights are versioned artifacts pulled from
the model registry and content-addressed, never `latest`.

## Rollout

Never fleet-wide. The failure mode of a bad model is not a crash — it is orders
that are subtly wrong, which you only see in the remake rate a day later.

1. **Shadow** — new provider runs in parallel on live audio, output discarded,
   diffs recorded. 1 week.
2. **Canary** — 1 store, off-peak dayparts only. Watch containment, accuracy,
   p95, remake rate. 1 week.
3. **Ring 1** — 10 stores across different accents and noise profiles. 2 weeks.
4. **Fleet** — staged 10 %/day, with automatic rollback triggers.

Automatic rollback when, over a 30-minute window: containment drops >5 pts,
order accuracy drops >1 pt, p95 latency exceeds budget by >20 %, or handoff rate
doubles. Rollback is a config revert to the previous adapter and model digest,
and it must complete without a site visit.

## Observability

Three questions the dashboard answers, per store and per lane:

**Is it fast?** p50/p95 per pipeline stage. Stage-level, not end-to-end only —
"the turn was slow" is not actionable, "TTS TTFA regressed" is.

**Is it right?** Containment, handoff rate, per-turn confidence distribution,
command rejection rate by reason, and — the one that matters most — **remake
rate**, joined from POS voids. A system that is fast, confident, and wrong is
the worst outcome, and only the remake rate catches it.

**Is it healthy?** GPU utilization and temperature, VRAM headroom, breaker
states, outbox depth, model version per store, disk headroom.

Alerts that page: lane down, POS outbox not draining, containment below floor
for 30 min, breaker open >5 min. Everything else is a dashboard.

## Configuration management

Config is GitOps: the fleet repo holds per-store profile overlays, a change is a
PR, and the store box pulls and validates. A store can be pinned to a profile
(a franchisee who insists on cloud LLM, a store with bad connectivity pinned to
local-only) without forking anything.

Store-local overrides are allowed for exactly two things — VAD threshold and TTS
volume — because those are genuinely physical properties of the lane. Everything
else being overridable locally means no two stores are the same, and then
nothing is debuggable.

## Runbooks

| Symptom | First check | Action |
| --- | --- | --- |
| Lane silent | Supervisor health, audio container | Restart audio unit; if the box is unreachable, L5 relay is already engaged — confirm crew has headset |
| Every turn slow | GPU temp/throttling, VRAM | Check for a stuck model load; verify prefix cache hit rate |
| Wrong items ordered | Menu version, alias index, 86 list | Usually a stale catalog after a publish — force a catalog rebuild |
| Orders not on POS | Outbox depth, POS reachability | Outbox drains on recovery; escalate if depth grows >20 min |
| Customers repeating themselves | Endpointing p95, VAD threshold | Noisy lane — retune threshold; check mic gain and AEC |

## Model and menu updates

**Menu** — published from the chain, applied within 60 s, rebuilds the catalog
and refreshes ASR vocabulary bias. 86'd items apply immediately without a
rebuild.

**Models** — pulled during a maintenance window, staged on disk, swapped on
restart at a store-local low-traffic hour. Never during service. The previous
version stays on disk for one-command rollback.
