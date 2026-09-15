import type { Provider } from '@drivethru/contracts';
import type { AdapterConfig, PortName, RuntimeConfig } from './config.ts';

/**
 * An adapter package registers a factory under its name. The registry never
 * imports adapters directly — that is what keeps vendor SDKs out of the
 * dependency graph of anything that does not use them.
 */
export type AdapterFactory<P extends Provider<unknown> = Provider<unknown>> = (
  options: Record<string, unknown>,
) => P;

export class ProviderRegistry {
  readonly #factories = new Map<string, AdapterFactory>();
  readonly #instances = new Map<PortName, Provider<unknown>>();

  register(name: string, factory: AdapterFactory): void {
    if (this.#factories.has(name)) {
      throw new Error(`Adapter "${name}" is already registered`);
    }
    this.#factories.set(name, factory);
  }

  /**
   * Builds every port from config and wraps each in the resilience stack.
   * Fails loudly at startup rather than at 12:15 on a Saturday.
   */
  async build(config: RuntimeConfig): Promise<void> {
    for (const [port, adapterConfig] of Object.entries(config.providers)) {
      const provider = this.#instantiate(adapterConfig);
      await provider.init();
      this.#instances.set(port as PortName, provider);
    }
  }

  #instantiate(config: AdapterConfig): Provider<unknown> {
    const factory = this.#factories.get(config.adapter);
    if (!factory) {
      throw new Error(
        `No adapter registered for "${config.adapter}". Registered: ${[...this.#factories.keys()].join(', ')}`,
      );
    }
    return factory(config.options ?? {});
  }

  get<T extends Provider<unknown>>(port: PortName): T {
    const instance = this.#instances.get(port);
    if (!instance) throw new Error(`Port "${port}" was not built`);
    return instance as T;
  }
}
