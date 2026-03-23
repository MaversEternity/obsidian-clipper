/**
 * LookupClient — contract for note matching backends.
 */

export interface NoteRef {
	filename: string;
	vault: string;
	name: string;
	path: string;
	tags: string[];
}

export interface LookupMatch {
	tag: string;
	notes: NoteRef[];
}

export interface LookupClient {
	/** Given page text, return notes whose tags appear in it */
	match(text: string): Promise<LookupMatch[]>;
}
