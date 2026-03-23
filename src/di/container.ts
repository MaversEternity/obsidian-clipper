import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from './tokens';
import { ObsidianLookupClient } from '../api/obsidian-lookup-client';

// Register implementations
container.register(TOKENS.LookupClient, { useClass: ObsidianLookupClient });

export { container };
