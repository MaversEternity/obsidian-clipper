/**
 * Generic typed transport for cross-context messaging.
 * Wraps browser.runtime.sendMessage / browser.tabs.sendMessage
 * with compile-time type safety.
 */

import { MessageMap, MessageAction } from './messages';

export interface Transport {
	/** Send a message and wait for a typed response */
	send<K extends MessageAction>(
		action: K,
		data?: MessageMap[K]['request']
	): Promise<MessageMap[K]['response']>;

	/** Send a message to a specific tab */
	sendToTab<K extends MessageAction>(
		tabId: number,
		action: K,
		data?: MessageMap[K]['request']
	): Promise<MessageMap[K]['response']>;

	/** Register a handler for incoming messages */
	on<K extends MessageAction>(
		action: K,
		handler: (data: MessageMap[K]['request']) => MessageMap[K]['response'] | Promise<MessageMap[K]['response']>
	): void;

	/** Remove a handler */
	off<K extends MessageAction>(action: K): void;
}
