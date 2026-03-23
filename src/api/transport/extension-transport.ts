/**
 * Transport implementation using browser extension messaging.
 * Wraps browser.runtime.sendMessage / browser.tabs.sendMessage.
 */

import { injectable } from 'tsyringe';
import browser from '../../utils/browser-polyfill';
import { Transport } from './transport';
import { MessageMap, MessageAction } from './messages';

type Handler = (data: unknown) => unknown | Promise<unknown>;

@injectable()
export class ExtensionTransport implements Transport {
	private handlers = new Map<string, Handler>();

	constructor() {
		this.listen();
	}

	async send<K extends MessageAction>(
		action: K,
		data?: MessageMap[K]['request']
	): Promise<MessageMap[K]['response']> {
		const response = await browser.runtime.sendMessage({
			action,
			...(data != null && typeof data === 'object' ? data : { _payload: data }),
		});
		return response as MessageMap[K]['response'];
	}

	async sendToTab<K extends MessageAction>(
		tabId: number,
		action: K,
		data?: MessageMap[K]['request']
	): Promise<MessageMap[K]['response']> {
		const response = await browser.tabs.sendMessage(tabId, {
			action,
			...(data != null && typeof data === 'object' ? data : { _payload: data }),
		});
		return response as MessageMap[K]['response'];
	}

	on<K extends MessageAction>(
		action: K,
		handler: (data: MessageMap[K]['request']) => MessageMap[K]['response'] | Promise<MessageMap[K]['response']>
	): void {
		this.handlers.set(action, handler as Handler);
	}

	off<K extends MessageAction>(action: K): void {
		this.handlers.delete(action);
	}

	private listen(): void {
		browser.runtime.onMessage.addListener(
			(msg: unknown, _sender: unknown, sendResponse: (message: unknown) => void) => {
				const message = msg as { action?: string; [key: string]: unknown } | null;
				if (!message?.action) return undefined;

				const handler = this.handlers.get(message.action);
				if (!handler) return undefined;

				// Strip action key, pass rest as data
				const { action: _, ...data } = message;
				const payload = '_payload' in data ? data._payload : data;

				const result = handler(payload);
				if (result instanceof Promise) {
					result.then(sendResponse).catch((err) => {
						console.error(`[transport] Error handling "${message.action}":`, err);
						sendResponse(undefined);
					});
					return true; // keep channel open for async
				}

				sendResponse(result);
				return undefined;
			}
		);
	}
}
