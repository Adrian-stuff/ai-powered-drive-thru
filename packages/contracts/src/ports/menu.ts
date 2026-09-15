import type { Provider } from '../common.ts';
import type { MenuSnapshot } from '../domain/menu.ts';

export interface MenuSourceCapabilities {
  /** Pushes updates (86'd items, LTO activation) rather than requiring a poll. */
  readonly supportsLiveUpdates: boolean;
  readonly supportsDayparting: boolean;
}

export interface MenuSource extends Provider<MenuSourceCapabilities> {
  fetch(storeId: string): Promise<MenuSnapshot>;
  /** Long-lived; yields a new snapshot whenever the menu changes. */
  subscribe(storeId: string, signal: AbortSignal): AsyncIterable<MenuSnapshot>;
}
