export interface DropdownOption {
	label: string;
	action: string;
}

export class EditorDropdown extends HTMLElement {
	private shadow: ShadowRoot;
	private menu: HTMLElement | null = null;
	private isOpen = false;
	private onAction: ((action: string) => void) | null = null;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open' });
	}

	init(icon: string, title: string, options: DropdownOption[], onAction: (action: string) => void) {
		this.onAction = onAction;

		const style = document.createElement('style');
		style.textContent = `
			:host { position: relative; display: inline-flex; }
			button {
				display: flex; align-items: center; justify-content: center;
				padding: 0 4px; border: none; border-radius: var(--radius-s);
				background: transparent; color: var(--text-muted); cursor: pointer;
				height: 26px; gap: 2px;
			}
			button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
			.chevron { opacity: 0.5; }
			.menu {
				position: absolute; top: 100%; left: 0; z-index: 100;
				background: var(--background-primary); border: 1px solid var(--divider-color);
				border-radius: var(--radius-s); box-shadow: var(--shadow-s);
				min-width: 120px; padding: 4px 0;
			}
			.menu-item {
				display: block; width: 100%; text-align: left; padding: 4px 12px;
				border: none; background: transparent; color: var(--text-normal);
				font-size: var(--font-ui-smaller); cursor: pointer;
			}
			.menu-item:hover { background: var(--background-modifier-hover); }
		`;
		this.shadow.appendChild(style);

		const btn = document.createElement('button');
		btn.title = title;
		btn.type = 'button';
		btn.innerHTML = `${icon} <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		});
		this.shadow.appendChild(btn);

		this.menu = document.createElement('div');
		this.menu.className = 'menu';
		this.menu.hidden = true;

		for (const opt of options) {
			const item = document.createElement('button');
			item.className = 'menu-item';
			item.type = 'button';
			item.textContent = opt.label;
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.onAction?.(opt.action);
				this.close();
			});
			this.menu.appendChild(item);
		}

		this.shadow.appendChild(this.menu);

		// Close on click outside — use mousedown to catch before focus changes
		document.addEventListener('mousedown', (e) => {
			if (this.isOpen && !this.contains(e.target as Node)) {
				this.close();
			}
		});
	}

	private toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	private open() {
		if (this.menu) {
			this.menu.hidden = false;
			this.isOpen = true;
		}
	}

	private close() {
		if (this.menu) {
			this.menu.hidden = true;
			this.isOpen = false;
		}
	}
}

if (!customElements.get('editor-dropdown')) {
	customElements.define('editor-dropdown', EditorDropdown);
}
