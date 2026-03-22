import { type LexicalEditor, type Klass, type LexicalNode, FORMAT_TEXT_COMMAND, PASTE_COMMAND, $getSelection, $isRangeSelection, $isNodeSelection, $isTextNode, $getNodeByKey, $getRoot, $createParagraphNode, $createTextNode, $insertNodes } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_CHECK_LIST_COMMAND, $isListNode, ListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $createCodeNode, $isCodeNode, CodeNode } from '@lexical/code';
import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $createListNode, $createListItemNode } from '@lexical/list';
import { $isTableCellNode } from '@lexical/table';
import { $setBlocksType } from '@lexical/selection';
import { $getNearestNodeOfType } from '@lexical/utils';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { createMarkdownEditor, setMarkdown, getMarkdown } from './editor';
import { OBSIDIAN_TRANSFORMERS } from './transformers';
import { $createImageNode } from './nodes/ImageNode';
import { $createHighlightNode, $isHighlightNode } from './nodes/HighlightNode';
import { $createFootnoteRefNode, $isFootnoteRefNode } from './nodes/FootnoteNodes';
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
			:host { display: flex; flex-grow: 1; position: relative; min-height: 0; overflow: hidden; }
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
			.editor-image-wrapper { position: relative; margin: 0.4em 0; }
			.editor-image-wrapper[data-lexical-decorator="true"] { outline: none; }
			.editor-image-card {
				position: relative; display: inline-block;
				border-radius: var(--radius-m, 8px); overflow: hidden;
				border: 2px solid transparent;
				transition: border-color 0.15s ease;
			}
			.editor-image-wrapper.selected .editor-image-card {
				border-color: var(--interactive-accent);
			}
			.editor-image {
				display: block; max-width: 100%;
				border-radius: var(--radius-m, 8px) var(--radius-m, 8px) 0 0;
			}
			.editor-image-delete {
				position: absolute; top: 8px; right: 8px;
				width: 28px; height: 28px; border-radius: 50%;
				border: none; cursor: pointer;
				background: rgba(0,0,0,0.6); color: #fff;
				display: flex; align-items: center; justify-content: center;
				opacity: 0; transition: opacity 0.15s ease;
			}
			.editor-image-card:hover .editor-image-delete { opacity: 1; }
			.editor-image-delete:hover { background: rgba(200,0,0,0.8); }
			.editor-image-alt {
				display: block; width: 100%; border: none;
				background: var(--background-secondary); color: var(--text-muted);
				font-size: var(--font-ui-smaller, 12px); padding: 6px 10px;
				outline: none;
				border-radius: 0 0 var(--radius-m, 8px) var(--radius-m, 8px);
			}
			.editor-image-alt::placeholder { color: var(--text-faint); }
			.editor-image-alt:focus { color: var(--text-normal); background: var(--background-primary); }
			.footnote-ref {
				color: var(--text-accent); cursor: pointer;
				font-size: 0.75em; vertical-align: super; line-height: 0;
				padding: 0 1px;
			}
			.footnote-ref:hover { text-decoration: underline; }
			.cm-hashtag { color: var(--text-accent); background: var(--tag-background, rgba(var(--interactive-accent-rgb), 0.1)); border-radius: var(--radius-s); padding: 1px 4px; }
			.editor-highlight { background: var(--text-highlight-bg); border-radius: 2px; }
			.cm-quote {
				margin: 0.4em 0; padding: 0 0 0 1em;
				border-left: 3px solid var(--interactive-accent); color: var(--text-muted);
			}
			.editor-root ul,.editor-root ol { margin: 0.2em 0; padding-left: 1.5em; }
			.editor-root .cm-checklist { list-style: none; padding-left: 0.5em; }
			.editor-root .cm-list-item-checked,
			.editor-root .cm-list-item-unchecked {
				position: relative; padding-left: 1.5em; cursor: pointer;
			}
			.editor-root .cm-list-item-checked::before,
			.editor-root .cm-list-item-unchecked::before {
				content: ''; position: absolute; left: 0; top: 4px;
				width: 14px; height: 14px; border-radius: 3px;
				border: 2px solid var(--text-faint);
				background: transparent;
			}
			.editor-root .cm-list-item-checked::before {
				background: var(--interactive-accent); border-color: var(--interactive-accent);
			}
			.editor-root .cm-list-item-checked::after {
				content: ''; position: absolute; left: 3px; top: 6px;
				width: 8px; height: 4px;
				border-left: 2px solid var(--text-on-accent);
				border-bottom: 2px solid var(--text-on-accent);
				transform: rotate(-45deg);
			}
			.editor-root .cm-list-item-checked { text-decoration: line-through; color: var(--text-muted); }
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
			/* === Table === */
			.editor-root table {
				border-collapse: collapse; width: calc(100% - 40px); margin: 1em 20px;
				-webkit-user-drag: none; font-size: var(--font-ui-small);
				position: relative;
			}
			.editor-root th, .editor-root td {
				border: 1px solid var(--divider-color); padding: 8px 12px;
				text-align: left; min-width: 60px; position: relative;
			}
			.editor-root th { background: var(--background-secondary); font-weight: 600; }
			.editor-root td { background: transparent; }
			.editor-root td p, .editor-root th p { margin: 0; }

			/* Row/col selection highlight */
			.editor-root tr.table-row-selected td,
			.editor-root tr.table-row-selected th {
				box-shadow: inset 0 0 0 2px var(--interactive-accent);
				background: rgba(var(--interactive-accent-rgb, 100, 100, 255), 0.08);
			}
			.editor-root td.table-col-selected,
			.editor-root th.table-col-selected {
				box-shadow: inset 0 0 0 2px var(--interactive-accent);
				background: rgba(var(--interactive-accent-rgb, 100, 100, 255), 0.08);
			}

			/* --- Helper buttons: positioned via CSS custom props set by JS --- */
			.table-helpers {
				position: absolute; z-index: 10;
				pointer-events: none;
				/* Dimensions match the active table, set via --t-top/left/width/height */
				top: var(--t-top); left: var(--t-left);
				width: var(--t-width); height: var(--t-height);
			}

			/* Add row — bottom edge */
			.table-add-row {
				position: absolute; pointer-events: auto;
				bottom: -18px; left: 0; width: 100%; height: 18px;
				display: flex; align-items: center; justify-content: center;
				background: var(--background-secondary); border: 1px solid var(--divider-color);
				border-top: none; border-radius: 0 0 4px 4px;
				color: var(--text-faint); cursor: pointer; font-size: 14px;
				opacity: 0; transition: opacity 0.15s ease;
			}

			/* Add col — right edge */
			.table-add-col {
				position: absolute; pointer-events: auto;
				top: 0; right: -18px; width: 18px; height: 100%;
				display: flex; align-items: center; justify-content: center;
				background: var(--background-secondary); border: 1px solid var(--divider-color);
				border-left: none; border-radius: 0 4px 4px 0;
				color: var(--text-faint); cursor: pointer; font-size: 14px;
				opacity: 0; transition: opacity 0.15s ease;
			}

			/* Row handle — left of hovered row */
			.table-row-handle {
				position: absolute; pointer-events: auto;
				left: -22px; width: 20px;
				top: var(--rh-top); height: var(--rh-height);
				display: flex; flex-direction: column; align-items: center; justify-content: center;
				gap: 0; opacity: 0; transition: opacity 0.15s ease;
			}

			/* Col handle — above hovered col */
			.table-col-handle {
				position: absolute; pointer-events: auto;
				top: -22px; height: 20px;
				left: var(--ch-left); width: var(--ch-width);
				display: flex; align-items: center; justify-content: center;
				gap: 0; opacity: 0; transition: opacity 0.15s ease;
			}

			/* Show helpers on table hover */
			.table-helpers[data-visible] .table-add-row,
			.table-helpers[data-visible] .table-add-col { opacity: 1; }
			.table-helpers[data-visible] .table-row-handle,
			.table-helpers[data-visible] .table-col-handle { opacity: 0.6; }
			.table-helpers[data-visible] .table-row-handle:hover,
			.table-helpers[data-visible] .table-col-handle:hover { opacity: 1; }

			/* Hover accents */
			.table-add-row:hover, .table-add-col:hover {
				background: var(--background-modifier-hover); color: var(--text-normal);
			}

			/* Arrow buttons inside handles */
			.handle-arrow {
				display: flex; align-items: center; justify-content: center;
				border: none; background: transparent; color: var(--text-faint);
				cursor: pointer; padding: 0; font-size: 7px;
				width: 16px; height: 12px; border-radius: var(--radius-s);
				transition: background 0.1s ease, color 0.1s ease;
			}
			.handle-arrow:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
			.handle-arrow:disabled { opacity: 0.3; pointer-events: none; }
			.handle-grip {
				font-size: 10px; color: var(--text-faint); cursor: pointer;
				line-height: 1;
			}
			.handle-grip:hover { color: var(--text-normal); }
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
				position: absolute; left: 0; right: 0; max-height: 200px;
				bottom: 100%;
				overflow-y: auto; background: var(--background-primary);
				border: 1px solid var(--divider-color); border-radius: var(--radius-m);
				box-shadow: var(--shadow-s); z-index: 100; margin-bottom: 2px;
			}
			.dropdown.dropdown-caret {
				bottom: auto; left: auto; right: auto;
				min-width: 220px; max-width: 320px;
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

		// Handle node selection (e.g., image selected)
		if ($isNodeSelection(selection)) {
			const nodes = selection.getNodes();
			const { $isImageNode } = require('./nodes/ImageNode');
			if (nodes.length === 1 && $isImageNode(nodes[0])) {
				active.add('image');
				// Add visual selection to the image wrapper
				const key = nodes[0].getKey();
				const dom = this.editor?.getElementByKey(key);
				dom?.classList.add('selected');
			}
			// Clear previous image selections
			this.editorRoot?.querySelectorAll('.editor-image-wrapper.selected').forEach(el => {
				const nodeKey = (el as any).__lexicalKey;
				if (!nodeKey || !selection.has(nodeKey)) el.classList.remove('selected');
			});
			this.toolbarHandle.setActiveStates(active);
			return;
		}

		// Clear image selections when in range selection
		this.editorRoot?.querySelectorAll('.editor-image-wrapper.selected').forEach(el => {
			el.classList.remove('selected');
		});

		if (!$isRangeSelection(selection)) {
			this.toolbarHandle.setActiveStates(active);
			return;
		}

		// Text formats
		if (selection.hasFormat('bold')) active.add('bold');
		if (selection.hasFormat('italic')) active.add('italic');
		if (selection.hasFormat('strikethrough')) active.add('strikethrough');
		if (selection.hasFormat('code')) active.add('code');
		// Check if selection contains highlight or footnote nodes
		const selNodes = selection.getNodes();
		if (selNodes.some(n => $isHighlightNode(n))) active.add('highlight');
		if (selNodes.some(n => $isFootnoteRefNode(n))) active.add('footnote');
		// Also active when cursor is in a footnote definition paragraph
		// Walk up to find the paragraph-level parent
		let fnBlock = selection.anchor.getNode();
		const root = $getRoot();
		while (fnBlock.getParent() && fnBlock.getParent() !== root) {
			fnBlock = fnBlock.getParent()!;
		}
		const fnFirst = 'getFirstChild' in fnBlock ? (fnBlock as any).getFirstChild() : null;
		if ($isFootnoteRefNode(fnFirst)) {
			const fnSecond = fnFirst.getNextSibling();
			if (fnSecond && $isTextNode(fnSecond) && fnSecond.getTextContent().startsWith(':')) {
				active.add('footnote');
			}
		}

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
			// Table — check if inside a TableCellNode
			let tableCheck: LexicalNode | null = element;
			while (tableCheck) {
				if ($isTableCellNode(tableCheck)) {
					active.add('table');
					break;
				}
				tableCheck = tableCheck.getParent();
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
			case 'highlight':
				this.editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;
					const selectedText = selection.getTextContent();
					if (!selectedText) return;
					const nodes = selection.getNodes();
					// Toggle: if already highlighted, unwrap
					const isHighlighted = nodes.some(n => $isHighlightNode(n));
					if (isHighlighted) {
						for (const node of nodes) {
							if ($isHighlightNode(node)) {
								const text = $createTextNode(node.getTextContent());
								node.replace(text);
							}
						}
					} else {
						// Wrap selection in highlight
						selection.removeText();
						const highlightNode = $createHighlightNode(selectedText);
						selection.insertNodes([highlightNode]);
					}
				});
				break;
			case 'footnote':
				this.editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;
					const root = $getRoot();
					// Find highest existing footnote number
					let maxFn = 0;
					const md = getMarkdown(this.editor!, this.pluginTransformers);
					const matches = md.matchAll(/\[\^(\d+)\]/g);
					for (const m of matches) {
						const n = parseInt(m[1]);
						if (n > maxFn) maxFn = n;
					}
					const id = maxFn + 1;
					// Insert superscript reference at cursor
					const refNode = $createFootnoteRefNode(id);
					selection.insertNodes([refNode]);
					// Append definition as plain paragraph at end
					const defNode = $createParagraphNode();
					defNode.append($createTextNode(`[^${id}]: `));
					root.append(defNode);
				});
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

	/**
	 * Insert markdown at the current cursor position.
	 * If no cursor, appends to the end.
	 */
	insertAtCursor(markdown: string) {
		if (!this.editor) return;
		const allTransformers = [...this.pluginTransformers, ...OBSIDIAN_TRANSFORMERS];

		this.editor.update(() => {
			const root = $getRoot();
			const selection = $getSelection();

			// Find cursor block index
			let insertIdx = root.getChildrenSize();
			if ($isRangeSelection(selection)) {
				let node = selection.anchor.getNode();
				while (node.getParent() && node.getParent() !== root) {
					node = node.getParent()!;
				}
				insertIdx = root.getChildren().indexOf(node) + 1;
			}

			// Detach existing children
			const existing = root.getChildren();
			for (const child of existing) child.remove();

			// Parse new markdown into empty root via Lexical transformers
			$convertFromMarkdownString(markdown, allTransformers);
			const newNodes = root.getChildren();
			for (const child of newNodes) child.remove();

			// Reassemble at cursor position
			const before = existing.slice(0, insertIdx);
			const after = existing.slice(insertIdx);
			for (const n of before) root.append(n);
			for (const n of newNodes) root.append(n);
			for (const n of after) root.append(n);

			// Focus after inserted content
			if (newNodes.length > 0) {
				newNodes[newNodes.length - 1].selectEnd();
				const lastKey = newNodes[newNodes.length - 1].getKey();
				setTimeout(() => {
					this.editorRoot?.focus();
					const dom = this.editor?.getElementByKey(lastKey);
					dom?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
				}, 0);
			}
		});
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
