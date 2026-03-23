import 'reflect-metadata';
import { container, Lifecycle } from 'tsyringe';
import { TOKENS } from './tokens';
import { ObsidianLookupClient } from '../api/obsidian-lookup-client';
import { ExtensionTransport } from '../api/transport/extension-transport';
import { ObsidianApiClient } from '../api/obsidian-api-client';

// Register implementations — singletons so caches persist
container.register(TOKENS.LookupClient, { useClass: ObsidianLookupClient }, { lifecycle: Lifecycle.Singleton });
container.register(TOKENS.Transport, { useClass: ExtensionTransport }, { lifecycle: Lifecycle.Singleton });
container.register(TOKENS.ObsidianApi, { useClass: ObsidianApiClient }, { lifecycle: Lifecycle.Singleton });

export { container };

/** Convenience accessors for non-DI code */
export function getObsidianApi(): ObsidianApiClient {
	return container.resolve(TOKENS.ObsidianApi) as ObsidianApiClient;
}
