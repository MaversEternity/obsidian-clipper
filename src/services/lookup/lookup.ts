import Mark from 'mark.js';
import { container } from 'tsyringe';
import { LookupClient, LookupMatch, NoteRef } from '../../api/lookup-client';
import { TOKENS } from '../../di/tokens';
import browser from '../../utils/browser-polyfill';

export type MatchClickHandler = (notes: NoteRef[], tag: string, rect: DOMRect) => void;

let cachedMatches: LookupMatch[] | null = null;
let cachedOnClick: MatchClickHandler | null = null;
let scrollContainer: HTMLElement | Window | null = null;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let rootEl: HTMLElement | null = null;
let isMarking = false;

let markedElements = new WeakSet<HTMLElement>();
const SCROLL_DEBOUNCE_MS = 200;

const MATCH_STYLE = '<style>:host{background:rgba(100,180,255,.2);border-bottom:2px solid rgba(100,180,255,.7);border-radius:2px;cursor:pointer;padding:1px 0}</style><slot></slot>';

/** Resolve LookupClient from DI container */
function getService(): LookupClient {
	return container.resolve(TOKENS.LookupClient);
}

async function isDomainBlacklisted(): Promise<boolean> {
	try {
		const hostname = window.location.hostname;
		if (!hostname) return false;
		const data = await browser.storage.sync.get('general_settings');
		const settings: { lookupBlacklistDomains?: string[] } = data.general_settings || {};
		const blacklist: string[] = settings.lookupBlacklistDomains || [];
		return blacklist.some(domain => {
			const d = domain.trim().toLowerCase();
			return hostname === d || hostname.endsWith('.' + d);
		});
	} catch {
		return false;
	}
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

function markElement(el: HTMLElement, matches: LookupMatch[], onClick: MatchClickHandler): void {
	if (markedElements.has(el)) return;
	markedElements.add(el);

	const instance = new Mark(el);
	for (const match of matches) {
		instance.mark(match.tag, {
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
					onClick(match.notes, match.tag, element.getBoundingClientRect());
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
 * Initialize lookup: match page text via service, highlight visible matches.
 */
export async function mark(root: HTMLElement, onClick: MatchClickHandler, container?: HTMLElement): Promise<void> {
	if (isMarking) return;
	isMarking = true;

	try {
		if (await isDomainBlacklisted()) {
			isMarking = false;
			return;
		}

		unmark();
		markedElements = new WeakSet();
		cachedOnClick = onClick;
		rootEl = root;
		scrollContainer = container || window;

		const svc = getService();
		console.log('[lookup] service instance:', (svc as any).__id || ((svc as any).__id = Math.random()));
		const pageText = root.innerText || root.textContent || '';
		cachedMatches = await svc.match(pageText);
		console.log('[lookup] matches:', cachedMatches.length, cachedMatches.map(m => m.tag));
		if (!cachedMatches.length) return;

		markVisible();
		scrollContainer.addEventListener('scroll', onScroll, { passive: true });
	} catch (e) {
		console.warn('Lookup matching failed:', e);
	} finally {
		isMarking = false;
	}
}

/** Mark only children of root that are currently in the viewport */
export function markVisible(): void {
	if (!cachedMatches || cachedMatches.length === 0 || !cachedOnClick || !rootEl) return;

	const visible = getVisibleChildren(rootEl);
	for (const el of visible) {
		markElement(el, cachedMatches, cachedOnClick);
	}
}

/**
 * Re-fetch and re-mark. Call after adding/deleting notes.
 */
export async function refresh(): Promise<void> {
	if (!rootEl || !cachedOnClick) return;
	const root = rootEl;
	const onClick = cachedOnClick;
	const svcContainer = scrollContainer instanceof Window ? undefined : scrollContainer as HTMLElement;
	const svc = getService();
	if ('invalidate' in svc) (svc as any).invalidate();
	await mark(root, onClick, svcContainer);
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
	cachedMatches = null;
	scrollContainer = null;
	rootEl = null;
}

/** Invalidate the service cache (e.g., on context switch or note save) */
export function invalidateCache(): void {
	const service = getService();
	if ('invalidate' in service && typeof (service as any).invalidate === 'function') {
		(service as any).invalidate();
	}
	cachedMatches = null;
}
