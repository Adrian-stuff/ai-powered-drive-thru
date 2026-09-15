# ADR-0005 — Provider wiring is config, not code

**Status:** Accepted

## Context

ADR-0001 gives us ports and adapters. That alone is not enough to make a swap
*easy*: if choosing a provider means editing a composition root and shipping a
build, then every store variation is a branch, and a failover is a deploy.

Real stores vary. A franchisee insists on a cloud LLM. A store has no GPU. A
store has terrible connectivity and must be pinned local-only. A candidate model
needs shadow traffic in ten stores and nowhere else.

## Decision

Ports are bound to adapters by a **profile**: a YAML file naming an adapter, its
options, an optional `fallback:`, and an optional `shadow:`. The registry
resolves names to factories at startup and fails loudly there rather than at
12:15 on a Saturday.

Three profiles ship: `local` (default), `hybrid`, `cloud`. Profiles live in
GitOps; a per-store overlay is a PR.

Resilience is declared alongside, per port: timeout, retries, breaker
thresholds. The wrappers in `packages/runtime` apply uniformly, so an adapter
author writes the happy path and throws typed errors — retries, breakers,
deadlines, and metrics are never an adapter's concern, and never something
someone forgets.

## Consequences

**We accept:**
- Config becomes a thing that can be wrong, so it needs schema validation,
  startup verification, and review like code.
- Dynamic wiring costs static type-safety at the composition point. Mitigated by
  validating the whole profile against registered adapters at startup.
- A supported profile matrix to test, rather than one path.

**We get:**
- Failover is automatic and declarative, not a try/catch someone wrote once.
- Shadow mode and A/B become config, which is what makes the evaluation loop in
  `docs/09` practical.
- Store-level variation without forks.
- The Phase 5 gate — swap a production LLM provider with zero code changes — is
  achievable, which is how we find out whether ADR-0001 actually paid off.

**Store-local overrides are limited to VAD threshold and TTS volume,** because
those are genuine physical properties of a lane. Everything else being locally
overridable means no two stores are alike, and then nothing is debuggable.

## Why not the alternatives

**Compile-time DI.** Full type safety, and every store variation becomes a
build. Failover becomes a deploy, which means it will not happen during the
outage that needed it.

**Environment variables.** Fine for one provider, hopeless for nested fallback
chains, per-port resilience policy, and shadow config.

## Revisit if

Profiles grow conditional logic. Config that needs `if` statements has become a
programming language, and at that point the answer is a real composition root
for the complex cases, not a template engine in YAML.
