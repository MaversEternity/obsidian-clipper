import Mark from 'mark.js';
import { getFilteredTagEntries, clearTagCache } from './cross-site-matcher';
import { TagIndexEntry } from './highlight-tag-index';

export type MatchClickHandler = (entries: TagIndexEntry[], rect: DOMRect) => void;

let cachedTagEntries: Map<string, TagIndexEntry[]> | null = null;
let cachedOnClick: MatchClickHandler | null = null;
let scrollContainer: HTMLElement | Window | null = null;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let rootEl: HTMLElement | null = null;
let isMarking = false;

// Track which elements have been marked in current viewport cycle
const markedElements = new WeakSet<HTMLElement>();

const SCROLL_DEBOUNCE_MS = 200;

// Shared shadow root styles — created once, reused
const MATCH_STYLE = '<style>:host{background:rgba(100,180,255,.2);border-bottom:2px solid rgba(100,180,255,.7);border-radius:2px;cursor:pointer;padding:1px 0}</style><slot></slot>';

function getVisibleChildren(root: HTMLElement): HTMLElement[] {
	const containerRect = scrollContainer instanceof Window
		? { top: 0, bottom: window.innerHeight }
		: (scrollContainer as HTMLElement).getBoundingClientRect();

	const visible: HTMLElement[] = [];
	for (const child of Array.from(root.children) as HTMLElement[]) {
		const rect = child.getBoundingClientRect();
		if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
			visible.push(child);
		}
	}
	return visible;
}

function markElement(el: HTMLElement, tagEntries: Map<string, TagIndexEntry[]>, onClick: MatchClickHandler): void {
	// Skip if already marked in this cycle
	if (markedElements.has(el)) return;
	markedElements.add(el);

	const instance = new Mark(el);
	for (const [tag, entries] of tagEntries) {
		instance.mark(tag, {
			element: 'note-match',
			className: '',
			separateWordSearch: false,
			acrossElements: true,
			caseSensitive: false,
			accuracy: {
				value: 'exactly',
				limiters: [',', '.', '!', '?', ':', ';'],
			},
			exclude: [
				'.obsidian-highlight-overlay',
				'.obsidian-highlighter-menu',
				'.obsidian-highlight-context-menu',
				'.obsidian-note-popup',
				'.canvasWrapper',
				'script', 'style', 'noscript',
			],
			filter: (textNode: Text) => {
				const parent = textNode.parentElement;
				if (parent && parent.closest('note-match')) return false;
				return true;
			},
			each: (element: HTMLElement) => {
				// Reuse existing shadow root if present
				if (!element.shadowRoot) {
					const shadow = element.attachShadow({ mode: 'open' });
					shadow.innerHTML = MATCH_STYLE;
				}
				element.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					e.preventDefault();
				});
				element.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					onClick(entries, element.getBoundingClientRect());
				});
			},
		});
	}
}

function onScroll() {
	if (scrollTimeout) clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => markVisible(), SCROLL_DEBOUNCE_MS);
}

/**
 * Initialize lookup: fetch tags, mark visible content, and set up scroll listener.
 */
export async function mark(root: HTMLElement, onClick: MatchClickHandler, container?: HTMLElement): Promise<void> {
	if (isMarking) return;
	isMarking = true;

	try {
		unmark();
		cachedOnClick = onClick;
		rootEl = root;
		scrollContainer = container || window;

		cachedTagEntries = await getFilteredTagEntries();
		if (cachedTagEntries.size === 0) return;

		markVisible();
		scrollContainer.addEventListener('scroll', onScroll, { passive: true });
	} catch (e) {
		console.warn('Cross-site highlight matching failed:', e);
	} finally {
		isMarking = false;
	}
}

/** Mark only children of root that are currently in the viewport */
export function markVisible(): void {
	if (!cachedTagEntries || cachedTagEntries.size === 0 || !cachedOnClick || !rootEl) return;

	const visible = getVisibleChildren(rootEl);
	for (const el of visible) {
		markElement(el, cachedTagEntries, cachedOnClick);
	}
}

/**
 * Re-fetch tags from Obsidian and re-mark visible content.
 * Call after adding/deleting notes.
 */
export async function refresh(): Promise<void> {
	if (!rootEl || !cachedOnClick) return;
	const root = rootEl;
	const onClick = cachedOnClick;
	const container = scrollContainer instanceof Window ? undefined : scrollContainer as HTMLElement;

	// Clear the tag cache so fresh data is fetched
	clearTagCache();
	await mark(root, onClick, container);
}

/** Remove all marks from root */
export function unmark(): void {
	if (scrollContainer) {
		scrollContainer.removeEventListener('scroll', onScroll);
	}
	if (scrollTimeout) {
		clearTimeout(scrollTimeout);
		scrollTimeout = null;
	}
	if (rootEl) {
		new Mark(rootEl).unmark();
	}
	cachedTagEntries = null;
	scrollContainer = null;
	rootEl = null;

	// WeakSet entries are GC'd automatically when elements are removed from DOM
	// No manual cleanup needed
}
