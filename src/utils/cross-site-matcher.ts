import { fetchAllTaggedNotes } from './obsidian-rest-api';
import { TagIndexEntry } from './highlight-tag-index';
import browser from './browser-polyfill';

export interface CrossSiteMatch {
	entries: TagIndexEntry[];
	element: Element;
	startOffset: number;
	endOffset: number;
}

const MIN_TAG_LENGTH = 2;

// Cache for Obsidian tags — refreshed once per page load
let cachedTagMap: Map<string, { filename: string; tags: string[] }[]> | null = null;
let cachedVaultName: string = '';

/** Clear the tag cache so next getFilteredTagEntries() re-fetches from Obsidian */
export function clearTagCache(): void {
	cachedTagMap = null;
}

async function getObsidianTagMap(): Promise<Map<string, { filename: string; tags: string[] }[]>> {
	if (cachedTagMap) return cachedTagMap;

	// Get vault name and blacklist from storage
	const data = await browser.storage.sync.get('vaults');
	const vaults = Array.isArray(data.vaults) ? data.vaults : [];
	cachedVaultName = vaults[0] || '';

	// Load blacklisted tags
	const settingsData = await browser.storage.sync.get('general_settings');
	const settings: { lookupBlacklistTags?: string[]; lookupBlacklistDomains?: string[] } = settingsData.general_settings || {};
	const blacklistTags = new Set(
		(settings.lookupBlacklistTags || []).map((t: string) => t.toLowerCase().replace(/^#/, '').trim())
	);

	const result = await fetchAllTaggedNotes();
	const tagMap = new Map<string, { filename: string; tags: string[] }[]>();

	if (result.error || !result.notes.length) {
		cachedTagMap = tagMap;
		return tagMap;
	}

	for (const note of result.notes) {
		for (const tag of note.tags) {
			const normalized = tag.toLowerCase().replace(/^#/, '').trim();
			if (normalized.length < MIN_TAG_LENGTH) continue;
			if (blacklistTags.has(normalized)) continue;
			if (!tagMap.has(normalized)) {
				tagMap.set(normalized, []);
			}
			tagMap.get(normalized)!.push(note);
		}
	}

	cachedTagMap = tagMap;
	return tagMap;
}

// Convert an Obsidian note to a TagIndexEntry for overlay compatibility
function noteToTagIndexEntry(note: { filename: string; tags: string[] }, matchedTag: string): TagIndexEntry {
	// Extract note name and path from filename (e.g., "Clippings/My Note.md")
	const withoutExt = note.filename.replace(/\.md$/, '');
	const lastSlash = withoutExt.lastIndexOf('/');
	const name = lastSlash >= 0 ? withoutExt.slice(lastSlash + 1) : withoutExt;
	const path = lastSlash >= 0 ? withoutExt.slice(0, lastSlash) : '';

	return {
		highlightId: `obsidian-${note.filename}`,
		sourceUrl: '',
		textContent: '',
		tags: note.tags.map(t => t.replace(/^#/, '')),
		noteRef: {
			vault: cachedVaultName,
			name,
			path,
		},
	};
}

// Return the filtered tag→entries map for use with mark.js
export async function getFilteredTagEntries(): Promise<Map<string, TagIndexEntry[]>> {
	const tagMap = await getObsidianTagMap();
	if (tagMap.size === 0) return new Map();

	const contextData = await browser.storage.local.get('activeContext');
	const activeContext = (contextData.activeContext as string) || '';

	const result = new Map<string, TagIndexEntry[]>();
	for (const [tag, notes] of tagMap) {
		const filtered = activeContext
			? notes.filter(n => n.filename.startsWith(activeContext + '/'))
			: notes;
		if (filtered.length > 0) {
			result.set(tag, filtered.map(n => noteToTagIndexEntry(n, tag)));
		}
	}
	return result;
}

// Find cross-site matches by looking up Obsidian note tags in page text
export async function findCrossSiteMatches(): Promise<CrossSiteMatch[]> {
	const tagMap = await getObsidianTagMap();
	if (tagMap.size === 0) return [];

	// Filter by active context (directory prefix)
	const contextData = await browser.storage.local.get('activeContext');
	const activeContext = (contextData.activeContext as string) || '';

	// If a context is set, filter tagMap to only include notes from that directory
	const filteredTagMap = new Map<string, { filename: string; tags: string[] }[]>();
	for (const [tag, notes] of tagMap) {
		const filtered = activeContext
			? notes.filter(n => n.filename.startsWith(activeContext + '/'))
			: notes;
		if (filtered.length > 0) {
			filteredTagMap.set(tag, filtered);
		}
	}
	if (filteredTagMap.size === 0) return [];

	// Walk text nodes to build searchable text
	const treeWalker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) => {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName.toUpperCase();
				if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
				if (parent.closest('.obsidian-highlight-overlay, .obsidian-highlighter-menu, .obsidian-highlight-context-menu, .obsidian-note-popup')) {
					return NodeFilter.FILTER_REJECT;
				}
				if (node.textContent && node.textContent.trim().length > 0) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			}
		}
	);

	interface TextNodeInfo {
		node: Text;
		start: number;
		text: string;
	}
	const textNodes: TextNodeInfo[] = [];
	let cumulativeOffset = 0;
	let node: Node | null;

	while ((node = treeWalker.nextNode())) {
		const text = node.textContent || '';
		textNodes.push({ node: node as Text, start: cumulativeOffset, text });
		cumulativeOffset += text.length;
	}

	const fullText = textNodes.map(tn => tn.text).join('');
	const normalizedFull = fullText.replace(/\s+/g, ' ').trim().toLowerCase();

	// Collect raw matches grouped by position key
	const positionMap = new Map<string, { entries: TagIndexEntry[]; element: Element; startOffset: number; endOffset: number }>();

	// For each Obsidian tag, find word-boundary matches in page text
	for (const [tag, notes] of filteredTagMap) {
		const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`\\b${escapedTag}\\b`, 'gi');
		let regexMatch: RegExpExecArray | null;

		while ((regexMatch = regex.exec(normalizedFull)) !== null) {
			const matchStart = regexMatch.index;

			// Find which text node contains this match
			let startNodeInfo: TextNodeInfo | null = null;
			let normalizedPos = 0;

			for (const tn of textNodes) {
				const normalizedNodeText = tn.text.replace(/\s+/g, ' ').trim().toLowerCase();
				const nodeEnd = normalizedPos + normalizedNodeText.length;

				if (!startNodeInfo && matchStart < nodeEnd) {
					startNodeInfo = tn;
					break;
				}
				normalizedPos += normalizedNodeText.length;
			}

			if (startNodeInfo) {
				const element = findBlockParent(startNodeInfo.node);
				if (element) {
					const elementText = element.textContent || '';
					const elementNormalized = elementText.replace(/\s+/g, ' ').trim().toLowerCase();
					const localRegex = new RegExp(`\\b${escapedTag}\\b`, 'gi');
					const localMatch = localRegex.exec(elementNormalized);

					if (localMatch) {
						const posKey = `${localMatch.index}-${localMatch.index + localMatch[0].length}`;
						if (!positionMap.has(posKey)) {
							positionMap.set(posKey, {
								entries: [],
								element,
								startOffset: localMatch.index,
								endOffset: localMatch.index + localMatch[0].length,
							});
						}
						const group = positionMap.get(posKey)!;
						// Add all notes for this tag, deduplicating by filename
						const existingIds = new Set(group.entries.map(e => e.highlightId));
						for (const note of notes) {
							const entry = noteToTagIndexEntry(note, tag);
							if (!existingIds.has(entry.highlightId)) {
								group.entries.push(entry);
								existingIds.add(entry.highlightId);
							}
						}
					}
				}
			}
		}
	}

	// Merge smaller matches into larger ones that fully contain them
	const matches = Array.from(positionMap.values());
	matches.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

	const filtered: CrossSiteMatch[] = [];
	for (const match of matches) {
		const container = filtered.find(existing =>
			existing.element === match.element &&
			existing.startOffset <= match.startOffset &&
			existing.endOffset >= match.endOffset
		);
		if (container) {
			// Merge the smaller match's entries into the larger one
			const existingIds = new Set(container.entries.map(e => e.highlightId));
			for (const entry of match.entries) {
				if (!existingIds.has(entry.highlightId)) {
					container.entries.push(entry);
					existingIds.add(entry.highlightId);
				}
			}
		} else {
			filtered.push(match);
		}
	}

	return filtered;
}

// Find the nearest block-level parent element
function findBlockParent(node: Node): Element | null {
	const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'FIGURE', 'TABLE', 'DIV', 'ARTICLE', 'SECTION'];
	let current: Node | null = node.parentNode;
	while (current) {
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (BLOCK_TAGS.includes(el.tagName.toUpperCase())) {
				return el;
			}
		}
		current = current.parentNode;
	}
	return document.body;
}
