import {
	DecoratorNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
	$getNodeByKey,
	CLICK_COMMAND,
	COMMAND_PRIORITY_LOW,
	KEY_BACKSPACE_COMMAND,
	KEY_DELETE_COMMAND,
	$getSelection,
	$isNodeSelection,
} from 'lexical';

export type SerializedYouTubeNode = Spread<
	{ videoId: string; startTime: number },
	SerializedLexicalNode
>;

export class YouTubeNode extends DecoratorNode<HTMLElement> {
	__videoId: string;
	__startTime: number;

	static getType(): string {
		return 'youtube';
	}

	static clone(node: YouTubeNode): YouTubeNode {
		return new YouTubeNode(node.__videoId, node.__startTime, node.__key);
	}

	constructor(videoId: string, startTime: number = 0, key?: NodeKey) {
		super(key);
		this.__videoId = videoId;
		this.__startTime = startTime;
	}

	createDOM(_config: EditorConfig): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'editor-youtube-wrapper';
		wrapper.style.cssText = 'position:relative;width:100%;max-width:560px;margin:8px 0;';
		return wrapper;
	}

	updateDOM(): boolean {
		return false;
	}

	exportDOM(): DOMExportOutput {
		const el = document.createElement('a');
		const url = this.__startTime
			? `https://www.youtube.com/watch?v=${this.__videoId}&t=${this.__startTime}`
			: `https://www.youtube.com/watch?v=${this.__videoId}`;
		el.href = url;
		el.textContent = `YouTube: ${this.__videoId}`;
		return { element: el };
	}

	decorate(_editor: LexicalEditor): HTMLElement {
		const container = document.createElement('div');
		container.className = 'editor-youtube';
		container.style.cssText = `
			position: relative;
			width: 100%;
			border-radius: var(--radius-s, 6px);
			overflow: hidden;
			background: #000;
			outline: none;
		`;
		container.tabIndex = 0;

		// 16:9 aspect ratio container
		const aspectWrapper = document.createElement('div');
		aspectWrapper.style.cssText = 'position:relative;padding-bottom:56.25%;height:0;';

		// Thumbnail state
		const thumb = document.createElement('img');
		thumb.src = `https://img.youtube.com/vi/${this.__videoId}/maxresdefault.jpg`;
		thumb.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;';
		thumb.alt = 'YouTube video';
		thumb.onerror = () => {
			thumb.src = `https://img.youtube.com/vi/${this.__videoId}/hqdefault.jpg`;
		};

		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.15);transition:background 0.2s;';
		overlay.addEventListener('mouseenter', () => { overlay.style.background = 'rgba(0,0,0,0.05)'; });
		overlay.addEventListener('mouseleave', () => { overlay.style.background = 'rgba(0,0,0,0.15)'; });

		// YouTube-style play button
		const playBtn = document.createElement('div');
		playBtn.style.cssText = 'width:68px;height:48px;background:rgba(255,0,0,0.9);border-radius:12px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;';
		playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21"/></svg>';
		overlay.appendChild(playBtn);

		// Timestamp badge
		if (this.__startTime > 0) {
			const badge = document.createElement('div');
			badge.style.cssText = 'position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.8);color:white;padding:2px 6px;border-radius:4px;font-size:12px;font-family:sans-serif;';
			badge.textContent = formatTime(this.__startTime);
			overlay.appendChild(badge);
		}

		aspectWrapper.appendChild(thumb);
		aspectWrapper.appendChild(overlay);
		container.appendChild(aspectWrapper);

		// Click to open in new tab (iframe embeds blocked by extension CSP)
		overlay.addEventListener('click', (e) => {
			e.stopPropagation();
			const timeParam = this.__startTime ? `&t=${this.__startTime}` : '';
			window.open(`https://www.youtube.com/watch?v=${this.__videoId}${timeParam}`, '_blank');
		});

		// Selection styling
		container.addEventListener('focus', () => {
			container.style.outline = '2px solid var(--interactive-accent, #7c5cff)';
			container.style.outlineOffset = '2px';
		});
		container.addEventListener('blur', () => {
			container.style.outline = 'none';
		});

		// Delete on backspace/delete when focused
		container.addEventListener('keydown', (e) => {
			if (e.key === 'Backspace' || e.key === 'Delete') {
				e.preventDefault();
				_editor.update(() => {
					const node = $getNodeByKey(this.__key);
					if (node) node.remove();
				});
			}
		});

		return container;
	}

	isInline(): boolean {
		return false;
	}

	getTextContent(): string {
		const url = this.__startTime
			? `https://www.youtube.com/watch?v=${this.__videoId}&t=${this.__startTime}`
			: `https://www.youtube.com/watch?v=${this.__videoId}`;
		return url;
	}

	static importJSON(serializedNode: SerializedYouTubeNode): YouTubeNode {
		return $createYouTubeNode(serializedNode.videoId, serializedNode.startTime);
	}

	exportJSON(): SerializedYouTubeNode {
		return {
			...super.exportJSON(),
			type: 'youtube',
			videoId: this.__videoId,
			startTime: this.__startTime,
		};
	}
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function extractYouTubeVideoId(url: string): { videoId: string; startTime: number } | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/^([a-zA-Z0-9_-]{11})$/,
	];
	for (const p of patterns) {
		const match = url.match(p);
		if (match) {
			// Extract timestamp
			let startTime = 0;
			const tMatch = url.match(/[?&]t=(\d+)/);
			if (tMatch) startTime = parseInt(tMatch[1], 10);
			// Also support &t=1m30s format
			const tHumanMatch = url.match(/[?&]t=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
			if (tHumanMatch && !tMatch) {
				const hours = parseInt(tHumanMatch[1] || '0', 10);
				const mins = parseInt(tHumanMatch[2] || '0', 10);
				const secs = parseInt(tHumanMatch[3] || '0', 10);
				startTime = hours * 3600 + mins * 60 + secs;
			}
			return { videoId: match[1], startTime };
		}
	}
	return null;
}

export function $createYouTubeNode(videoId: string, startTime: number = 0): YouTubeNode {
	return new YouTubeNode(videoId, startTime);
}

export function $isYouTubeNode(node: LexicalNode | null | undefined): node is YouTubeNode {
	return node instanceof YouTubeNode;
}
