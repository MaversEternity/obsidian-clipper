import Mark from 'mark.js';
import { getFilteredTagEntries } from './cross-site-matcher';
import { TagIndexEntry } from './highlight-tag-index';

export type MatchClickHandler = (entries: TagIndexEntry[], rect: DOMRect) => void;

let markInstances: Mark[] = [];
let cachedTagEntries: Map<string, TagIndexEntry[]> | null = null;
let cachedOnClick: MatchClickHandler | null = null;
let scrollContainer: HTMLElement | Window | null = null;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let rootEl: HTMLElement | null = null;

function getMarkTargets(root: HTMLElement): (HTMLElement | DocumentFragment)[] {
	const targets: (HTMLElement | DocumentFragment)[] = [root];
	root.querySelectorAll('*').forEach(el => {
		if (el.shadowRoot) {
			targets.push(el.shadowRoot as unknown as DocumentFragment);
		}
	});
	return targets;
}

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

/**
 * Initialize lookup: fetch tags, mark visible content, and set up scroll listener.
 * @param root - element containing markable content
 * @param onClick - handler for when a match is clicked
 * @param container - scroll container (defaults to window)
 */
export async function mark(root: HTMLElement, onClick: MatchClickHandler, container?: HTMLElement): Promise<void> {
	unmark();
	cachedOnClick = onClick;
	rootEl = root;
	scrollContainer = container || window;

	try {
		cachedTagEntries = await getFilteredTagEntries();
		if (cachedTagEntries.size === 0) return;

		markVisible();
		startScrollListener();
	} catch (e) {
		console.warn('Cross-site highlight matching failed:', e);
	}
}

/** Mark only children of root that are currently in the viewport */
export function markVisible(): void {
	if (!cachedTagEntries || cachedTagEntries.size === 0 || !cachedOnClick || !rootEl) return;

	const visible = getVisibleChildren(rootEl);
	for (const el of visible) {
		markElement(el);
	}
}

/** Mark a single element incrementally (skips already-marked text via filter) */
export function markElement(el: HTMLElement): void {
	if (!cachedTagEntries || cachedTagEntries.size === 0 || !cachedOnClick) return;

	const onClick = cachedOnClick;
	const targets = getMarkTargets(el);

	for (const target of targets) {
		const instance = new Mark(target as HTMLElement);
		markInstances.push(instance);

		for (const [tag, entries] of cachedTagEntries) {
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
					'script',
					'style',
					'noscript',
				],
				filter: (textNode: Text) => {
					const parent = textNode.parentElement;
					if (parent && parent.closest('note-match')) return false;
					return true;
				},
				each: (element: HTMLElement) => {
					if (!element.shadowRoot) {
						const shadow = element.attachShadow({ mode: 'open' });
						shadow.innerHTML = '<style>:host{background:rgba(100,180,255,.2);border-bottom:2px solid rgba(100,180,255,.7);border-radius:2px;cursor:pointer;padding:1px 0}</style><slot></slot>';
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
}

function onScroll() {
	if (scrollTimeout) clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => markVisible(), 200);
}

function startScrollListener() {
	if (!scrollContainer) return;
	scrollContainer.addEventListener('scroll', onScroll, { passive: true });
}

export function unmark(): void {
	if (scrollContainer) {
		scrollContainer.removeEventListener('scroll', onScroll);
	}
	for (const inst of markInstances) {
		inst.unmark();
	}
	markInstances = [];
	cachedTagEntries = null;
	scrollContainer = null;
	rootEl = null;
}
