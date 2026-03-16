import { loadTagIndex, TagIndexEntry } from './highlight-tag-index';

export interface CrossSiteMatch {
	entry: TagIndexEntry;
	element: Element;
	startOffset: number;
	endOffset: number;
}

const MAX_ENTRIES_TO_SCAN = 200;
const MIN_TAG_LENGTH = 2;

// Normalize whitespace for comparison
function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Find cross-site matches on the current page by matching tag names in page text
export async function findCrossSiteMatches(): Promise<CrossSiteMatch[]> {
	const currentUrl = window.location.href;
	const allEntries = await loadTagIndex();

	// Filter out entries from the current URL, must have tags
	const candidates = allEntries
		.filter(e => e.sourceUrl !== currentUrl)
		.filter(e => e.tags.length > 0)
		.slice(0, MAX_ENTRIES_TO_SCAN);

	if (candidates.length === 0) return [];

	// Collect unique tags across all candidates, mapped to their entries
	const tagToEntries = new Map<string, TagIndexEntry[]>();
	for (const candidate of candidates) {
		for (const tag of candidate.tags) {
			const normalizedTag = tag.toLowerCase().trim();
			if (normalizedTag.length < MIN_TAG_LENGTH) continue;
			if (!tagToEntries.has(normalizedTag)) {
				tagToEntries.set(normalizedTag, []);
			}
			tagToEntries.get(normalizedTag)!.push(candidate);
		}
	}

	if (tagToEntries.size === 0) return [];

	// Walk text nodes to build a searchable text map
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
		textNodes.push({
			node: node as Text,
			start: cumulativeOffset,
			text,
		});
		cumulativeOffset += text.length;
	}

	const fullText = textNodes.map(tn => tn.text).join('');
	const normalizedFull = normalizeText(fullText);

	const matches: CrossSiteMatch[] = [];

	// For each tag, find word-boundary matches in the page text
	for (const [tag, entries] of tagToEntries) {
		// Use word boundary matching to avoid partial matches
		const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`\\b${escapedTag}\\b`, 'gi');
		let regexMatch: RegExpExecArray | null;

		while ((regexMatch = regex.exec(normalizedFull)) !== null) {
			const matchStart = regexMatch.index;
			const matchEnd = matchStart + regexMatch[0].length;

			// Find which text node contains the start of the match
			let startNodeInfo: TextNodeInfo | null = null;
			let normalizedPos = 0;

			for (const tn of textNodes) {
				const normalizedNodeText = normalizeText(tn.text);
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
					const elementNormalized = normalizeText(elementText);
					const localRegex = new RegExp(`\\b${escapedTag}\\b`, 'gi');
					const localMatch = localRegex.exec(elementNormalized);

					if (localMatch) {
						// Create a match for each entry that has this tag
						for (const entry of entries) {
							matches.push({
								entry,
								element,
								startOffset: localMatch.index,
								endOffset: localMatch.index + localMatch[0].length,
							});
						}
					}
				}
			}
		}
	}

	// Deduplicate by entry + element position
	const seen = new Set<string>();
	return matches.filter(m => {
		const key = `${m.entry.highlightId}-${m.startOffset}-${m.endOffset}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
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
