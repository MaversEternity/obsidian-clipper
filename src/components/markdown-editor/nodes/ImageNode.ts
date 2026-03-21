import {
	DecoratorNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from 'lexical';

export type SerializedImageNode = Spread<
	{ src: string; alt: string },
	SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<HTMLElement> {
	__src: string;
	__alt: string;

	static getType(): string {
		return 'image';
	}

	static clone(node: ImageNode): ImageNode {
		return new ImageNode(node.__src, node.__alt, node.__key);
	}

	constructor(src: string, alt: string, key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__alt = alt;
	}

	createDOM(_config: EditorConfig): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'editor-image-wrapper';
		return wrapper;
	}

	updateDOM(): boolean {
		return false;
	}

	exportDOM(): DOMExportOutput {
		const img = document.createElement('img');
		img.src = this.__src;
		img.alt = this.__alt;
		return { element: img };
	}

	decorate(): HTMLElement {
		const img = document.createElement('img');
		img.src = this.__src;
		img.alt = this.__alt;
		img.className = 'editor-image';
		img.style.maxWidth = '100%';
		img.style.borderRadius = 'var(--radius-s, 4px)';
		return img;
	}

	isInline(): boolean {
		return false;
	}

	getTextContent(): string {
		return `![${this.__alt}](${this.__src})`;
	}

	static importJSON(serializedNode: SerializedImageNode): ImageNode {
		return $createImageNode(serializedNode.src, serializedNode.alt);
	}

	exportJSON(): SerializedImageNode {
		return {
			...super.exportJSON(),
			type: 'image',
			src: this.__src,
			alt: this.__alt,
		};
	}
}

export function $createImageNode(src: string, alt: string = ''): ImageNode {
	return new ImageNode(src, alt);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
	return node instanceof ImageNode;
}
