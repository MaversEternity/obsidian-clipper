import { injectable, inject } from 'tsyringe';
import { CachedLookupClient } from './cached-lookup-client';
import { NoteRef } from './lookup-client';
import { Transport } from './transport';
import { TOKENS } from '../di/tokens';
import browser from '../utils/browser-polyfill';

const MIN_TAG_LENGTH = 2;

/**
 * ObsidianLookupClient — fetches tags via Obsidian REST API, matches client-side.
 */
@injectable()
export class ObsidianLookupClient extends CachedLookupClient {
	private vaultName: string = '';

	constructor(@inject(TOKENS.Transport) private transport: Transport) {
		super();
	}

	protected async fetchData(): Promise<Map<string, NoteRef[]>> {
		// Load vault name
		const data = await browser.storage.sync.get('vaults');
		const vaults = Array.isArray(data.vaults) ? data.vaults : [];
		this.vaultName = vaults[0] || '';

		// Load blacklist
		const settingsData = await browser.storage.sync.get('general_settings');
		const settings: { lookupBlacklistTags?: string[] } = settingsData.general_settings || {};
		const blacklistTags = new Set(
			(settings.lookupBlacklistTags || []).map((t: string) => t.toLowerCase().replace(/^#/, '').trim())
		);

		// Load active context
		const contextData = await browser.storage.local.get('activeContext');
		const activeContext = (contextData.activeContext as string) || '';

		// Load REST API config
		const restData = await browser.storage.sync.get('obsidian_rest_api');
		const restConfig = (restData.obsidian_rest_api || {}) as { host?: string; apiKey?: string };
		const host = restConfig.host || 'http://localhost:27123';
		const apiKey = restConfig.apiKey || '';

		// Fetch all tagged notes via typed transport
		const result = await this.transport.send('searchObsidianNotes', { host, apiKey });
		const tagMap = new Map<string, NoteRef[]>();

		if (result.error || !result.notes?.length) return tagMap;

		for (const note of result.notes) {
			// Filter by context
			if (activeContext && !note.filename.startsWith(activeContext + '/')) continue;

			for (const tag of note.tags) {
				const normalized = tag.toLowerCase().replace(/^#/, '').trim();
				if (normalized.length < MIN_TAG_LENGTH) continue;
				if (blacklistTags.has(normalized)) continue;

				if (!tagMap.has(normalized)) {
					tagMap.set(normalized, []);
				}
				tagMap.get(normalized)!.push(this.toNoteRef(note));
			}
		}

		return tagMap;
	}

	private toNoteRef(note: { filename: string; tags: string[] }): NoteRef {
		const withoutExt = note.filename.replace(/\.md$/, '');
		const lastSlash = withoutExt.lastIndexOf('/');
		const name = lastSlash >= 0 ? withoutExt.slice(lastSlash + 1) : withoutExt;
		const path = lastSlash >= 0 ? withoutExt.slice(0, lastSlash) : '';

		return {
			filename: note.filename,
			vault: this.vaultName,
			name,
			path,
			tags: note.tags.map(t => t.replace(/^#/, '')),
		};
	}
}
