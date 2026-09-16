# @drivethru/contracts

The ports, plus the conformance kit and fakes that make them enforceable.
Zero runtime dependencies, zero vendor types — see
[ADR-0001](../../docs/adr/0001-ports-and-adapters.md).

```
src/common.ts      AudioFrame, CallContext, ProviderError, Provider
src/ports/         AsrProvider, LlmProvider, TtsProvider, VadProvider,
                   PosProvider, MenuSource
src/domain/        MenuSnapshot, OrderState, OrderCommand, OrderEvent
src/testing/       conformance kit + fake providers  (import: @drivethru/contracts/testing)
src/testing/bun.ts bun:test bindings                 (import: @drivethru/contracts/testing/bun)
```

## The conformance kit

An interface alone does not make a provider swap cheap. A mechanical answer to
*"does this adapter behave?"* does. Every adapter must pass its port's suite
before it may appear in a profile.

```ts
import { describeAsrConformance } from '@drivethru/contracts/testing/bun';
import { FasterWhisperProvider } from '../src/index.ts';

describeAsrConformance('faster-whisper', {
  create: () => new FasterWhisperProvider({ model: 'large-v3-turbo' }),
});
```

That is the whole integration. Each check becomes one `it()`, named for the
obligation it enforces, and every check gets a **fresh provider** so scripted
state cannot leak between them.

### What the suites enforce

| Port | Checks |
| --- | --- |
| all | id stability, capability stability, `health()` ok after `init()`, `health()` never throws |
| `asr` | a final is always emitted and is always last, confidence in 0..1, partials actually appear when declared, monotonic word timings, vocabulary bias tolerated when unsupported, empty audio terminates, **stops within one frame of abort** |
| `llm` | exactly one `done` delta and it is last, non-negative usage, valid stop reason, **tool calls emitted whole** (never partial JSON), tool names drawn from the offered set, **stops promptly on abort** |
| `tts` | non-empty audio, encoding is one it declared, positive sample rate, incremental text consumed when declared, **no audio after abort** — this one *is* barge-in |
| `vad` | `speech_end` never unpaired, speech detected in a tone burst, monotonic timestamps, **`barge_in` only while ducking**, `reset()` clears state |
| `pos` | distinct tickets, **`syncOrder` idempotent on revision** (the outbox retries), non-negative totals, commit after sync, unknown ticket raises a typed `ProviderError` |

Capability-gated checks **skip** rather than pass when a provider declares it
cannot do the thing. A skip is recorded distinctly, because "we never tested it"
and "it works" are different facts.

### Runner-agnostic by construction

Checks are async functions that throw, not `it()` blocks. `src/testing/bun.ts`
is a thin binding; an adapter on a different runner can call the runner directly:

```ts
const report = await runAsrConformance({ create: () => new MyAsr() });
if (!report.ok) throw new Error(formatReport(report));
```

This is also what makes the kit itself testable — see
`test/conformance-kit.test.ts`, which breaks one obligation at a time in a fake
and asserts the matching check goes red. A suite that passes everything is
worthless; that file is the evidence this one does not.

## The fakes

Scripted providers so the orchestrator and Order Service can be tested end to
end with no GPU and no network.

| Fake | Notable behavior |
| --- | --- |
| `FakeAsrProvider` | cumulative word-by-word partials then a final; records the vocabulary bias it received |
| `FakeLlmProvider` | `respond(req)` router maps an utterance to tool calls — the mode that makes order tests readable; records every request for prompt assertions |
| `FakeTtsProvider` | streams chunks with configurable delay; logs resolved text, including incremental input |
| `FakeVadProvider` | real energy-threshold detection over `patternFrames('..####..')` |
| `FakeMenuSource` | `publish()` and `setUnavailable()` to drive live menu and 86 updates |
| `FakePosProvider` | idempotent on revision; `failFirstNSyncs` models a POS reboot, `totalDriftCents` the price-reconciliation alert |

Every fake also carries a `violations` option that deliberately breaks a
contract. Production tests leave it off — it exists to test the kit.

The fakes are themselves run against the conformance suites
(`test/fakes-conformance.test.ts`). If a fake could drift from its port, every
test built on it would be testing a fiction.

### Test audio without WAV fixtures

`patternFrames('..####..')` — one character per 20 ms frame, `.` silence and
`#` speech. `endlessFrames()` never ends until aborted, which is what the
cancellation checks need: a provider that stops only because its input ran out
has proven nothing.

### `TEST_MENU`

A small fixture that still exercises every rule the Order Service must enforce:
sizes, optional and capped modifier groups, removals, combos with slots,
dayparting, an 86'd item, and aliases that collide on purpose (`"diet"` resolves
at 0.61 confidence, so clarification is reachable). Shared by fakes, checks, and
— from Phase 1 — the Order Service tests, so one fixture defines what "correct"
means everywhere.

## Rule for anyone adding to this package

If a type under `src/ports` or `src/domain` mentions a vendor — a model name, an
SDK type, an endpoint shape — it is in the wrong package. That belongs in the
adapter.

## Not yet built

- **`MenuSource` conformance suite.** `FakeMenuSource` exists and is tested, but
  the port has no suite; live-update semantics need pinning before the second
  menu adapter lands.
- **Fault-injection checks for the error taxonomy.** Verifying that an adapter
  maps vendor errors to the right `ProviderError.kind` needs a way to *provoke*
  each error, which varies per vendor. The POS suite covers the one case that
  can be provoked portably (unknown ticket).
