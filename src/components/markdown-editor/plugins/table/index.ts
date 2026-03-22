import {
	type LexicalEditor, type Klass, type LexicalNode,
	$createParagraphNode, $createTextNode,
} from 'lexical';
import type { Transformer, ElementTransformer } from '@lexical/markdown';
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

const TABLE_TRANSFORMER: ElementTransformer = {
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
	regExp: /^\|(.+)\|[ \t]*$/,
	replace: (_parentNode, _children, _match, isImport) => {
		if (!isImport) return false;
		return false;
	},
	type: 'element',
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
	private dragState: { originIndex: number; targetIndex: number; insertAfter: boolean; axis: 'row' | 'col'; tableNode: TableNode } | null = null;
	private insertIndicator: HTMLElement | null = null;

	getNodes(): Klass<LexicalNode>[] {
		return [TableNode, TableRowNode, TableCellNode];
	}

	getTransformers(): Transformer[] {
		return [TABLE_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'table',
			title: 'Insert table',
			icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
			onAction: () => this.showTableDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;

		this.cleanups.push(registerTablePlugin(editor));

		// Create persistent helper buttons (appended to editor-container)
		const container = hostShadow.querySelector('.editor-container')!;

		this.addRowBtn = document.createElement('button') as HTMLButtonElement;
		this.addRowBtn.className = 'table-helper-btn table-add-row';
		this.addRowBtn.type = 'button';
		this.addRowBtn.title = 'Add row';
		this.addRowBtn.textContent = '+';
		this.addRowBtn.style.display = 'none';
		this.addRowBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.addRow();
		});
		this.addRowBtn.addEventListener('mouseenter', () => this.cancelHide());
		this.addRowBtn.addEventListener('mouseleave', () => this.scheduleHide());
		container.appendChild(this.addRowBtn);

		this.addColBtn = document.createElement('button') as HTMLButtonElement;
		this.addColBtn.className = 'table-helper-btn table-add-col';
		this.addColBtn.type = 'button';
		this.addColBtn.title = 'Add column';
		this.addColBtn.textContent = '+';
		this.addColBtn.style.display = 'none';
		this.addColBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.addCol();
		});
		this.addColBtn.addEventListener('mouseenter', () => this.cancelHide());
		this.addColBtn.addEventListener('mouseleave', () => this.scheduleHide());
		container.appendChild(this.addColBtn);

		// Create row/col drag handles
		this.rowHandle = document.createElement('div');
		this.rowHandle.className = 'table-drag-handle table-drag-row';
		this.rowHandle.innerHTML = '⠿';
		this.rowHandle.style.display = 'none';
		this.rowHandle.addEventListener('mouseenter', () => this.cancelHide());
		this.rowHandle.addEventListener('mouseleave', () => this.scheduleHide());
		this.rowHandle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const idx = parseInt(this.rowHandle!.dataset.index || '0');
			this.startDrag(idx, e.clientY, 'row');
		});
		container.appendChild(this.rowHandle);

		this.colHandle = document.createElement('div');
		this.colHandle.className = 'table-drag-handle table-drag-col';
		this.colHandle.innerHTML = '⠿';
		this.colHandle.style.display = 'none';
		this.colHandle.addEventListener('mouseenter', () => this.cancelHide());
		this.colHandle.addEventListener('mouseleave', () => this.scheduleHide());
		this.colHandle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const idx = parseInt(this.colHandle!.dataset.index || '0');
			this.startDrag(idx, e.clientX, 'col');
		});
		container.appendChild(this.colHandle);

		// Listen for mouse events on editor root
		const root = editor.getRootElement();
		if (root) {
			const onMouseOver = (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				const table = target.closest('table');
				if (table && root.contains(table)) {
					this.cancelHide();
					if (table !== this.activeTable) {
						this.activeTable = table as HTMLElement;
						this.positionHelpers();
					}
					// Position row/col handles based on hovered cell
					const cell = target.closest('td, th');
					if (cell) {
						this.positionDragHandles(cell as HTMLElement, table as HTMLElement);
					}
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
			this.cleanups.push(() => {
				root.removeEventListener('mouseover', onMouseOver);
				root.removeEventListener('mouseout', onMouseOut);
			});
		}
	}

	detach(): void {
		this.cleanups.forEach(fn => fn());
		this.cleanups = [];
		this.addRowBtn?.remove();
		this.addColBtn?.remove();
		this.rowHandle?.remove();
		this.colHandle?.remove();
		this.addRowBtn = null;
		this.addColBtn = null;
		this.rowHandle = null;
		this.colHandle = null;
		this.activeTable = null;
		this.editor = null;
		this.hostShadow = null;
	}

	private positionHelpers() {
		if (!this.addRowBtn || !this.addColBtn || !this.activeTable || !this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container')!;
		const editorRoot = this.hostShadow.querySelector('.editor-root') as HTMLElement;
		const tableRect = this.activeTable.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const scrollTop = editorRoot?.scrollTop || 0;

		const top = tableRect.top - containerRect.top + scrollTop;
		const left = tableRect.left - containerRect.left;

		this.addRowBtn.style.display = 'flex';
		this.addRowBtn.style.top = (top + tableRect.height) + 'px';
		this.addRowBtn.style.left = left + 'px';
		this.addRowBtn.style.width = tableRect.width + 'px';

		this.addColBtn.style.display = 'flex';
		this.addColBtn.style.top = top + 'px';
		this.addColBtn.style.left = (left + tableRect.width) + 'px';
		this.addColBtn.style.height = tableRect.height + 'px';

	}

	private positionDragHandles(cell: HTMLElement, table: HTMLElement) {
		if (!this.rowHandle || !this.colHandle || !this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container')!;
		const editorRoot = this.hostShadow.querySelector('.editor-root') as HTMLElement;
		const containerRect = container.getBoundingClientRect();
		const tableRect = table.getBoundingClientRect();
		const scrollTop = editorRoot?.scrollTop || 0;

		const row = cell.closest('tr')!;
		const rowRect = row.getBoundingClientRect();
		const rowIndex = Array.from(table.querySelectorAll('tr')).indexOf(row);

		// Row handle — left of table, aligned to hovered row
		this.rowHandle.style.display = 'flex';
		this.rowHandle.style.top = (rowRect.top - containerRect.top + scrollTop) + 'px';
		this.rowHandle.style.left = (tableRect.left - containerRect.left - 20) + 'px';
		this.rowHandle.style.height = rowRect.height + 'px';
		this.rowHandle.dataset.index = String(rowIndex);

		// Column handle — top of table, aligned to hovered column
		const cellRect = cell.getBoundingClientRect();
		const colIndex = Array.from(row.children).indexOf(cell);

		this.colHandle.style.display = 'flex';
		this.colHandle.style.top = (tableRect.top - containerRect.top + scrollTop - 20) + 'px';
		this.colHandle.style.left = (cellRect.left - containerRect.left) + 'px';
		this.colHandle.style.width = cellRect.width + 'px';
		this.colHandle.dataset.index = String(colIndex);
	}

	private startDrag(index: number, _startPos: number, axis: 'row' | 'col') {
		if (!this.activeTable || !this.editor || !this.hostShadow) return;

		const tableNode = this.getTableNodeFromDom(this.activeTable);
		if (!tableNode) return;

		this.dragState = { originIndex: index, targetIndex: index, insertAfter: true, axis, tableNode };
		this.highlightDragged(index, axis);

		// Create insertion indicator line
		this.insertIndicator = document.createElement('div');
		this.insertIndicator.className = axis === 'row' ? 'table-insert-indicator-row' : 'table-insert-indicator-col';
		const container = this.hostShadow.querySelector('.editor-container')!;
		container.appendChild(this.insertIndicator);

		const handle = axis === 'row' ? this.rowHandle : this.colHandle;

		const onMouseMove = (e: MouseEvent) => {
			if (!this.dragState || !this.activeTable || !this.insertIndicator) return;
			const pos = axis === 'row' ? e.clientY : e.clientX;
			const editorRoot = this.hostShadow!.querySelector('.editor-root') as HTMLElement;
			const containerRect = container.getBoundingClientRect();
			const scrollTop = editorRoot?.scrollTop || 0;
			const tableRect = this.activeTable.getBoundingClientRect();
			const tableLeft = tableRect.left - containerRect.left;
			const tableTop = tableRect.top - containerRect.top + scrollTop;

			// Move handle along axis, clamped to table bounds
			if (handle) {
				if (axis === 'row') {
					const rowHeight = parseInt(handle.style.height) || 30;
					const minY = tableTop;
					const maxY = tableTop + tableRect.height - rowHeight;
					const y = Math.max(minY, Math.min(maxY, e.clientY - containerRect.top + scrollTop - rowHeight / 2));
					handle.style.top = y + 'px';
				} else {
					const colWidth = parseInt(handle.style.width) || 60;
					const minX = tableLeft;
					const maxX = tableLeft + tableRect.width - colWidth;
					const x = Math.max(minX, Math.min(maxX, e.clientX - containerRect.left - colWidth / 2));
					handle.style.left = x + 'px';
				}
			}

			// Find target position
			let targetIndex = this.dragState.originIndex;
			let insertAfter = true;

			if (axis === 'row') {
				const rows = this.activeTable.querySelectorAll('tr');
				for (let i = 0; i < rows.length; i++) {
					if (i === this.dragState.originIndex) continue;
					const rect = rows[i].getBoundingClientRect();
					const mid = rect.top + rect.height / 2;
					if (pos < mid) {
						targetIndex = i;
						insertAfter = false;
						break;
					}
					targetIndex = i;
					insertAfter = true;
				}

				// Position indicator line
				const targetRow = rows[targetIndex];
				if (targetRow) {
					const rect = targetRow.getBoundingClientRect();
					const y = insertAfter
						? rect.bottom - containerRect.top + scrollTop
						: rect.top - containerRect.top + scrollTop;
					this.insertIndicator.style.top = (y - 1) + 'px';
					this.insertIndicator.style.left = tableLeft + 'px';
					this.insertIndicator.style.width = tableRect.width + 'px';
					this.insertIndicator.style.display = targetIndex !== this.dragState.originIndex ? 'block' : 'none';
				}
			} else {
				const firstRow = this.activeTable.querySelector('tr');
				if (!firstRow) return;
				const cells = firstRow.children;
				for (let i = 0; i < cells.length; i++) {
					if (i === this.dragState.originIndex) continue;
					const rect = cells[i].getBoundingClientRect();
					const mid = rect.left + rect.width / 2;
					if (pos < mid) {
						targetIndex = i;
						insertAfter = false;
						break;
					}
					targetIndex = i;
					insertAfter = true;
				}

				// Position indicator line
				const targetCell = cells[targetIndex];
				if (targetCell) {
					const rect = targetCell.getBoundingClientRect();
					const x = insertAfter
						? rect.right - containerRect.left
						: rect.left - containerRect.left;
					this.insertIndicator.style.left = (x - 1) + 'px';
					this.insertIndicator.style.top = tableTop + 'px';
					this.insertIndicator.style.height = tableRect.height + 'px';
					this.insertIndicator.style.display = targetIndex !== this.dragState.originIndex ? 'block' : 'none';
				}
			}

			this.dragState.targetIndex = targetIndex;
			this.dragState.insertAfter = insertAfter;
		};

		const onMouseUp = () => {
			if (this.dragState && this.dragState.targetIndex !== this.dragState.originIndex) {
				const { originIndex, targetIndex, axis: dragAxis } = this.dragState;
				this.editor!.update(() => {
					if (dragAxis === 'row') {
						const rows = this.dragState!.tableNode.getChildren();
						const movedRow = rows[originIndex];
						if (!$isTableRowNode(movedRow)) return;
						const targetRow = rows[targetIndex];
						movedRow.remove();
						if (targetIndex < originIndex) {
							targetRow.insertBefore(movedRow);
						} else {
							targetRow.insertAfter(movedRow);
						}
					} else {
						$moveTableColumn(this.dragState!.tableNode, originIndex, targetIndex);
					}
				});
				setTimeout(() => this.positionHelpers(), 20);
			}

			this.clearDragHighlight();
			this.insertIndicator?.remove();
			this.insertIndicator = null;
			this.dragState = null;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	private hideHelpers() {
		if (this.addRowBtn) this.addRowBtn.style.display = 'none';
		if (this.addColBtn) this.addColBtn.style.display = 'none';
		if (this.rowHandle) this.rowHandle.style.display = 'none';
		if (this.colHandle) this.colHandle.style.display = 'none';
		this.activeTable = null;
	}

	private scheduleHide() {
		this.cancelHide();
		this.hideTimeout = setTimeout(() => this.hideHelpers(), 200);
	}

	private cancelHide() {
		if (this.hideTimeout) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
	}

	private addRow() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const tableNode = this.getTableNodeFromDom(this.activeTable!);
			if (!tableNode) return;
			const lastRow = tableNode.getLastChild();
			if (!$isTableRowNode(lastRow)) return;
			const lastCell = lastRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableRowAtSelection(true);
		});
		setTimeout(() => this.positionHelpers(), 50);
	}

	private addCol() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const tableNode = this.getTableNodeFromDom(this.activeTable!);
			if (!tableNode) return;
			const firstRow = tableNode.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			const lastCell = firstRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableColumnAtSelection(true);
		});
		setTimeout(() => this.positionHelpers(), 50);
	}

	private highlightDragged(index: number, axis: 'row' | 'col') {
		if (!this.activeTable) return;
		this.clearDragHighlight();
		if (axis === 'row') {
			const rows = this.activeTable.querySelectorAll('tr');
			rows[index]?.classList.add('table-row-dragging');
		} else {
			const rows = this.activeTable.querySelectorAll('tr');
			rows.forEach(row => {
				const cell = row.children[index];
				cell?.classList.add('table-col-dragging');
			});
		}
	}

	private clearDragHighlight() {
		if (!this.activeTable) return;
		this.activeTable.querySelectorAll('.table-row-dragging').forEach(el => el.classList.remove('table-row-dragging'));
		this.activeTable.querySelectorAll('.table-col-dragging').forEach(el => el.classList.remove('table-col-dragging'));
	}

	private getTableNodeFromDom(tableDom: HTMLElement): TableNode | null {
		if (!this.editor) return null;
		let result: TableNode | null = null;
		this.editor.getEditorState().read(() => {
			const editorState = this.editor!.getEditorState();
			editorState._nodeMap.forEach((node: LexicalNode) => {
				if ($isTableNode(node)) {
					const dom = this.editor!.getElementByKey(node.getKey());
					if (dom === tableDom) {
						result = node as TableNode;
					}
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
			rows: String(rows),
			columns: String(cols),
			includeHeaders: { rows: true, columns: false },
		});
	}
}

if (!customElements.get('editor-plugin-table')) {
	customElements.define('editor-plugin-table', EditorPluginTable);
}
