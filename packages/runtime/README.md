# @drivethru/runtime

Wiring and resilience. Everything here is about *how* a provider is called, not
*what* it does.

- `config.ts` — the profile schema (`config/providers.*.yaml` deserializes into this)
- `registry.ts` — name → factory, built once at startup from config

Still to build (see `docs/07-roadmap.md`): the resilience wrappers described in
`docs/02-swappability.md` §5 — timeout, circuit breaker, fallback chain, shadow
runner, and telemetry — each of which decorates a `Provider` and returns the
same interface, so the application cannot tell they are there.
