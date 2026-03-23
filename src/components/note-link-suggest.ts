import { getObsidianApi } from '../di/container';

const STYLES = `
:host {
	display: flex;
	flex-grow: 1;
	position: relative;
}
::slotted(textarea) {
	flex-grow: 1;
}
.dropdown {
	position: absolute;
	bottom: 100%;
	left: 0;
	right: 0;
	max-height: 200px;
	overflow-y: auto;
	background: var(--background-primary, #fff);
	border: 1px solid var(--divider-color, #e0e0e0);
	border-radius: 6px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	z-index: 100;
	margin-bottom: 2px;
}
.item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	cursor: pointer;
	font-size: 13px;
	font-family: var(--font-interface, -apple-system, BlinkMacSystemFont, sans-serif);
	color: var(--text-normal, #333);
}
.item.is-selected {
	background: var(--interactive-accent, #7b6cd9);
	color: var(--text-on-accent, #fff);
}
.item.is-selected .path {
	color: var(--text-on-accent, #fff);
	opacity: 0.7;
}
.name {
	flex-shrink: 0;
}
.path {
	color: var(--text-muted, #999);
	font-size: 11px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
`;

export class NoteLinkSuggest extends HTMLElement {
	private shadow: ShadowRoot;
	private textarea: HTMLTextAreaElement | null = null;
	private dropdown: HTMLElement | null = null;
	private notes: string[] = [];
	private filtered: string[] = [];
	private selectedIndex = 0;
	private triggerStart = -1;
	private active = false;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		style.textContent = STYLES;
		this.shadow.appendChild(style);
		this.shadow.appendChild(document.createElement('slot'));
	}

	connectedCallback() {
		this.textarea = this.querySelector('textarea');
		console.debug('[note-link-suggest] connected, textarea:', !!this.textarea);
		if (!this.textarea) return;

		this.textarea.addEventListener('input', this.onInput);
		this.textarea.addEventListener('keydown', this.onKeydown);
		document.addEventListener('click', this.onDocumentClick);
	}

	disconnectedCallback() {
		if (this.textarea) {
			this.textarea.removeEventListener('input', this.onInput);
			this.textarea.removeEventListener('keydown', this.onKeydown);
		}
		document.removeEventListener('click', this.onDocumentClick);
		this.close();
	}

	private onInput = async () => {
		const ta = this.textarea!;
		const pos = ta.selectionStart;
		const text = ta.value;

		const before = text.slice(0, pos);
		const triggerIdx = before.lastIndexOf('[[');
		console.debug('[note-link-suggest] input, trigger at:', triggerIdx, 'before:', before.slice(-10));

		if (triggerIdx === -1 || before.indexOf(']]', triggerIdx) !== -1) {
			this.close();
			return;
		}

		const query = before.slice(triggerIdx + 2);

		if (query.includes('\n')) {
			this.close();
			return;
		}

		this.triggerStart = triggerIdx;

		if (this.notes.length === 0) {
			const result = await getObsidianApi().listNotes();
			console.debug('[note-link-suggest] fetch result:', result.notes?.length, 'error:', result.error);
			if (result.error || result.notes.length === 0) {
				this.close();
				return;
			}
			this.notes = result.notes;
		}

		this.filter(query);
		console.debug('[note-link-suggest] filtered:', this.filtered.length, 'query:', query);
		if (this.filtered.length > 0) {
			this.show();
		} else {
			this.close();
		}
	};

	private onKeydown = (e: KeyboardEvent) => {
		if (!this.active || !this.dropdown) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
			this.updateSelection();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
			this.updateSelection();
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (this.filtered.length > 0) {
				e.preventDefault();
				this.select(this.filtered[this.selectedIndex]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
		}
	};

	private onDocumentClick = (e: MouseEvent) => {
		if (this.active && !this.contains(e.target as Node)) {
			this.close();
		}
	};

	private filter(query: string) {
		const q = query.toLowerCase();
		this.filtered = this.notes
			.filter(n => n.replace(/\.md$/, '').toLowerCase().includes(q))
			.slice(0, 20);
		this.selectedIndex = 0;
	}

	private show() {
		if (!this.dropdown) {
			this.dropdown = document.createElement('div');
			this.dropdown.className = 'dropdown';
			this.shadow.appendChild(this.dropdown);
		}

		this.dropdown.innerHTML = '';
		this.filtered.forEach((note, i) => {
			const item = document.createElement('div');
			item.className = 'item' + (i === this.selectedIndex ? ' is-selected' : '');

			const notePath = note.replace(/\.md$/, '');
			const lastSlash = notePath.lastIndexOf('/');
			const name = lastSlash >= 0 ? notePath.slice(lastSlash + 1) : notePath;
			const folder = lastSlash >= 0 ? notePath.slice(0, lastSlash) : '';

			const nameEl = document.createElement('span');
			nameEl.className = 'name';
			nameEl.textContent = name;
			item.appendChild(nameEl);

			if (folder) {
				const pathEl = document.createElement('span');
				pathEl.className = 'path';
				pathEl.textContent = folder;
				item.appendChild(pathEl);
			}

			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.select(note);
			});
			item.addEventListener('mouseenter', () => {
				this.selectedIndex = i;
				this.updateSelection();
			});

			this.dropdown!.appendChild(item);
		});

		this.active = true;
	}

	private updateSelection() {
		if (!this.dropdown) return;
		const items = this.dropdown.querySelectorAll('.item');
		items.forEach((item, i) => {
			item.classList.toggle('is-selected', i === this.selectedIndex);
		});
		items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
	}

	private select(note: string) {
		const ta = this.textarea!;
		const notePath = note.replace(/\.md$/, '');
		const lastSlash = notePath.lastIndexOf('/');
		const name = lastSlash >= 0 ? notePath.slice(lastSlash + 1) : notePath;

		const link = lastSlash >= 0 ? `[[${notePath}|${name}]]` : `[[${notePath}]]`;

		const before = ta.value.slice(0, this.triggerStart);
		const after = ta.value.slice(ta.selectionStart);
		ta.value = before + link + after;

		const newPos = before.length + link.length;
		ta.selectionStart = ta.selectionEnd = newPos;
		ta.focus();

		ta.dispatchEvent(new Event('input', { bubbles: true }));
		this.close();
	}

	private close() {
		if (this.dropdown) {
			this.dropdown.remove();
			this.dropdown = null;
		}
		this.active = false;
	}
}

if (!customElements.get('note-link-suggest')) {
	customElements.define('note-link-suggest', NoteLinkSuggest);
	console.debug('[note-link-suggest] registered');
}
