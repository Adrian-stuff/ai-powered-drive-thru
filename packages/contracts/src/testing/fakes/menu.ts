import type { HealthStatus } from '../../common.ts';
import type { MenuSnapshot } from '../../domain/menu.ts';
import type { MenuSource, MenuSourceCapabilities } from '../../ports/menu.ts';
import { TEST_MENU } from '../fixtures/menu.ts';

export interface FakeMenuSourceOptions {
  readonly id?: string;
  readonly capabilities?: Partial<MenuSourceCapabilities>;
  readonly snapshot?: MenuSnapshot;
}

const DEFAULT_CAPABILITIES: MenuSourceCapabilities = {
  supportsLiveUpdates: true,
  supportsDayparting: true,
};

export class FakeMenuSource implements MenuSource {
  readonly id: string;
  readonly capabilities: MenuSourceCapabilities;

  initCount = 0;
  disposeCount = 0;

  #snapshot: MenuSnapshot;
  #listeners = new Set<(snapshot: MenuSnapshot) => void>();

  constructor(options: FakeMenuSourceOptions = {}) {
    this.id = options.id ?? 'fake-menu';
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.#snapshot = options.snapshot ?? TEST_MENU;
  }

  async init(): Promise<void> {
    this.initCount += 1;
  }

  async health(): Promise<HealthStatus> {
    return { ok: this.disposeCount === 0 };
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
    this.#listeners.clear();
  }

  async fetch(_storeId: string): Promise<MenuSnapshot> {
    return this.#snapshot;
  }

  async *subscribe(_storeId: string, signal: AbortSignal): AsyncIterable<MenuSnapshot> {
    yield this.#snapshot;

    const queue: MenuSnapshot[] = [];
    let wake: (() => void) | undefined;
    const listener = (snapshot: MenuSnapshot) => {
      queue.push(snapshot);
      wake?.();
    };
    this.#listeners.add(listener);

    try {
      while (!signal.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          wake = undefined;
        }
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
        }
      }
    } finally {
      this.#listeners.delete(listener);
    }
  }

  /** Publish a new menu version to every subscriber. */
  publish(snapshot: MenuSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  /** 86 an item, the way a store does mid-rush. */
  setUnavailable(skus: readonly string[]): void {
    this.publish({ ...this.#snapshot, unavailableSkus: skus });
  }
}
