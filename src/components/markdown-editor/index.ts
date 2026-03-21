import { type LexicalEditor, type Klass, type LexicalNode, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_CHECK_LIST_COMMAND } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { createMarkdownEditor, setMarkdown, getMarkdown } from './editor';
import { createToolbar } from './toolbar';
import { isEditorPlugin, type EditorPlugin, type ToolbarButtonDef } from './plugin-interface';

// Import plugin registrations
import './plugins/mention';
import './plugins/link';
import './plugins/image';
import './plugins/youtube';

export class MarkdownEditorElement extends HTMLElement {
	private shadow: ShadowRoot;
	private editor: LexicalEditor | null = null;
	private editorRoot: HTMLElement | null = null;
	private plugins: EditorPlugin[] = [];
	private pluginTransformers: Transformer[] = [];
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
		this.patchSelectionForShadowDOM();
	}

	private patchSelectionForShadowDOM() {
		const shadow = this.shadow;
		const origGetSelection = window.getSelection.bind(window);
		const getShadowSelection = (): Selection | null => {
			if ('getSelection' in shadow) {
				const sel = (shadow as any).getSelection() as Selection | null;
				if (sel && sel.rangeCount > 0) return sel;
			}
			return null;
		};
		window.getSelection = () => getShadowSelection() || origGetSelection();
		const origDocGetSelection = document.getSelection.bind(document);
		document.getSelection = () => getShadowSelection() || origDocGetSelection();
		shadow.addEventListener('selectionchange', () => {
			document.dispatchEvent(new Event('selectionchange'));
		});
	}

	connectedCallback() {
		// Discover plugins from child elements
		this.plugins = Array.from(this.children).filter(isEditorPlugin);

		// Collect plugin contributions
		const extraNodes: Klass<LexicalNode>[] = [];
		this.pluginTransformers = [];
		const pluginButtons: ToolbarButtonDef[] = [];

		for (const plugin of this.plugins) {
			extraNodes.push(...plugin.getNodes());
			this.pluginTransformers.push(...plugin.getTransformers());
			const btn = plugin.getToolbarButton();
			if (btn) pluginButtons.push(btn);
		}

		// Styles
		const style = document.createElement('style');
		style.textContent = `
			:host { display: flex; flex-grow: 1; position: relative; }
			.editor-container { display: flex; flex-direction: column; flex-grow: 1; min-height: 0; position: relative; }
			.editor-root {
				flex-grow: 1; outline: none;
				padding: 10px var(--popup-padding, 12px);
				font-family: var(--font-default); font-size: var(--font-ui-small);
				line-height: 1.5; color: var(--text-normal);
				overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;
			}
			.editor-root:empty::before {
				content: attr(data-placeholder); color: var(--text-faint);
				pointer-events: none; position: absolute;
			}
			.editor-root p { margin: 0 0 0.25em; }
			.editor-root h1,.editor-root h2,.editor-root h3,.editor-root h4,.editor-root h5,.editor-root h6 {
				font-weight: 600; margin: 0.4em 0 0.2em; color: var(--text-normal);
			}
			.editor-root h1 { font-size: 1.5em; } .editor-root h2 { font-size: 1.3em; } .editor-root h3 { font-size: 1.15em; }
			.cm-strong { font-weight: 700; } .cm-em { font-style: italic; }
			.cm-strikethrough { text-decoration: line-through; }
			.cm-inline-code {
				font-family: var(--font-monospace-default); font-size: 0.9em;
				background: var(--background-secondary); border-radius: var(--radius-s); padding: 1px 4px;
			}
			.cm-link,.editor-wikilink { color: var(--text-accent); text-decoration: none; cursor: pointer; }
			.editor-highlight { background: var(--text-highlight-bg); border-radius: 2px; }
			.cm-quote {
				margin: 0.4em 0; padding: 0 0 0 1em;
				border-left: 3px solid var(--interactive-accent); color: var(--text-muted);
			}
			.editor-root ul,.editor-root ol { margin: 0.2em 0; padding-left: 1.5em; }
			.cm-codeblock {
				font-family: var(--font-monospace-default); font-size: 0.85em;
				background: var(--background-secondary); border-radius: var(--radius-s);
				padding: 0.5em 0.75em; margin: 0.4em 0; display: block; overflow-x: auto; white-space: pre;
			}
			.editor-toolbar {
				display: flex; align-items: center; gap: 1px;
				padding: 4px var(--popup-padding, 12px);
				border-bottom: 1px solid var(--divider-color);
				flex-shrink: 0; flex-wrap: wrap;
			}
			.toolbar-btn {
				display: flex; align-items: center; justify-content: center;
				width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius-s);
				background: transparent; color: var(--text-muted); cursor: pointer;
			}
			.toolbar-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
			.toolbar-separator { width: 1px; height: 16px; background: var(--divider-color); margin: 0 4px; }
			.dropdown {
				position: absolute; bottom: 100%; left: 0; right: 0; max-height: 200px;
				overflow-y: auto; background: var(--background-primary);
				border: 1px solid var(--divider-color); border-radius: var(--radius-m);
				box-shadow: var(--shadow-s); z-index: 100; margin-bottom: 2px;
			}
			.dropdown .item {
				display: flex; align-items: center; gap: 8px; padding: 6px 10px;
				cursor: pointer; font-size: var(--font-ui-smaller); color: var(--text-normal);
			}
			.dropdown .item.is-selected { background: var(--interactive-accent); color: var(--text-on-accent); }
			.dropdown .item.is-selected .path { color: var(--text-on-accent); opacity: 0.7; }
			.dropdown .name { flex-shrink: 0; }
			.dropdown .path { color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		`;
		this.shadow.appendChild(style);

		// Build UI
		const container = document.createElement('div');
		container.className = 'editor-container';

		this.editorRoot = document.createElement('div');
		this.editorRoot.className = 'editor-root';
		this.editorRoot.contentEditable = 'true';
		this.editorRoot.dataset.placeholder = this.getAttribute('placeholder') || '';

		const toolbar = createToolbar((action) => this.handleToolbarAction(action), pluginButtons);
		container.appendChild(toolbar);
		container.appendChild(this.editorRoot);
		this.shadow.appendChild(container);

		// Create editor with plugin nodes and transformers
		this.editor = createMarkdownEditor({
			rootElement: this.editorRoot,
			extraNodes,
			extraTransformers: this.pluginTransformers,
		});

		// Attach plugins
		for (const plugin of this.plugins) {
			plugin.attach(this.editor, this.shadow);
		}

		// Dispatch change events (debounced)
		this.editor.registerUpdateListener(() => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				this.dispatchEvent(new Event('input', { bubbles: true }));
				this.dispatchEvent(new Event('change', { bubbles: true }));
			}, 150);
		});

		// Load initial value
		const initialValue = this.getAttribute('value');
		if (initialValue) {
			setMarkdown(this.editor, initialValue, this.pluginTransformers);
		}
	}

	private handleToolbarAction(action: string) {
		if (!this.editor) return;
		this.editorRoot?.focus();

		switch (action) {
			case 'bold':
				this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
				break;
			case 'italic':
				this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
				break;
			case 'strikethrough':
				this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
				break;
			case 'code':
				this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
				break;
			case 'h1': case 'h2': case 'h3':
				this.editor.update(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						$setBlocksType(selection, () => $createHeadingNode(action as HeadingTagType));
					}
				});
				break;
			case 'quote':
				this.editor.update(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						$setBlocksType(selection, () => $createQuoteNode());
					}
				});
				break;
			case 'ul':
				this.editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
				break;
			case 'ol':
				this.editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
				break;
			case 'checklist':
				this.editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
				break;
		}
	}

	disconnectedCallback() {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		for (const plugin of this.plugins) {
			plugin.detach();
		}
	}

	get value(): string {
		if (!this.editor) return '';
		return getMarkdown(this.editor, this.pluginTransformers);
	}

	set value(md: string) {
		if (!this.editor) return;
		setMarkdown(this.editor, md, this.pluginTransformers);
	}

	focus() {
		this.editorRoot?.focus();
	}

	static get observedAttributes() {
		return ['placeholder', 'readonly'];
	}

	attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
		if (name === 'placeholder' && this.editorRoot) {
			this.editorRoot.dataset.placeholder = newValue || '';
		}
		if (name === 'readonly' && this.editorRoot) {
			this.editorRoot.contentEditable = newValue === null ? 'true' : 'false';
		}
	}
}

if (!customElements.get('markdown-editor')) {
	customElements.define('markdown-editor', MarkdownEditorElement);
}
