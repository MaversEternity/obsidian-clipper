import { createEditor, type LexicalEditor } from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerList, ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	registerMarkdownShortcuts,
} from '@lexical/markdown';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import { obsidianTheme } from './theme';
import { OBSIDIAN_TRANSFORMERS } from './transformers';
import { WikilinkNode } from './nodes/WikilinkNode';
import { HighlightNode } from './nodes/HighlightNode';

export function createMarkdownEditor(rootElement: HTMLElement): LexicalEditor {
	const editor = createEditor({
		namespace: 'MarkdownEditor',
		nodes: [
			HeadingNode,
			QuoteNode,
			ListNode,
			ListItemNode,
			CodeNode,
			CodeHighlightNode,
			LinkNode,
			AutoLinkNode,
			WikilinkNode,
			HighlightNode,
		],
		theme: obsidianTheme,
		onError: (error) => console.error('[markdown-editor]', error),
	});

	editor.setRootElement(rootElement);
	registerRichText(editor);
	registerList(editor);
	registerMarkdownShortcuts(editor, OBSIDIAN_TRANSFORMERS);
	registerHistory(editor, createEmptyHistoryState(), 300);

	return editor;
}

export function setMarkdown(editor: LexicalEditor, markdown: string): void {
	editor.update(() => {
		$convertFromMarkdownString(markdown, OBSIDIAN_TRANSFORMERS);
	});
}

export function getMarkdown(editor: LexicalEditor): string {
	let md = '';
	editor.getEditorState().read(() => {
		md = $convertToMarkdownString(OBSIDIAN_TRANSFORMERS);
	});
	return md;
}
