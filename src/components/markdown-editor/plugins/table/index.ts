import {
	type LexicalEditor, type Klass, type LexicalNode,
	$createParagraphNode, $createTextNode,
} from 'lexical';
import type { Transformer, MultilineElementTransformer } from '@lexical/markdown';
import type { ElementNode } from 'lexical';
import {
	TableNode, TableRowNode, TableCellNode,
	$createTableNode, $createTableRowNode, $createTableCellNode,
	$isTableNode, $isTableRowNode, $isTableCellNode,
	INSERT_TABLE_COMMAND, registerTablePlugin,
	TableCellHeaderStates,
	$insertTableRowAtSelection, $insertTableColumnAtSelection,
	$moveTableColumn,
} from '@lexical/table';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

const TABLE_LINE_RE = /^\|(.+)\|[ \t]*$/;
const SEPARATOR_RE = /^\|[\s\-:|]+\|$/;

const TABLE_TRANSFORMER: MultilineElementTransformer = {
	dependencies: [TableNode, TableRowNode, TableCellNode],
	export: (node: LexicalNode) => {
		if (!$isTableNode(node)) return null;
		const rows = node.getChildren();
		if (rows.length === 0) return null;
		const lines: string[] = [];
		let isFirstRow = true;
		for (const row of rows) {
			if (!$isTableRowNode(row)) continue;
			const cells = row.getChildren();
			const cellTexts = cells.map(cell => {
				if (!$isTableCellNode(cell)) return '';
				return cell.getTextContent().replace(/\|/g, '\\|').trim();
			});
			lines.push('| ' + cellTexts.join(' | ') + ' |');
			if (isFirstRow) {
				lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
				isFirstRow = false;
			}
		}
		return lines.join('\n');
	},
	regExpStart: TABLE_LINE_RE,
	handleImportAfterStartMatch: ({ lines, startLineIndex, rootNode }) => {
		// Consume all consecutive table lines
		let endIndex = startLineIndex;
		for (let i = startLineIndex + 1; i < lines.length; i++) {
			if (TABLE_LINE_RE.test(lines[i].trim())) {
				endIndex = i;
			} else {
				break;
			}
		}
		// Need at least 2 lines (header + separator)
		if (endIndex === startLineIndex) return null;

		// Collect all lines and filter separator rows
		const allLines = lines.slice(startLineIndex, endIndex + 1);
		const dataLines = allLines.filter(line => !SEPARATOR_RE.test(line.trim()));
		if (dataLines.length === 0) return null;

		// Build table node
		const tableNode = $createTableNode();
		dataLines.forEach((line, rowIndex) => {
			const cells = line.split('|').slice(1, -1).map(c => c.trim());
			const rowNode = $createTableRowNode();
			cells.forEach(cellText => {
				const headerState = rowIndex === 0
					? TableCellHeaderStates.ROW
					: TableCellHeaderStates.NO_STATUS;
				const cellNode = $createTableCellNode(headerState);
				const paragraph = $createParagraphNode();
				paragraph.append($createTextNode(cellText.replace(/\\\|/g, '|')));
				cellNode.append(paragraph);
				rowNode.append(cellNode);
			});
			tableNode.append(rowNode);
		});

		rootNode.append(tableNode);
		return [true, endIndex];
	},
	replace: () => {},
	type: 'multiline-element',
};

export class EditorPluginTable extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private cleanups: (() => void)[] = [];
	private addRowBtn: HTMLButtonElement | null = null;
	private addColBtn: HTMLButtonElement | null = null;
	private rowHandle: HTMLElement | null = null;
	private colHandle: HTMLElement | null = null;
	private activeTable: HTMLElement | null = null;
	private hideTimeout: ReturnType<typeof setTimeout> | null = null;

	getNodes(): Klass<LexicalNode>[] { return [TableNode, TableRowNode, TableCellNode]; }
	getTransformers(): Transformer[] { return [TABLE_TRANSFORMER]; }

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'table', title: 'Insert table',
			icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
			onAction: () => this.showTableDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;
		this.cleanups.push(registerTablePlugin(editor));

		const container = hostShadow.querySelector('.editor-container')!;

		// Add row/col buttons
		this.addRowBtn = this.createHelper(container, 'table-helper-btn table-add-row', 'Add row', '+', () => this.addRow());
		this.addColBtn = this.createHelper(container, 'table-helper-btn table-add-col', 'Add column', '+', () => this.addCol());

		// Drag handles — native draggable
		this.rowHandle = this.createDragHandle(container, 'table-drag-handle table-drag-row', 'row');
		this.colHandle = this.createDragHandle(container, 'table-drag-handle table-drag-col', 'col');

		// Hover detection on editor root
		const root = editor.getRootElement();
		if (root) {
			const onMouseOver = (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				const table = target.closest('table');
				if (table && root.contains(table)) {
					this.cancelHide();
					if (table !== this.activeTable) {
						this.activeTable = table as HTMLElement;
						this.positionAddButtons();
					}
					const cell = target.closest('td, th');
					if (cell) this.positionHandles(cell as HTMLElement, table as HTMLElement);
				}
			};
			const onMouseOut = (e: MouseEvent) => {
				const related = e.relatedTarget as HTMLElement | null;
				if (!related || (!related.closest('table') && !related.closest('.table-helper-btn') && !related.closest('.table-drag-handle'))) {
					this.scheduleHide();
				}
			};
			root.addEventListener('mouseover', onMouseOver);
			root.addEventListener('mouseout', onMouseOut);

			// Block drag from anything inside the table except our handles
			root.addEventListener('dragstart', (e) => {
				const target = e.target as HTMLElement;
				if (target.closest('table') && !target.classList.contains('table-drag-handle')) {
					e.preventDefault();
				}
			});

			// Drop targets: rows and cells
			root.addEventListener('dragover', (e) => {
				const target = e.target as HTMLElement;
				if (target.closest('table')) {
					e.preventDefault();
					e.dataTransfer!.dropEffect = 'move';
					this.updateDropIndicator(e, root);
				}
			});
			root.addEventListener('dragleave', (e) => {
				const related = e.relatedTarget as HTMLElement | null;
				if (!related || !related.closest('table')) {
					this.clearDropIndicators();
				}
			});
			root.addEventListener('drop', (e) => {
				e.preventDefault();
				this.performDrop(e);
			});

			this.cleanups.push(() => {
				root.removeEventListener('mouseover', onMouseOver);
				root.removeEventListener('mouseout', onMouseOut);
			});
		}
	}

	detach(): void {
		this.cleanups.forEach(fn => fn());
		this.cleanups = [];
		[this.addRowBtn, this.addColBtn, this.rowHandle, this.colHandle].forEach(el => el?.remove());
		this.addRowBtn = this.addColBtn = this.rowHandle = this.colHandle = null;
		this.activeTable = null;
		this.editor = null;
		this.hostShadow = null;
	}

	private createHelper(container: Element, cls: string, title: string, text: string, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement('button') as HTMLButtonElement;
		btn.className = cls;
		btn.type = 'button';
		btn.title = title;
		btn.textContent = text;
		btn.style.display = 'none';
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
		btn.addEventListener('mouseenter', () => this.cancelHide());
		btn.addEventListener('mouseleave', () => this.scheduleHide());
		container.appendChild(btn);
		return btn;
	}

	private createDragHandle(container: Element, cls: string, axis: 'row' | 'col'): HTMLElement {
		const handle = document.createElement('div');
		handle.className = cls;
		handle.innerHTML = '⠿';
		handle.draggable = true;
		handle.style.display = 'none';
		handle.addEventListener('mouseenter', () => this.cancelHide());
		handle.addEventListener('mouseleave', () => this.scheduleHide());
		handle.addEventListener('dragstart', (e) => {
			e.dataTransfer!.effectAllowed = 'move';
			e.dataTransfer!.setData('text/plain', `${axis}:${handle.dataset.index}`);
			// Transparent drag image
			const ghost = document.createElement('div');
			ghost.style.opacity = '0';
			document.body.appendChild(ghost);
			e.dataTransfer!.setDragImage(ghost, 0, 0);
			setTimeout(() => ghost.remove(), 0);
			// Highlight source
			requestAnimationFrame(() => this.highlightSource(parseInt(handle.dataset.index || '0'), axis));
		});
		handle.addEventListener('dragend', () => {
			this.clearDropIndicators();
			this.clearSourceHighlight();
		});
		container.appendChild(handle);
		return handle;
	}

	private positionAddButtons() {
		if (!this.addRowBtn || !this.addColBtn || !this.activeTable || !this.hostShadow) return;
		const { top, left, width, height } = this.getTableOffset();
		this.addRowBtn.style.display = 'flex';
		this.addRowBtn.style.top = (top + height) + 'px';
		this.addRowBtn.style.left = left + 'px';
		this.addRowBtn.style.width = width + 'px';
		this.addColBtn.style.display = 'flex';
		this.addColBtn.style.top = top + 'px';
		this.addColBtn.style.left = (left + width) + 'px';
		this.addColBtn.style.height = height + 'px';
	}

	private positionHandles(cell: HTMLElement, table: HTMLElement) {
		if (!this.rowHandle || !this.colHandle || !this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container')!;
		const editorRoot = this.hostShadow.querySelector('.editor-root') as HTMLElement;
		const containerRect = container.getBoundingClientRect();
		const tableRect = table.getBoundingClientRect();
		const scrollTop = editorRoot?.scrollTop || 0;

		const row = cell.closest('tr')!;
		const rowRect = row.getBoundingClientRect();
		const rowIndex = Array.from(table.querySelectorAll('tr')).indexOf(row);
		this.rowHandle.style.display = 'flex';
		this.rowHandle.style.top = (rowRect.top - containerRect.top + scrollTop) + 'px';
		this.rowHandle.style.left = (tableRect.left - containerRect.left - 20) + 'px';
		this.rowHandle.style.height = rowRect.height + 'px';
		this.rowHandle.dataset.index = String(rowIndex);

		const cellRect = cell.getBoundingClientRect();
		const colIndex = Array.from(row.children).indexOf(cell);
		this.colHandle.style.display = 'flex';
		this.colHandle.style.top = (tableRect.top - containerRect.top + scrollTop - 20) + 'px';
		this.colHandle.style.left = (cellRect.left - containerRect.left) + 'px';
		this.colHandle.style.width = cellRect.width + 'px';
		this.colHandle.dataset.index = String(colIndex);
	}

	private getTableOffset() {
		const container = this.hostShadow!.querySelector('.editor-container')!;
		const editorRoot = this.hostShadow!.querySelector('.editor-root') as HTMLElement;
		const tableRect = this.activeTable!.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const scrollTop = editorRoot?.scrollTop || 0;
		return {
			top: tableRect.top - containerRect.top + scrollTop,
			left: tableRect.left - containerRect.left,
			width: tableRect.width,
			height: tableRect.height,
		};
	}

	private highlightSource(index: number, axis: 'row' | 'col') {
		if (!this.activeTable) return;
		if (axis === 'row') {
			this.activeTable.querySelectorAll('tr')[index]?.classList.add('table-row-dragging');
		} else {
			this.activeTable.querySelectorAll('tr').forEach(row => {
				row.children[index]?.classList.add('table-col-dragging');
			});
		}
	}

	private clearSourceHighlight() {
		if (!this.activeTable) return;
		this.activeTable.querySelectorAll('.table-row-dragging').forEach(el => el.classList.remove('table-row-dragging'));
		this.activeTable.querySelectorAll('.table-col-dragging').forEach(el => el.classList.remove('table-col-dragging'));
	}

	private updateDropIndicator(e: DragEvent, root: HTMLElement) {
		if (!this.activeTable) return;
		const data = e.dataTransfer?.types.includes('text/plain') ? 'pending' : null;
		if (!data) return;

		// Clear previous indicators
		this.activeTable.querySelectorAll('.drop-before, .drop-after').forEach(el => {
			el.classList.remove('drop-before', 'drop-after');
		});

		const target = e.target as HTMLElement;

		// Detect axis from the ongoing drag (check if row or column handle started it)
		const cell = target.closest('td, th') as HTMLElement;
		if (!cell) return;
		const row = cell.closest('tr')!;

		// Try to determine axis - if mouse is near top/bottom edge of a row, it's a row drag
		const rowRect = row.getBoundingClientRect();
		const cellRect = cell.getBoundingClientRect();
		const rowMid = rowRect.top + rowRect.height / 2;
		const colMid = cellRect.left + cellRect.width / 2;

		// Check what type of drag is happening by examining dataTransfer
		// We can't read data during dragover, but we know the type
		if (this.rowHandle?.matches(':active') || this.activeTable.querySelector('.table-row-dragging')) {
			// Row mode
			if (e.clientY < rowMid) {
				row.classList.add('drop-before');
			} else {
				row.classList.add('drop-after');
			}
		} else {
			// Column mode
			const colCells = this.activeTable.querySelectorAll('tr');
			const colIndex = Array.from(row.children).indexOf(cell);
			colCells.forEach(r => {
				const c = r.children[colIndex];
				if (c) {
					if (e.clientX < colMid) {
						c.classList.add('drop-before');
					} else {
						c.classList.add('drop-after');
					}
				}
			});
		}
	}

	private clearDropIndicators() {
		this.activeTable?.querySelectorAll('.drop-before, .drop-after').forEach(el => {
			el.classList.remove('drop-before', 'drop-after');
		});
	}

	private performDrop(e: DragEvent) {
		if (!this.activeTable || !this.editor) return;
		const raw = e.dataTransfer?.getData('text/plain');
		if (!raw) return;
		const [axis, originStr] = raw.split(':');
		const originIndex = parseInt(originStr);

		const target = e.target as HTMLElement;
		const cell = target.closest('td, th');
		if (!cell) return;
		const row = cell.closest('tr')!;

		const tableNode = this.getTableNodeFromDom(this.activeTable);
		if (!tableNode) return;

		if (axis === 'row') {
			const rowRect = row.getBoundingClientRect();
			const insertBefore = e.clientY < rowRect.top + rowRect.height / 2;
			let targetIndex = Array.from(this.activeTable.querySelectorAll('tr')).indexOf(row);
			if (targetIndex === originIndex) return;

			this.editor.update(() => {
				const rows = tableNode.getChildren();
				const movedRow = rows[originIndex];
				if (!$isTableRowNode(movedRow)) return;
				const targetRow = rows[targetIndex];
				movedRow.remove();
				if (insertBefore) {
					targetRow.insertBefore(movedRow);
				} else {
					targetRow.insertAfter(movedRow);
				}
			});
		} else {
			const cellRect = cell.getBoundingClientRect();
			const targetIndex = Array.from(row.children).indexOf(cell);
			if (targetIndex === originIndex) return;

			this.editor.update(() => {
				$moveTableColumn(tableNode, originIndex, targetIndex);
			});
		}

		this.clearDropIndicators();
		this.clearSourceHighlight();
		setTimeout(() => this.positionAddButtons(), 20);
	}

	private hideHelpers() {
		[this.addRowBtn, this.addColBtn, this.rowHandle, this.colHandle].forEach(el => {
			if (el) el.style.display = 'none';
		});
		this.activeTable = null;
	}

	private scheduleHide() {
		this.cancelHide();
		this.hideTimeout = setTimeout(() => this.hideHelpers(), 200);
	}

	private cancelHide() {
		if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }
	}

	private addRow() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const t = this.getTableNodeFromDom(this.activeTable!);
			if (!t) return;
			const lastRow = t.getLastChild();
			if (!$isTableRowNode(lastRow)) return;
			const lastCell = lastRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableRowAtSelection(true);
		});
		setTimeout(() => this.positionAddButtons(), 50);
	}

	private addCol() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const t = this.getTableNodeFromDom(this.activeTable!);
			if (!t) return;
			const firstRow = t.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			const lastCell = firstRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableColumnAtSelection(true);
		});
		setTimeout(() => this.positionAddButtons(), 50);
	}

	private getTableNodeFromDom(tableDom: HTMLElement): TableNode | null {
		if (!this.editor) return null;
		let result: TableNode | null = null;
		this.editor.getEditorState().read(() => {
			this.editor!.getEditorState()._nodeMap.forEach((node: LexicalNode) => {
				if ($isTableNode(node) && this.editor!.getElementByKey(node.getKey()) === tableDom) {
					result = node as TableNode;
				}
			});
		});
		return result;
	}

	private async showTableDialog() {
		if (!this.editor || !this.hostShadow) return;
		const popover = new EditorPopover();
		this.hostShadow.appendChild(popover);
		const result = await popover.show({
			title: 'Insert Table',
			fields: [
				{ name: 'rows', label: 'Rows', placeholder: '3', type: 'number' },
				{ name: 'cols', label: 'Columns', placeholder: '3', type: 'number' },
			],
			submitLabel: 'Insert',
		});
		if (!result) return;
		const rows = Math.max(1, Math.min(20, parseInt(result.rows) || 3));
		const cols = Math.max(1, Math.min(10, parseInt(result.cols) || 3));
		this.editor.dispatchCommand(INSERT_TABLE_COMMAND, {
			rows: String(rows), columns: String(cols),
			includeHeaders: { rows: true, columns: false },
		});
	}
}

if (!customElements.get('editor-plugin-table')) {
	customElements.define('editor-plugin-table', EditorPluginTable);
}
