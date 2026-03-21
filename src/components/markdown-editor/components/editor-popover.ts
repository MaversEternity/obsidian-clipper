export interface PopoverField {
	name: string;
	placeholder?: string;
	value?: string;
}

export interface PopoverConfig {
	fields: PopoverField[];
	submitLabel?: string;
}

export class EditorPopover extends HTMLElement {
	private shadow: ShadowRoot;
	private resolve: ((values: Record<string, string> | null) => void) | null = null;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open' });
	}

	show(config: PopoverConfig): Promise<Record<string, string> | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.render(config);
		});
	}

	private render(config: PopoverConfig) {
		this.shadow.innerHTML = '';

		const style = document.createElement('style');
		style.textContent = `
			:host {
				position: absolute; top: 0; left: 0; right: 0; z-index: 100;
			}
			.popover {
				background: var(--background-primary); border: 1px solid var(--divider-color);
				border-radius: var(--radius-s); box-shadow: var(--shadow-s); padding: 8px;
			}
			.field { margin-bottom: 6px; }
			input {
				width: 100%; padding: 4px 8px; border: 1px solid var(--divider-color);
				border-radius: var(--radius-s); background: var(--background-primary);
				color: var(--text-normal); font-size: var(--font-ui-smaller);
				font-family: var(--font-default); box-sizing: border-box;
			}
			input:focus { outline: none; border-color: var(--interactive-accent); }
			.actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
			button {
				padding: 4px 12px; border-radius: var(--radius-s); font-size: var(--font-ui-smaller);
				cursor: pointer; border: none;
			}
			.cancel { background: transparent; color: var(--text-muted); }
			.submit { background: var(--interactive-accent); color: var(--text-on-accent); }
		`;
		this.shadow.appendChild(style);

		const popover = document.createElement('div');
		popover.className = 'popover';

		const form = document.createElement('form');
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			e.stopPropagation();
			console.debug('[editor-popover] form submitted');
			this.submit(config);
		});

		for (const field of config.fields) {
			const div = document.createElement('div');
			div.className = 'field';
			const input = document.createElement('input');
			input.type = 'text';
			input.name = field.name;
			input.placeholder = field.placeholder || '';
			if (field.value) input.value = field.value;
			div.appendChild(input);
			form.appendChild(div);
		}

		const actions = document.createElement('div');
		actions.className = 'actions';

		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'cancel';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', () => this.cancel());

		const submitBtn = document.createElement('button');
		submitBtn.type = 'button'; // Use button type + click handler instead of form submit
		submitBtn.className = 'submit';
		submitBtn.textContent = config.submitLabel || 'Insert';
		submitBtn.addEventListener('click', () => {
			console.debug('[editor-popover] submit clicked');
			this.submit(config);
		});

		actions.appendChild(cancelBtn);
		actions.appendChild(submitBtn);
		form.appendChild(actions);
		popover.appendChild(form);
		this.shadow.appendChild(popover);

		// Focus first input
		requestAnimationFrame(() => {
			const firstInput = this.shadow.querySelector('input') as HTMLInputElement;
			firstInput?.focus();
		});

		// Escape to close
		this.onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.cancel();
			}
		};
		this.addEventListener('keydown', this.onKeydown);
	}

	private onKeydown: ((e: KeyboardEvent) => void) | null = null;

	private submit(config: PopoverConfig) {
		const values: Record<string, string> = {};
		for (const field of config.fields) {
			const input = this.shadow.querySelector(`[name="${field.name}"]`) as HTMLInputElement;
			values[field.name] = input?.value || '';
		}
		this.resolve?.(values);
		this.cleanup();
	}

	private cancel() {
		this.resolve?.(null);
		this.cleanup();
	}

	private cleanup() {
		if (this.onKeydown) {
			this.removeEventListener('keydown', this.onKeydown);
		}
		this.remove();
	}
}

if (!customElements.get('editor-popover')) {
	customElements.define('editor-popover', EditorPopover);
}
