import { injectable, inject } from 'tsyringe';
import { CachedLookupClient } from './cached-lookup-client';
import { NoteRef } from './lookup-client';
import { ObsidianApiClient } from './obsidian-api-client';
import { TOKENS } from '../di/tokens';
import { syncGet } from './typed-storage';

const MIN_TAG_LENGTH = 2;

/**
 * ObsidianLookupClient — fetches tags via Obsidian REST API, matches client-side.
 */
@injectable()
export class ObsidianLookupClient extends CachedLookupClient {
	private vaultName: string = '';

	constructor(@inject(TOKENS.ObsidianApi) private api: ObsidianApiClient) {
		super();
	}

	protected async fetchData(): Promise<Map<string, NoteRef[]>> {
		// Load vault name
		const vaults = await syncGet('vaults');
		this.vaultName = (vaults || [])[0] || '';

		// Load blacklist
		const settings = await syncGet('general_settings');
		const blacklistTags = new Set(
			(settings?.lookupBlacklistTags || []).map((t: string) => t.toLowerCase().replace(/^#/, '').trim())
		);

		// Fetch all tagged notes (no context filter — applied at query time)
		const result = await this.api.searchTaggedNotes();
		const tagMap = new Map<string, NoteRef[]>();

		if (result.error || !result.notes.length) return tagMap;

		for (const note of result.notes) {
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
