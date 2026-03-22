import { createEditor, type Klass, type LexicalEditor, type LexicalNode } from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerList, registerCheckList, ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode, registerCodeHighlighting } from '@lexical/code';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	registerMarkdownShortcuts,
	type Transformer,
} from '@lexical/markdown';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import { obsidianTheme } from './theme';
import { OBSIDIAN_TRANSFORMERS } from './transformers';
import { HighlightNode } from './nodes/HighlightNode';

const BASE_NODES: Klass<LexicalNode>[] = [
	HeadingNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	CodeNode,
	CodeHighlightNode,
	LinkNode,
	AutoLinkNode,
	HighlightNode,
];

export interface EditorConfig {
	rootElement: HTMLElement;
	extraNodes?: Klass<LexicalNode>[];
	extraTransformers?: Transformer[];
}

export function createMarkdownEditor(config: EditorConfig): LexicalEditor {
	const allNodes = [...BASE_NODES, ...(config.extraNodes || [])];
	const editor = createEditor({
		namespace: 'MarkdownEditor',
		nodes: allNodes,
		theme: obsidianTheme,
		onError: (error) => console.error('[markdown-editor]', error),
	});

	editor.setRootElement(config.rootElement);
	registerRichText(editor);
	registerList(editor);
	registerCheckList(editor);

	const allTransformers = [...(config.extraTransformers || []), ...OBSIDIAN_TRANSFORMERS];
	registerMarkdownShortcuts(editor, allTransformers);
	registerHistory(editor, createEmptyHistoryState(), 300);
	registerCodeHighlighting(editor);

	// Render DecoratorNode outputs into the DOM (vanilla Lexical doesn't do this automatically)
	editor.registerDecoratorListener((decorators) => {
		for (const [nodeKey, el] of Object.entries(decorators)) {
			const dom = editor.getElementByKey(nodeKey);
			if (dom && el instanceof HTMLElement) {
				dom.innerHTML = '';
				dom.appendChild(el);
			}
		}
	});

	return editor;
}

export function getAllTransformers(extraTransformers?: Transformer[]): Transformer[] {
	return [...(extraTransformers || []), ...OBSIDIAN_TRANSFORMERS];
}

export function setMarkdown(editor: LexicalEditor, markdown: string, extraTransformers?: Transformer[]): void {
	const transformers = getAllTransformers(extraTransformers);
	editor.update(() => {
		$convertFromMarkdownString(markdown, transformers);
	});
}

export function getMarkdown(editor: LexicalEditor, extraTransformers?: Transformer[]): string {
	const transformers = getAllTransformers(extraTransformers);
	let md = '';
	editor.getEditorState().read(() => {
		md = $convertToMarkdownString(transformers);
	});
	return md;
}
