/**
 * LookupService facade — abstracts note matching from the backend.
 * Current impl: ObsidianLookupService (REST API + client-side matching)
 * Future impl: RemoteLookupService (custom server with DB-side matching)
 */

export interface NoteRef {
	filename: string;
	vault: string;
	name: string;
	path: string;
	tags: string[];
}

export interface LookupMatch {
	tag: string;
	notes: NoteRef[];
}

export interface LookupService {
	/** Given page text, return notes whose tags appear in it */
	match(text: string): Promise<LookupMatch[]>;
}

/**
 * LookupService with client-side caching.
 * Subclasses implement fetchData() to load backend data.
 * invalidate() clears the cache, forcing next match() to re-fetch.
 */
export abstract class CachedLookupService implements LookupService {
	private cache: Map<string, NoteRef[]> | null = null;

	async match(text: string): Promise<LookupMatch[]> {
		const tagMap = await this.getTagMap();
		if (tagMap.size === 0) return [];

		const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
		const matches: LookupMatch[] = [];

		for (const [tag, notes] of tagMap) {
			const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(`\\b${escapedTag}\\b`, 'i');

			if (regex.test(normalizedText)) {
				matches.push({ tag, notes });
			}
		}

		return matches;
	}

	invalidate(): void {
		this.cache = null;
	}

	private async getTagMap(): Promise<Map<string, NoteRef[]>> {
		if (this.cache) return this.cache;
		this.cache = await this.fetchData();
		return this.cache;
	}

	/** Fetch tag→notes map from the backend. Called once, then cached. */
	protected abstract fetchData(): Promise<Map<string, NoteRef[]>>;
}
