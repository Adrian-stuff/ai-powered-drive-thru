# AI-Powered Drive-Thru

A voice ordering system for quick-service restaurant drive-thrus that runs its
inference **locally, at the store**, and can swap any model or vendor without
touching business logic.

> Status: **architecture / planning**. This repository currently contains the
> design, the port interfaces, and the provider registry. No adapter is
> implemented yet — see [`docs/07-roadmap.md`](docs/07-roadmap.md).

## Why local-first

| Driver | Consequence |
| --- | --- |
| Latency | Round-tripping audio to a cloud region adds 150–400 ms each way. Local inference keeps end-of-speech → first-audio under ~800 ms. |
| Availability | A store cannot stop selling food because an ISP is down. Local inference degrades to "slower", not "offline". |
| Cost | A drive-thru does 300–600 orders/day/lane. Per-token cloud pricing scales with volume; a GPU is a fixed cost. |
| Data | Customer voice never leaves the building unless we explicitly ship it for training. |

## Why swappable anyway

Local-first is a *default*, not a religion. Models improve monthly, and some
stores will not justify a GPU. Every model-shaped dependency sits behind a port
(see [`docs/02-swappability.md`](docs/02-swappability.md)), so a store can run:

- **local** — everything on the in-store box (default)
- **cloud** — everything hosted, for low-volume or GPU-less stores
- **hybrid** — local ASR/TTS for latency, cloud LLM for reasoning quality
- **failover** — local primary, cloud secondary, automatic on breaker trip

...by changing one config file. Nothing in the order logic knows the difference.

## Read the docs in this order

1. [Overview & scope](docs/00-overview.md)
2. [Architecture](docs/01-architecture.md)
3. [Swappability model](docs/02-swappability.md)
4. [Data contracts](docs/03-data-contracts.md)
5. [Latency budget](docs/04-latency-budget.md)
6. [Hardware & model sizing](docs/05-hardware-sizing.md)
7. [Deployment & operations](docs/06-deployment-and-ops.md)
8. [Roadmap](docs/07-roadmap.md)
9. [Risks](docs/08-risks.md)
10. [Evaluation](docs/09-evaluation.md)

Decisions and their trade-offs live in [`docs/adr/`](docs/adr/).

## Layout

```
docs/                 architecture, ADRs, ops runbooks
packages/contracts/   the ports — TypeScript interfaces, zero dependencies
packages/runtime/     provider registry, config loading, resilience wrappers
packages/adapters/    one directory per vendor implementation (not yet built)
config/               per-profile provider wiring (local / cloud / hybrid)
```

## Toolchain

Bun. `bun install`, `bun test`, `bun run typecheck`.
