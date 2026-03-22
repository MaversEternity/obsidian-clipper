import {
	$applyNodeReplacement,
	TextNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedTextNode,
	type Spread,
} from 'lexical';

// === Footnote Reference (inline superscript) ===

export type SerializedFootnoteRefNode = Spread<{ footnoteId: number }, SerializedTextNode>;

export class FootnoteRefNode extends TextNode {
	__footnoteId: number;

	static getType(): string { return 'footnote-ref'; }

	static clone(node: FootnoteRefNode): FootnoteRefNode {
		return new FootnoteRefNode(node.__footnoteId, node.__key);
	}

	constructor(footnoteId: number, key?: NodeKey) {
		super(`${footnoteId}`, key);
		this.__footnoteId = footnoteId;
	}

	createDOM(config: EditorConfig): HTMLElement {
		const el = document.createElement('sup');
		el.className = 'footnote-ref';
		el.textContent = `${this.__footnoteId}`;
		return el;
	}

	updateDOM(): boolean { return false; }
	isInline(): true { return true; }

	getFootnoteId(): number { return this.__footnoteId; }

	static importJSON(json: SerializedFootnoteRefNode): FootnoteRefNode {
		return $createFootnoteRefNode(json.footnoteId);
	}

	exportJSON(): SerializedFootnoteRefNode {
		return { ...super.exportJSON(), type: 'footnote-ref', footnoteId: this.__footnoteId };
	}

	getTextContent(): string { return `[^${this.__footnoteId}]`; }
}

export function $createFootnoteRefNode(id: number): FootnoteRefNode {
	return $applyNodeReplacement(new FootnoteRefNode(id));
}

export function $isFootnoteRefNode(node: LexicalNode | null | undefined): node is FootnoteRefNode {
	return node instanceof FootnoteRefNode;
}

