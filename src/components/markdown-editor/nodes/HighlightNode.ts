import {
	$applyNodeReplacement,
	TextNode,
	type DOMConversionMap,
	type DOMConversionOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedTextNode,
	type Spread,
} from 'lexical';

export type SerializedHighlightNode = Spread<{}, SerializedTextNode>;

export class HighlightNode extends TextNode {
	static getType(): string {
		return 'highlight';
	}

	static clone(node: HighlightNode): HighlightNode {
		return new HighlightNode(node.__text, node.__key);
	}

	constructor(text: string, key?: NodeKey) {
		super(text, key);
	}

	createDOM(config: EditorConfig): HTMLElement {
		const el = super.createDOM(config);
		el.classList.add('editor-highlight');
		return el;
	}

	updateDOM(prevNode: TextNode, dom: HTMLElement, config: EditorConfig): boolean {
		const isUpdated = super.updateDOM(prevNode as this, dom, config);
		if (!dom.classList.contains('editor-highlight')) {
			dom.classList.add('editor-highlight');
		}
		return isUpdated;
	}

	static importDOM(): DOMConversionMap | null {
		return {
			mark: () => ({
				conversion: convertHighlightElement,
				priority: 0,
			}),
		};
	}

	static importJSON(serializedNode: SerializedHighlightNode): HighlightNode {
		const node = $createHighlightNode(serializedNode.text);
		node.setFormat(serializedNode.format);
		node.setDetail(serializedNode.detail);
		node.setMode(serializedNode.mode);
		node.setStyle(serializedNode.style);
		return node;
	}

	exportJSON(): SerializedHighlightNode {
		return {
			...super.exportJSON(),
			type: 'highlight',
		};
	}
}

function convertHighlightElement(domNode: HTMLElement): DOMConversionOutput {
	const text = domNode.textContent || '';
	return { node: $createHighlightNode(text) };
}

export function $createHighlightNode(text: string): HighlightNode {
	return $applyNodeReplacement(new HighlightNode(text));
}

export function $isHighlightNode(node: LexicalNode | null | undefined): node is HighlightNode {
	return node instanceof HighlightNode;
}
