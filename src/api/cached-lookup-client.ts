import { LookupClient, LookupMatch, NoteRef } from './lookup-client';

/**
 * CachedLookupClient — adds caching + client-side regex matching.
 * Subclasses implement fetchData() to load backend data.
 */
export abstract class CachedLookupClient implements LookupClient {
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
