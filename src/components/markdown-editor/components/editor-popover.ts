import { $setSelection } from 'lexical';

export interface PopoverField {
	name: string;
	label?: string;
	placeholder?: string;
	value?: string;
	required?: boolean;
	type?: string;
}

export interface PopoverConfig {
	title?: string;
	fields: PopoverField[];
	submitLabel?: string;
	cancelLabel?: string;
	/** Pass the Lexical editor to save/restore selection */
	editor?: any;
}

export class EditorPopover extends HTMLElement {
	private shadow: ShadowRoot;
	private resolve: ((values: Record<string, string> | null) => void) | null = null;
	private editor: any = null;
	private savedEditorState: any = null;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open' });
	}

	show(config: PopoverConfig): Promise<Record<string, string> | null> {
		this.editor = config.editor || null;
		// Save Lexical's editor state (includes selection) before dialog steals focus
		if (this.editor) {
			this.savedEditorState = this.editor.getEditorState().clone();
		}
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
				position: fixed; inset: 0; z-index: 1000;
				display: flex; align-items: center; justify-content: center;
			}
			.backdrop {
				position: absolute; inset: 0;
				background: rgba(0, 0, 0, 0.5);
			}
			.dialog {
				position: relative;
				background: var(--background-primary, #1a1a1b);
				border: 1px solid var(--divider-color, #343536);
				border-radius: 16px;
				box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
				padding: 24px;
				min-width: 360px;
				max-width: 480px;
				width: 100%;
			}
			.header {
				display: flex; align-items: center; justify-content: space-between;
				margin-bottom: 20px;
			}
			.title {
				font-size: 18px; font-weight: 600;
				color: var(--text-normal, #d7dadc);
				margin: 0;
			}
			.close-btn {
				display: flex; align-items: center; justify-content: center;
				width: 32px; height: 32px; padding: 0; border: none;
				border-radius: 50%; background: transparent;
				color: var(--text-muted, #818384); cursor: pointer;
				transition: background 0.15s;
			}
			.close-btn:hover {
				background: var(--background-modifier-hover, #2a2a2b);
				color: var(--text-normal, #d7dadc);
			}
			.field {
				margin-bottom: 16px;
			}
			.field-wrapper {
				position: relative;
				border: 1px solid var(--divider-color, #343536);
				border-radius: 12px;
				padding: 8px 12px;
				transition: border-color 0.15s;
			}
			.field-wrapper:focus-within {
				border-color: var(--interactive-accent, #4f7df9);
			}
			label {
				display: block;
				font-size: 11px; font-weight: 500;
				color: var(--text-muted, #818384);
				margin-bottom: 2px;
			}
			.required { color: var(--text-error, #ff4500); }
			input {
				width: 100%; padding: 0; border: none;
				background: transparent;
				color: var(--text-normal, #d7dadc);
				font-size: 14px;
				font-family: var(--font-default);
				box-sizing: border-box;
				outline: none;
			}
			input::placeholder { color: var(--text-faint, #545456); }
			.actions {
				display: flex; gap: 12px; margin-top: 24px;
			}
			.actions button {
				flex: 1; padding: 10px 16px;
				border-radius: 24px;
				font-size: 14px; font-weight: 600;
				cursor: pointer; border: none;
				transition: opacity 0.15s;
			}
			.actions button:hover { opacity: 0.85; }
			.cancel-btn {
				background: var(--background-modifier-hover, #2a2a2b);
				color: var(--text-normal, #d7dadc);
			}
			.submit-btn {
				background: var(--interactive-accent, #4f7df9);
				color: var(--text-on-accent, #fff);
			}
		`;
		this.shadow.appendChild(style);

		// Backdrop
		const backdrop = document.createElement('div');
		backdrop.className = 'backdrop';
		backdrop.addEventListener('click', () => this.cancel());
		this.shadow.appendChild(backdrop);

		// Dialog
		const dialog = document.createElement('div');
		dialog.className = 'dialog';

		// Header
		if (config.title) {
			const header = document.createElement('div');
			header.className = 'header';

			const title = document.createElement('h2');
			title.className = 'title';
			title.textContent = config.title;

			const closeBtn = document.createElement('button');
			closeBtn.type = 'button';
			closeBtn.className = 'close-btn';
			closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
			closeBtn.addEventListener('click', () => this.cancel());

			header.appendChild(title);
			header.appendChild(closeBtn);
			dialog.appendChild(header);
		}

		// Form
		const form = document.createElement('form');
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.submit(config);
		});

		for (const field of config.fields) {
			const div = document.createElement('div');
			div.className = 'field';

			const wrapper = document.createElement('div');
			wrapper.className = 'field-wrapper';

			if (field.label) {
				const lbl = document.createElement('label');
				lbl.textContent = field.label;
				if (field.required) {
					const req = document.createElement('span');
					req.className = 'required';
					req.textContent = ' *';
					lbl.appendChild(req);
				}
				wrapper.appendChild(lbl);
			}

			const input = document.createElement('input');
			input.type = field.type || 'text';
			input.name = field.name;
			input.placeholder = field.placeholder || '';
			if (field.value) input.value = field.value;
			if (field.required) input.required = true;
			wrapper.appendChild(input);

			div.appendChild(wrapper);
			form.appendChild(div);
		}

		// Actions
		const actions = document.createElement('div');
		actions.className = 'actions';

		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'cancel-btn';
		cancelBtn.textContent = config.cancelLabel || 'Cancel';
		cancelBtn.addEventListener('click', () => this.cancel());

		const submitBtn = document.createElement('button');
		submitBtn.type = 'submit';
		submitBtn.className = 'submit-btn';
		submitBtn.textContent = config.submitLabel || 'Save';

		actions.appendChild(cancelBtn);
		actions.appendChild(submitBtn);
		form.appendChild(actions);
		dialog.appendChild(form);
		this.shadow.appendChild(dialog);

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
		document.addEventListener('keydown', this.onKeydown);
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
			document.removeEventListener('keydown', this.onKeydown);
		}
		// Restore Lexical selection state before re-focusing
		if (this.editor && this.savedEditorState) {
			const savedSelection = this.savedEditorState._selection;
			if (savedSelection) {
				this.editor.update(() => {
					$setSelection(savedSelection.clone());
				});
			}
			this.editor.getRootElement()?.focus();
		}
		this.remove();
	}
}

if (!customElements.get('editor-popover')) {
	customElements.define('editor-popover', EditorPopover);
}
