import type { TextMatchTransformer, ElementTransformer } from '@lexical/markdown';
import {
	BOLD_ITALIC_STAR,
	BOLD_ITALIC_UNDERSCORE,
	BOLD_STAR,
	BOLD_UNDERSCORE,
	INLINE_CODE,
	ITALIC_STAR,
	ITALIC_UNDERSCORE,
	STRIKETHROUGH,
	HEADING,
	QUOTE,
	UNORDERED_LIST,
	ORDERED_LIST,
	CHECK_LIST,
	CODE,
	LINK,
} from '@lexical/markdown';
import { WikilinkNode, $createWikilinkNode } from './nodes/WikilinkNode';
import { HighlightNode, $createHighlightNode } from './nodes/HighlightNode';
import { $isTextNode, type LexicalNode } from 'lexical';

export const WIKILINK_TRANSFORMER: TextMatchTransformer = {
	dependencies: [WikilinkNode],
	export: (node: LexicalNode) => {
		if (node instanceof WikilinkNode) {
			const alias = node.getAlias();
			return alias
				? `[[${node.getTarget()}|${alias}]]`
				: `[[${node.getTarget()}]]`;
		}
		return null;
	},
	importRegExp: /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/,
	regExp: /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/,
	replace: (textNode, match) => {
		const target = match[1];
		const alias = match[2] || undefined;
		const wikilinkNode = $createWikilinkNode(target, alias);
		textNode.replace(wikilinkNode);
	},
	trigger: ']',
	type: 'text-match',
};

const HIGHLIGHT_TRANSFORMER: TextMatchTransformer = {
	dependencies: [HighlightNode],
	export: (node: LexicalNode) => {
		if (node instanceof HighlightNode) {
			return `==${node.getTextContent()}==`;
		}
		return null;
	},
	importRegExp: /==(.*?)==/,
	regExp: /==(.*?)==/,
	replace: (textNode, match) => {
		const highlightNode = $createHighlightNode(match[1]);
		textNode.replace(highlightNode);
	},
	trigger: '=',
	type: 'text-match',
};

export const OBSIDIAN_TRANSFORMERS = [
	HIGHLIGHT_TRANSFORMER,
	HEADING,
	QUOTE,
	CHECK_LIST,
	UNORDERED_LIST,
	ORDERED_LIST,
	CODE,
	BOLD_ITALIC_STAR,
	BOLD_ITALIC_UNDERSCORE,
	BOLD_STAR,
	BOLD_UNDERSCORE,
	INLINE_CODE,
	ITALIC_STAR,
	ITALIC_UNDERSCORE,
	STRIKETHROUGH,
	LINK,
];
