# Adapters

One directory per implementation. A vendor SDK may be imported **here and
nowhere else** — that containment is the whole point of
[ADR-0001](../../docs/adr/0001-ports-and-adapters.md).

Planned, in roadmap order:

| Directory | Port | Phase |
| --- | --- | --- |
| `silero-vad/` | `VadProvider` | 2 |
| `faster-whisper/` | `AsrProvider` | 2 |
| `openai-compatible/` | `LlmProvider` — covers vLLM, llama.cpp, Ollama, TGI, LM Studio | 2 |
| `piper/` | `TtsProvider` | 2 |
| `local-file-menu/` | `MenuSource` | 2 |
| `pos-<vendor>/` | `PosProvider` | 3 |
| `anthropic/` | `LlmProvider` | 5 |
| `deepgram/` | `AsrProvider` | 5 |
| `cartesia/` | `TtsProvider` | 5 |

## Writing one

1. Implement the port. Nothing else.
2. Declare `capabilities` honestly. Over-claiming `supportsPartials` will show
   up as a latency regression nobody can explain.
3. Translate vendor errors into `ProviderError` with the right `kind`,
   `retryable`, and `shouldTripBreaker`. The breaker and fallback chain make
   their decisions from these and nothing else.
4. Honor `ctx.signal` promptly. Barge-in depends on it.
5. Pass the conformance suite. One line in a test file:

   ```ts
   import { describeAsrConformance } from '@drivethru/contracts/testing/bun';
   describeAsrConformance('my-adapter', { create: () => new MyAsrProvider() });
   ```

   The suites are documented in
   [`packages/contracts/README.md`](../contracts/README.md). A red check names
   the obligation it enforces, not just the assertion that failed.
6. Register the factory under a stable name; add it to a profile in `config/`.

Do **not** implement retries, timeouts, circuit breaking, or metrics in an
adapter. The runtime wraps every provider with those uniformly
([ADR-0005](../../docs/adr/0005-config-driven-profiles.md)); doing it twice
produces retry storms and latency that does not match the budget.
