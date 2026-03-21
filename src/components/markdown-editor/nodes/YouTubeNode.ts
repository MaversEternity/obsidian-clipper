import {
	DecoratorNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from 'lexical';

export type SerializedYouTubeNode = Spread<
	{ videoId: string },
	SerializedLexicalNode
>;

export class YouTubeNode extends DecoratorNode<HTMLElement> {
	__videoId: string;

	static getType(): string {
		return 'youtube';
	}

	static clone(node: YouTubeNode): YouTubeNode {
		return new YouTubeNode(node.__videoId, node.__key);
	}

	constructor(videoId: string, key?: NodeKey) {
		super(key);
		this.__videoId = videoId;
	}

	createDOM(_config: EditorConfig): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'editor-youtube-wrapper';
		return wrapper;
	}

	updateDOM(): boolean {
		return false;
	}

	exportDOM(): DOMExportOutput {
		const el = document.createElement('a');
		el.href = `https://www.youtube.com/watch?v=${this.__videoId}`;
		el.textContent = `YouTube: ${this.__videoId}`;
		return { element: el };
	}

	decorate(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'editor-youtube';
		container.style.cssText = 'position:relative;width:100%;max-width:480px;border-radius:var(--radius-s,4px);overflow:hidden;cursor:pointer;';

		const thumb = document.createElement('img');
		thumb.src = `https://img.youtube.com/vi/${this.__videoId}/hqdefault.jpg`;
		thumb.style.cssText = 'width:100%;display:block;';
		thumb.alt = 'YouTube video';

		const playBtn = document.createElement('div');
		playBtn.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;';
		playBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

		container.appendChild(thumb);
		container.appendChild(playBtn);

		container.addEventListener('click', () => {
			window.open(`https://www.youtube.com/watch?v=${this.__videoId}`, '_blank');
		});

		return container;
	}

	isInline(): boolean {
		return false;
	}

	getTextContent(): string {
		return `https://www.youtube.com/watch?v=${this.__videoId}`;
	}

	static importJSON(serializedNode: SerializedYouTubeNode): YouTubeNode {
		return $createYouTubeNode(serializedNode.videoId);
	}

	exportJSON(): SerializedYouTubeNode {
		return {
			...super.exportJSON(),
			type: 'youtube',
			videoId: this.__videoId,
		};
	}
}

export function extractYouTubeVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/^([a-zA-Z0-9_-]{11})$/,
	];
	for (const p of patterns) {
		const match = url.match(p);
		if (match) return match[1];
	}
	return null;
}

export function $createYouTubeNode(videoId: string): YouTubeNode {
	return new YouTubeNode(videoId);
}

export function $isYouTubeNode(node: LexicalNode | null | undefined): node is YouTubeNode {
	return node instanceof YouTubeNode;
}
