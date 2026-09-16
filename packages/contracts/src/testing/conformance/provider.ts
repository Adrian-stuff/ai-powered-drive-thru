import type { Provider } from '../../common.ts';
import type { Check } from '../types.ts';
import { require } from '../types.ts';

/**
 * Obligations every provider carries regardless of port, from the `Provider`
 * interface in `src/common.ts`. Composed into each port's suite.
 */
export function lifecycleChecks<T extends Provider<unknown>>(): readonly Check<T>[] {
  return [
    {
      name: 'id_is_stable_and_non_empty',
      obligation: 'Provider.id identifies the adapter in telemetry and breaker state.',
      async run(p) {
        // Read twice: `id` may be a getter, and breaker/telemetry state is keyed
        // on it, so an id that varies between reads silently splits both.
        const first = p.id;
        const second = p.id;
        require(typeof first === 'string' && first.length > 0, 'id must be a non-empty string');
        require(first === second, `id changed between reads: "${first}" then "${second}"`);
      },
    },
    {
      name: 'capabilities_are_stable',
      obligation:
        'Callers branch on capabilities; they are read repeatedly and must not vary between reads.',
      async run(p) {
        const first = JSON.stringify(p.capabilities);
        const second = JSON.stringify(p.capabilities);
        require(first === second, 'capabilities changed between reads');
        require(p.capabilities !== null && typeof p.capabilities === 'object', 'capabilities must be an object');
      },
    },
    {
      name: 'health_ok_after_init',
      obligation: 'The Supervisor polls health(); a freshly initialized provider must report ok.',
      async run(p) {
        const status = await p.health();
        require(status.ok === true, `health() returned ok=false after init: ${status.detail ?? ''}`);
      },
    },
    {
      name: 'health_does_not_throw',
      obligation:
        'health() is a liveness probe on the supervision path. It reports failure via ok=false, never by throwing.',
      async run(p) {
        await p.health();
      },
    },
  ];
}
