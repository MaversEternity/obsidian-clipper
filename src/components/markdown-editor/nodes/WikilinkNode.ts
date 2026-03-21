import {
	DecoratorNode,
	type DOMConversionMap,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from 'lexical';

export type SerializedWikilinkNode = Spread<
	{ target: string; alias?: string },
	SerializedLexicalNode
>;

export class WikilinkNode extends DecoratorNode<HTMLElement> {
	__target: string;
	__alias?: string;

	static getType(): string {
		return 'wikilink';
	}

	static clone(node: WikilinkNode): WikilinkNode {
		return new WikilinkNode(node.__target, node.__alias, node.__key);
	}

	constructor(target: string, alias?: string, key?: NodeKey) {
		super(key);
		this.__target = target;
		this.__alias = alias;
	}

	createDOM(config: EditorConfig): HTMLElement {
		const el = document.createElement('span');
		el.className = 'editor-wikilink';
		return el;
	}

	updateDOM(): boolean {
		return false;
	}

	exportDOM(): DOMExportOutput {
		const el = document.createElement('span');
		el.className = 'editor-wikilink';
		el.textContent = this.__alias || this.__target;
		return { element: el };
	}

	static importDOM(): DOMConversionMap | null {
		return null;
	}

	decorate(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'editor-wikilink-inner';
		el.textContent = this.__alias || this.__target;
		return el;
	}

	getTarget(): string {
		return this.__target;
	}

	getAlias(): string | undefined {
		return this.__alias;
	}

	getTextContent(): string {
		return this.__alias
			? `[[${this.__target}|${this.__alias}]]`
			: `[[${this.__target}]]`;
	}

	isInline(): boolean {
		return true;
	}

	static importJSON(serializedNode: SerializedWikilinkNode): WikilinkNode {
		return $createWikilinkNode(serializedNode.target, serializedNode.alias);
	}

	exportJSON(): SerializedWikilinkNode {
		return {
			...super.exportJSON(),
			type: 'wikilink',
			target: this.__target,
			alias: this.__alias,
		};
	}
}

export function $createWikilinkNode(target: string, alias?: string): WikilinkNode {
	return new WikilinkNode(target, alias);
}

export function $isWikilinkNode(node: LexicalNode | null | undefined): node is WikilinkNode {
	return node instanceof WikilinkNode;
}
