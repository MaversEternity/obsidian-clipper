import { LookupClient, LookupMatch, NoteRef } from './lookup-client';
import browser from '../utils/browser-polyfill';

/**
 * CachedLookupClient — adds caching + client-side regex matching.
 * Cache stores ALL notes; context filter applied at query time.
 */
export abstract class CachedLookupClient implements LookupClient {
	private cache: Map<string, NoteRef[]> | null = null;

	async match(text: string): Promise<LookupMatch[]> {
		const tagMap = await this.getTagMap();
		if (tagMap.size === 0) return [];

		// Load active context — filter at query time, not cache time
		const contextData = await browser.storage.local.get('activeContext');
		const activeContext = (contextData.activeContext as string) || '';

		const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
		const matches: LookupMatch[] = [];

		for (const [tag, notes] of tagMap) {
			// Apply context filter
			const filtered = activeContext
				? notes.filter(n => n.filename.startsWith(activeContext + '/'))
				: notes;
			if (filtered.length === 0) continue;

			const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(`\\b${escapedTag}\\b`, 'i');

			if (regex.test(normalizedText)) {
				matches.push({ tag, notes: filtered });
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
