import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens';
import { ObsidianLookupClient } from '../api/obsidian-lookup-client';
import { ExtensionTransport } from '../api/transport/extension-transport';

// Register implementations
container.register(TOKENS.LookupClient, { useClass: ObsidianLookupClient });
container.register(TOKENS.Transport, { useClass: ExtensionTransport });

export { container };
