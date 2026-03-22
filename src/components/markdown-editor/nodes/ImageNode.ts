import {
	DecoratorNode,
	$getNearestNodeFromDOMNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
	$setSelection,
	$createNodeSelection,
	$getSelection,
	$isNodeSelection,
	CLICK_COMMAND,
	COMMAND_PRIORITY_LOW,
	KEY_DELETE_COMMAND,
	KEY_BACKSPACE_COMMAND,
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
		wrapper.style.cursor = 'default';
		return wrapper;
	}

	updateDOM(): boolean {
		return false;
	}

	/** Register click-to-select and delete commands for this image node */
	static registerCommands(editor: LexicalEditor): () => void {
		const removeClick = editor.registerCommand(
			CLICK_COMMAND,
			(event: MouseEvent) => {
				const target = event.target as HTMLElement;
				if (target.tagName === 'IMG' && target.classList.contains('editor-image')) {
					const node = $getNearestNodeFromDOMNode(target);
					if (node && node instanceof ImageNode) {
						const nodeSelection = $createNodeSelection();
						nodeSelection.add(node.getKey());
						$setSelection(nodeSelection);
						return true;
					}
				}
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		const removeDelete = editor.registerCommand(
			KEY_DELETE_COMMAND,
			() => {
				const selection = $getSelection();
				if ($isNodeSelection(selection)) {
					selection.getNodes().forEach(node => {
						if (node instanceof ImageNode) node.remove();
					});
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		const removeBackspace = editor.registerCommand(
			KEY_BACKSPACE_COMMAND,
			() => {
				const selection = $getSelection();
				if ($isNodeSelection(selection)) {
					selection.getNodes().forEach(node => {
						if (node instanceof ImageNode) node.remove();
					});
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		return () => {
			removeClick();
			removeDelete();
			removeBackspace();
		};
	}

	exportDOM(): DOMExportOutput {
		const img = document.createElement('img');
		img.src = this.__src;
		img.alt = this.__alt;
		return { element: img };
	}

	decorate(editor: LexicalEditor): HTMLElement {
		const card = document.createElement('div');
		card.className = 'editor-image-card';

		const img = document.createElement('img');
		img.src = this.__src;
		img.alt = this.__alt;
		img.className = 'editor-image';
		img.draggable = false;

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'editor-image-delete';
		deleteBtn.type = 'button';
		deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
		deleteBtn.title = 'Delete image';
		deleteBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			editor.update(() => {
				const node = $getNearestNodeFromDOMNode(card);
				if (node) node.remove();
			});
		});

		const altInput = document.createElement('input');
		altInput.className = 'editor-image-alt';
		altInput.type = 'text';
		altInput.placeholder = 'Alt text...';
		altInput.value = this.__alt;
		// Sync alt to Lexical only on blur — avoids re-render while typing
		altInput.addEventListener('blur', () => {
			editor.update(() => {
				const node = $getNearestNodeFromDOMNode(card);
				if (node && node instanceof ImageNode) {
					const writable = node.getWritable();
					writable.__alt = altInput.value;
				}
			});
		});
		// Prevent Lexical from capturing events on the alt input
		const stop = (e: Event) => e.stopPropagation();
		altInput.addEventListener('keydown', stop);
		altInput.addEventListener('keyup', stop);
		altInput.addEventListener('mousedown', stop);
		altInput.addEventListener('click', stop);
		altInput.addEventListener('focus', stop);
		altInput.addEventListener('beforeinput', stop);

		card.appendChild(img);
		card.appendChild(deleteBtn);
		card.appendChild(altInput);
		return card;
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
