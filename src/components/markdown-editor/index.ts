import { type LexicalEditor, type Klass, type LexicalNode, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $isTextNode, $getNodeByKey } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_CHECK_LIST_COMMAND, $isListNode, ListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $createCodeNode, $isCodeNode, CodeNode } from '@lexical/code';
import { $isLinkNode } from '@lexical/link';
import { $setBlocksType } from '@lexical/selection';
import { $getNearestNodeOfType } from '@lexical/utils';
import { createMarkdownEditor, setMarkdown, getMarkdown } from './editor';
import { createToolbar, type ToolbarHandle } from './toolbar';
import { isEditorPlugin, type EditorPlugin, type ToolbarButtonDef } from './plugin-interface';

// Import plugin registrations
import './plugins/mention';
import './plugins/link';
import './plugins/image';
import './plugins/youtube';
import './plugins/hashtag';
import './plugins/table';

export class MarkdownEditorElement extends HTMLElement {
	private shadow: ShadowRoot;
	private editor: LexicalEditor | null = null;
	private editorRoot: HTMLElement | null = null;
	private toolbarHandle: ToolbarHandle | null = null;
	private plugins: EditorPlugin[] = [];
	private pluginTransformers: Transformer[] = [];
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private langSelector: HTMLElement | null = null;
	private currentCodeNodeKey: string | null = null;

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
			.editor-container { display: flex; flex-direction: column; flex-grow: 1; min-height: 0; position: relative; overflow: hidden; }
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
			.cm-hashtag { color: var(--text-accent); background: var(--tag-background, rgba(var(--interactive-accent-rgb), 0.1)); border-radius: var(--radius-s); padding: 1px 4px; }
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
			.toolbar-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); }
			.editor-root table {
				border-collapse: collapse; width: calc(100% - 40px); margin: 1em 20px;
				-webkit-user-drag: none;
				font-size: var(--font-ui-small);
			}
			.editor-root th, .editor-root td {
				border: 1px solid var(--divider-color); padding: 8px 12px;
				text-align: left; min-width: 60px;
			}
			.editor-root th {
				background: var(--background-secondary); font-weight: 600;
			}
			.editor-root td { background: transparent; }
			.editor-root td p, .editor-root th p { margin: 0; }
			/* Table helper buttons */
			.table-helper-btn {
				position: absolute; z-index: 10;
				display: none; align-items: center; justify-content: center;
				background: var(--background-secondary); border: 1px solid var(--divider-color);
				color: var(--text-faint); cursor: pointer;
				font-size: 14px; font-weight: 500; padding: 0;
			}
			.table-helper-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
			.table-add-row { height: 18px; border-radius: 0 0 4px 4px; border-top: none; }
			.table-add-col { width: 18px; border-radius: 0 4px 4px 0; border-left: none; }
			.table-drag-handle {
				position: absolute; z-index: 10;
				display: none; align-items: center; justify-content: center;
				color: var(--text-faint); cursor: grab; font-size: 10px;
				border-radius: var(--radius-s); user-select: none;
			}
			.table-drag-handle:hover { color: var(--text-muted); background: var(--background-modifier-hover); }
			.table-drag-handle:active { cursor: grabbing; }
			.table-drag-row { width: 18px; }
			.table-drag-col { height: 18px; }
			.editor-root tr.table-row-dragging td,
			.editor-root tr.table-row-dragging th {
				outline: 2px solid var(--interactive-accent);
				background: rgba(var(--interactive-accent-rgb, 100, 100, 255), 0.1);
			}
			.editor-root td.table-col-dragging,
			.editor-root th.table-col-dragging {
				outline: 2px solid var(--interactive-accent);
				background: rgba(var(--interactive-accent-rgb, 100, 100, 255), 0.1);
			}
			/* Drop indicators — purple border on insertion side */
			.editor-root tr.drop-before td,
			.editor-root tr.drop-before th {
				border-top: 3px solid var(--interactive-accent);
			}
			.editor-root tr.drop-after td,
			.editor-root tr.drop-after th {
				border-bottom: 3px solid var(--interactive-accent);
			}
			.editor-root td.drop-before,
			.editor-root th.drop-before {
				border-left: 3px solid var(--interactive-accent);
			}
			.editor-root td.drop-after,
			.editor-root th.drop-after {
				border-right: 3px solid var(--interactive-accent);
			}
			.tok-comment { color: var(--text-faint); font-style: italic; }
			.tok-keyword { color: var(--text-accent); }
			.tok-string { color: var(--color-green, #a3be8c); }
			.tok-number, .tok-boolean { color: var(--color-orange, #d08770); }
			.tok-function { color: var(--color-blue, #81a1c1); }
			.tok-operator, .tok-punctuation { color: var(--text-muted); }
			.tok-property, .tok-attr { color: var(--color-cyan, #88c0d0); }
			.tok-class-name, .tok-builtin { color: var(--color-yellow, #ebcb8b); }
			.tok-tag { color: var(--color-red, #bf616a); }
			.tok-regex, .tok-important { color: var(--color-orange, #d08770); }
			.tok-variable { color: var(--text-normal); }
			.tok-selector { color: var(--color-green, #a3be8c); }
			.code-lang-selector {
				position: absolute; z-index: 10;
				display: flex; align-items: center; gap: 4px;
				padding: 2px 4px; border-radius: var(--radius-s);
				background: var(--background-secondary); border: 1px solid var(--divider-color);
				box-shadow: var(--shadow-s);
			}
			.code-lang-selector select {
				background: transparent; border: none; color: var(--text-normal);
				font-size: 11px; font-family: var(--font-monospace-default);
				cursor: pointer; outline: none; padding: 2px 4px;
			}
			.code-lang-selector select option { background: var(--background-primary); }
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

		this.toolbarHandle = createToolbar((action) => this.handleToolbarAction(action), pluginButtons);
		container.appendChild(this.toolbarHandle.element);
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

		// Update toolbar active states on selection change
		this.editor.registerUpdateListener(({ editorState }) => {
			editorState.read(() => {
				this.updateToolbarState();
			});
		});

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

	private static LANGUAGES = [
		'', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
		'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'sql', 'html', 'css',
		'scss', 'json', 'yaml', 'xml', 'markdown', 'bash', 'shell', 'powershell',
		'docker', 'lua', 'r', 'scala', 'dart', 'elixir', 'haskell', 'clojure',
	];

	private showLangSelector(currentLang: string, codeDom: HTMLElement) {
		this.hideLangSelector();
		const selector = document.createElement('div');
		selector.className = 'code-lang-selector';

		const select = document.createElement('select');
		for (const lang of MarkdownEditorElement.LANGUAGES) {
			const opt = document.createElement('option');
			opt.value = lang;
			opt.textContent = lang || 'plain text';
			if (lang === currentLang) opt.selected = true;
			select.appendChild(opt);
		}
		select.addEventListener('change', () => {
			this.editor?.update(() => {
				const node = $getNodeByKey(this.currentCodeNodeKey!) as InstanceType<typeof CodeNode> | null;
				if (node && $isCodeNode(node)) {
					node.setLanguage(select.value || undefined as any);
				}
			});
		});
		// Don't steal focus from editor
		select.addEventListener('mousedown', (e) => e.stopPropagation());

		selector.appendChild(select);
		const container = this.shadow.querySelector('.editor-container')!;
		container.appendChild(selector);
		this.langSelector = selector;

		// Position relative to editor container
		const codeRect = codeDom.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		selector.style.top = (codeRect.top - containerRect.top + container.scrollTop + 4) + 'px';
		selector.style.right = '16px';
	}

	private hideLangSelector() {
		this.langSelector?.remove();
		this.langSelector = null;
		this.currentCodeNodeKey = null;
	}

	private updateToolbarState() {
		if (!this.toolbarHandle) return;
		const active = new Set<string>();
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) {
			this.toolbarHandle.setActiveStates(active);
			return;
		}

		// Text formats
		if (selection.hasFormat('bold')) active.add('bold');
		if (selection.hasFormat('italic')) active.add('italic');
		if (selection.hasFormat('strikethrough')) active.add('strikethrough');
		if (selection.hasFormat('code')) active.add('code');

		// Block types — check the anchor node's parent chain
		const anchorNode = selection.anchor.getNode();
		const element = $isTextNode(anchorNode) ? anchorNode.getParent() : anchorNode;

		if (element) {
			if ($isHeadingNode(element)) {
				active.add(element.getTag()); // 'h1', 'h2', 'h3'
			}
			if ($isQuoteNode(element)) {
				active.add('quote');
			}
			const codeParent = $isCodeNode(element) ? element : $isCodeNode(element.getParent()) ? element.getParent() : null;
			if (codeParent && $isCodeNode(codeParent)) {
				active.add('codeblock');
				const key = codeParent.getKey();
				const lang = codeParent.getLanguage() || '';
				if (key !== this.currentCodeNodeKey) {
					this.currentCodeNodeKey = key;
					const codeDom = this.editor!.getElementByKey(key);
					if (codeDom) {
						setTimeout(() => this.showLangSelector(lang, codeDom), 0);
					}
				}
			}
			if ($isLinkNode(element) || $isLinkNode(element.getParent())) {
				active.add('link');
			}
			const listNode = $getNearestNodeOfType(anchorNode, ListNode);
			if (listNode) {
				const listType = listNode.getListType();
				if (listType === 'bullet') active.add('ul');
				if (listType === 'number') active.add('ol');
				if (listType === 'check') active.add('checklist');
			}
		}

		if (!active.has('codeblock')) {
			this.hideLangSelector();
		}
		this.toolbarHandle.setActiveStates(active);
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
			case 'codeblock':
				this.editor.update(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						$setBlocksType(selection, () => $createCodeNode());
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
