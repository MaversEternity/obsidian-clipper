import Mark from 'mark.js';
import { getFilteredTagEntries } from './cross-site-matcher';
import { TagIndexEntry } from './highlight-tag-index';

export type MatchClickHandler = (entries: TagIndexEntry[], rect: DOMRect) => void;

let markInstances: Mark[] = [];

function getMarkTargets(root: HTMLElement): (HTMLElement | DocumentFragment)[] {
	const targets: (HTMLElement | DocumentFragment)[] = [root];
	root.querySelectorAll('*').forEach(el => {
		if (el.shadowRoot) {
			targets.push(el.shadowRoot as unknown as DocumentFragment);
		}
	});
	return targets;
}

export async function mark(root: HTMLElement, onClick: MatchClickHandler): Promise<void> {
	unmark();

	try {
		const tagEntries = await getFilteredTagEntries();
		if (tagEntries.size === 0) return;

		const targets = getMarkTargets(root);

		for (const target of targets) {
			const instance = new Mark(target as HTMLElement);
			markInstances.push(instance);

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
						element.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							onClick(entries, element.getBoundingClientRect());
						});
					},
				});
			}
		}
	} catch (e) {
		console.warn('Cross-site highlight matching failed:', e);
	}
}

export function unmark(): void {
	for (const inst of markInstances) {
		inst.unmark();
	}
	markInstances = [];
}
