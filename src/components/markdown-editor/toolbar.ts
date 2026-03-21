type ToolbarAction = (action: string) => void;

interface ToolbarButton {
	action: string;
	title: string;
	icon: string;
	separator?: boolean;
}

const BUTTONS: ToolbarButton[] = [
	{ action: 'bold', title: 'Bold', icon: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>' },
	{ action: 'italic', title: 'Italic', icon: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>' },
	{ action: 'strikethrough', title: 'Strikethrough', icon: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>' },
	{ action: 'code', title: 'Code', icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', separator: true },
	{ action: 'h1', title: 'Heading 1', icon: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>' },
	{ action: 'h2', title: 'Heading 2', icon: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>' },
	{ action: 'h3', title: 'Heading 3', icon: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>', separator: true },
	{ action: 'quote', title: 'Quote', icon: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>' },
	{ action: 'ul', title: 'Bullet list', icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
	{ action: 'ol', title: 'Numbered list', icon: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>' },
	{ action: 'checklist', title: 'Task list', icon: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" y1="6" x2="21" y2="6"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/>' },
];

export function createToolbar(onAction: ToolbarAction): HTMLElement {
	const toolbar = document.createElement('div');
	toolbar.className = 'editor-toolbar';

	for (const btn of BUTTONS) {
		if (btn.separator) {
			const sep = document.createElement('div');
			sep.className = 'toolbar-separator';
			toolbar.appendChild(sep);
		}

		const button = document.createElement('button');
		button.className = 'toolbar-btn';
		button.title = btn.title;
		button.type = 'button';
		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${btn.icon}</svg>`;
		button.addEventListener('mousedown', (e) => {
			e.preventDefault(); // Prevent stealing focus from editor
			onAction(btn.action);
		});
		toolbar.appendChild(button);
	}

	return toolbar;
}
