import { loadTagIndex, TagIndexEntry } from './highlight-tag-index';
import { getElementByXPath } from './dom-utils';

export interface CrossSiteMatch {
	entry: TagIndexEntry;
	element: Element;
	startOffset: number;
	endOffset: number;
}

const MIN_MATCH_LENGTH = 20;
const MAX_ENTRIES_TO_SCAN = 200;

// Normalize whitespace for comparison
function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Find cross-site matches on the current page
export async function findCrossSiteMatches(): Promise<CrossSiteMatch[]> {
	const currentUrl = window.location.href;
	const allEntries = await loadTagIndex();

	// Filter out entries from the current URL and too-short texts
	const candidates = allEntries
		.filter(e => e.sourceUrl !== currentUrl)
		.filter(e => e.textContent.length >= MIN_MATCH_LENGTH)
		.slice(0, MAX_ENTRIES_TO_SCAN);

	if (candidates.length === 0) return [];

	const matches: CrossSiteMatch[] = [];
	const pageText = document.body.textContent || '';
	const normalizedPageText = normalizeText(pageText);

	// Quick pre-filter: only process candidates whose text appears on the page
	const relevantCandidates = candidates.filter(c =>
		normalizedPageText.includes(normalizeText(c.textContent))
	);

	if (relevantCandidates.length === 0) return [];

	// Walk text nodes to find precise positions
	const treeWalker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) => {
				// Skip hidden elements, script/style content, and our own overlays
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

	// Build a map of text nodes with their cumulative offsets
	interface TextNodeInfo {
		node: Text;
		start: number; // cumulative start offset in the concatenated text
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

	// Concatenated page text from text nodes
	const fullText = textNodes.map(tn => tn.text).join('');
	const normalizedFull = normalizeText(fullText);

	for (const candidate of relevantCandidates) {
		const searchText = normalizeText(candidate.textContent);
		let searchStart = 0;

		// Find all occurrences
		while (searchStart < normalizedFull.length) {
			const idx = normalizedFull.indexOf(searchText, searchStart);
			if (idx === -1) break;

			// Map normalized index back to the original text position (approximate)
			// Find which text node contains this position
			const matchStart = idx;
			const matchEnd = idx + searchText.length;

			// Find the element containing the start of the match
			let startNodeInfo: TextNodeInfo | null = null;
			let endNodeInfo: TextNodeInfo | null = null;
			let normalizedPos = 0;

			for (const tn of textNodes) {
				const normalizedNodeText = normalizeText(tn.text);
				const nodeEnd = normalizedPos + normalizedNodeText.length;

				if (!startNodeInfo && matchStart < nodeEnd) {
					startNodeInfo = tn;
				}
				if (matchEnd <= nodeEnd) {
					endNodeInfo = tn;
					break;
				}
				normalizedPos += normalizedNodeText.length;
			}

			if (startNodeInfo) {
				// Find the closest block-level parent
				const element = findBlockParent(startNodeInfo.node);
				if (element) {
					// Calculate offsets within the element
					const elementText = element.textContent || '';
					const candidateNormalized = normalizeText(candidate.textContent);
					const elementNormalized = normalizeText(elementText);
					const localIdx = elementNormalized.indexOf(candidateNormalized);

					if (localIdx !== -1) {
						matches.push({
							entry: candidate,
							element,
							startOffset: localIdx,
							endOffset: localIdx + candidateNormalized.length,
						});
					}
				}
			}

			searchStart = idx + searchText.length;
		}
	}

	// Deduplicate by element + entry
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
