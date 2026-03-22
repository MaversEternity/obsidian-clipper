import type { ToolbarButtonDef } from './plugin-interface';
import { EditorDropdown } from './components/editor-dropdown';

type ToolbarAction = (action: string) => void;

export interface ToolbarHandle {
	element: HTMLElement;
	setActiveStates(activeFormats: Set<string>): void;
}

interface ToolbarItem {
	type: 'button' | 'separator' | 'dropdown';
	action?: string;
	title?: string;
	icon?: string;
	options?: { label: string; action: string }[];
}

const ICONS = {
	bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
	italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
	strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
	code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
	quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
	ul: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
	ol: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	checklist: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" y1="6" x2="21" y2="6"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/>',
	heading: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/>',
	codeblock: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m9 10-2 2 2 2"/><path d="m15 10 2 2-2 2"/>',
	highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
	footnote: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M12 10v4"/><circle cx="12" cy="8" r="0.5"/>',
};

const BASE_ITEMS: ToolbarItem[] = [
	{
		type: 'dropdown', title: 'Heading', icon: ICONS.heading,
		options: [
			{ label: 'Heading 1', action: 'h1' },
			{ label: 'Heading 2', action: 'h2' },
			{ label: 'Heading 3', action: 'h3' },
		],
	},
	{ type: 'separator' },
	{ type: 'button', action: 'bold', title: 'Bold', icon: ICONS.bold },
	{ type: 'button', action: 'italic', title: 'Italic', icon: ICONS.italic },
	{ type: 'button', action: 'strikethrough', title: 'Strikethrough', icon: ICONS.strikethrough },
	{ type: 'button', action: 'code', title: 'Inline code', icon: ICONS.code },
	{ type: 'button', action: 'highlight', title: 'Highlight', icon: ICONS.highlight },
	{ type: 'button', action: 'codeblock', title: 'Code block', icon: ICONS.codeblock },
	{ type: 'separator' },
	{ type: 'button', action: 'quote', title: 'Blockquote', icon: ICONS.quote },
	{ type: 'button', action: 'ul', title: 'Bullet list', icon: ICONS.ul },
	{ type: 'button', action: 'ol', title: 'Numbered list', icon: ICONS.ol },
	{ type: 'button', action: 'checklist', title: 'Task list', icon: ICONS.checklist },
	{ type: 'separator' },
	{ type: 'button', action: 'footnote', title: 'Footnote', icon: ICONS.footnote },
];

function makeSvg(icon: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
}

export function createToolbar(
	onAction: ToolbarAction,
	pluginButtons: ToolbarButtonDef[] = [],
): ToolbarHandle {
	const toolbar = document.createElement('div');
	toolbar.className = 'editor-toolbar';
	const buttonMap = new Map<string, HTMLElement>();

	for (const item of BASE_ITEMS) {
		if (item.type === 'separator') {
			const sep = document.createElement('div');
			sep.className = 'toolbar-separator';
			toolbar.appendChild(sep);
			continue;
		}

		if (item.type === 'dropdown' && item.options) {
			const dropdown = new EditorDropdown();
			dropdown.init(makeSvg(item.icon!), item.title || '', item.options, onAction);
			toolbar.appendChild(dropdown);
			// Store dropdown reference for heading states
			for (const opt of item.options) {
				buttonMap.set(opt.action, dropdown);
			}
			continue;
		}

		const btn = document.createElement('button');
		btn.className = 'toolbar-btn';
		btn.title = item.title || '';
		btn.type = 'button';
		btn.dataset.action = item.action!;
		btn.innerHTML = makeSvg(item.icon!);
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			onAction(item.action!);
		});
		toolbar.appendChild(btn);
		buttonMap.set(item.action!, btn);
	}

	if (pluginButtons.length > 0) {
		const sep = document.createElement('div');
		sep.className = 'toolbar-separator';
		toolbar.appendChild(sep);

		for (const pb of pluginButtons) {
			const btn = document.createElement('button');
			btn.className = 'toolbar-btn';
			btn.title = pb.title;
			btn.type = 'button';
			btn.innerHTML = makeSvg(pb.icon);
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				pb.onAction(null as any);
			});
			toolbar.appendChild(btn);
			buttonMap.set(pb.action, btn);
		}
	}

	return {
		element: toolbar,
		setActiveStates(activeFormats: Set<string>) {
			const dropdownActive = new Map<EditorDropdown, string>();
			for (const [action, el] of buttonMap) {
				const isActive = activeFormats.has(action);
				if (el instanceof EditorDropdown) {
					if (isActive) dropdownActive.set(el, action);
				} else {
					el.classList.toggle('is-active', isActive);
				}
			}
			// Update all dropdowns — active ones get the action label, inactive ones reset
			const allDropdowns = new Set<EditorDropdown>();
			for (const el of buttonMap.values()) {
				if (el instanceof EditorDropdown) allDropdowns.add(el);
			}
			for (const dd of allDropdowns) {
				const activeAction = dropdownActive.get(dd);
				dd.setActive(!!activeAction, activeAction);
			}
		},
	};
}
