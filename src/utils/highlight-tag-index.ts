import browser from './browser-polyfill';
import { AnyHighlightData, NoteRef } from './highlighter';

export interface TagIndexEntry {
	highlightId: string;
	sourceUrl: string;
	textContent: string;
	tags: string[];
	noteRef?: NoteRef;
}

// Storage key for the tag index
const TAG_INDEX_KEY = 'highlightTagIndex';
const MAX_TEXT_LENGTH = 500;
const MAX_INDEX_ENTRIES = 1000;

// Load the full tag index from storage
export async function loadTagIndex(): Promise<TagIndexEntry[]> {
	const result = await browser.storage.local.get(TAG_INDEX_KEY);
	return (result[TAG_INDEX_KEY] || []) as TagIndexEntry[];
}

// Save the tag index to storage
async function saveTagIndex(entries: TagIndexEntry[]): Promise<void> {
	// Cap at max entries
	const trimmed = entries.slice(0, MAX_INDEX_ENTRIES);
	await browser.storage.local.set({ [TAG_INDEX_KEY]: trimmed });
}

// Update the tag index for a given URL's highlights
export async function updateTagIndex(sourceUrl: string, highlights: AnyHighlightData[]): Promise<void> {
	const existing = await loadTagIndex();

	// Remove all entries for this URL
	const filtered = existing.filter(e => e.sourceUrl !== sourceUrl);

	// Add entries for tagged highlights
	const newEntries: TagIndexEntry[] = highlights
		.filter(h => h.tags && h.tags.length > 0)
		.map(h => ({
			highlightId: h.id,
			sourceUrl: h.sourceUrl || sourceUrl,
			textContent: (h.textContent || '').slice(0, MAX_TEXT_LENGTH),
			tags: h.tags || [],
			noteRef: h.noteRef,
		}));

	const merged = [...filtered, ...newEntries];
	await saveTagIndex(merged);
}

// Remove all entries for a given URL
export async function removeUrlFromTagIndex(sourceUrl: string): Promise<void> {
	const existing = await loadTagIndex();
	const filtered = existing.filter(e => e.sourceUrl !== sourceUrl);
	await saveTagIndex(filtered);
}

// Get all tagged highlights (optionally filtered by tag)
export async function getTaggedHighlights(tag?: string): Promise<TagIndexEntry[]> {
	const entries = await loadTagIndex();
	if (tag) {
		return entries.filter(e => e.tags.includes(tag.toLowerCase()));
	}
	return entries;
}

// Get all unique tags across all highlights
export async function getAllTags(): Promise<string[]> {
	const entries = await loadTagIndex();
	const tagSet = new Set<string>();
	for (const entry of entries) {
		for (const tag of entry.tags) {
			tagSet.add(tag);
		}
	}
	return Array.from(tagSet).sort();
}
