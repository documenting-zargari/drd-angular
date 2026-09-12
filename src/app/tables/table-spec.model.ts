/**
 * The declarative table `spec` served on each View document (schema v1),
 * replacing the legacy HTML template dialect. See
 * `roma-server/data/table_spec.py` for the authoritative shape + validator.
 *
 * The client only ever *renders* a spec — no parsing, no span reconstruction.
 * `TableSpecRendererService.buildRenderModel()` turns a spec + the answers for
 * a sample into a flat `RenderTable[]` the template walks directly.
 */

export const TABLE_SCHEMA_VERSION = 1;

export type TableKind = 'template' | 'grid' | 'list';
export type CellLayout = 'inline' | 'stack';
export type MultiAnswer = 'rows' | 'combine';

export interface CellBinding {
  /** `|`-separated list of `.`-separated key paths into an answer. */
  field: string;
  /** Grid/list cells carry their own question; template cells inherit the row's. */
  questionId?: number;
  /** `stack` = one resolved value per line; `inline` (default) = comma-joined. */
  layout?: CellLayout;
}

export interface TableColumn {
  /** Non-null only for `template` tables (the field pulled for every row). */
  cell: CellBinding | null;
}

export interface HeaderCell {
  label: string;
  colspan?: number;
  rowspan?: number;
}

export interface TemplateRow {
  labels: string[];
  questionId: number;
}

export interface GridRow {
  labels: string[];
  cells: (CellBinding | null)[];
}

export type SpecRow = TemplateRow | GridRow;

export interface TableDef {
  kind: TableKind;
  caption: string | null;
  rowHeaderWidth: number;
  columnHeader: HeaderCell[][];
  columns: TableColumn[];
  multiAnswer?: MultiAnswer;
  rows: SpecRow[];
}

export interface TableSection {
  heading: string | null;
  tables: TableDef[];
}

export interface TableSpec {
  schemaVersion: number;
  title: string;
  sections: TableSection[];
}

export interface View {
  slug: string;
  spec: TableSpec | null;
  parentId: number | null;
  /** Retained only while the legacy fallback path exists (dropped in Phase 3). */
  content?: string;
}

export function isTemplateRow(row: SpecRow): row is TemplateRow {
  return (row as TemplateRow).questionId !== undefined;
}

// --- render model (output of the renderer, input to the template) ------------

export type RenderCellKind = 'corner' | 'colHeader' | 'rowHeader' | 'data' | 'addAnswer';

export interface RenderCell {
  kind: RenderCellKind;
  /** Resolved display text ('' until answers arrive / when empty). */
  text: string;
  colspan: number;
  rowspan: number;
  /** Covered by a span from above/left — the template skips it with *ngIf. */
  hidden: boolean;
  /** Edit-mode payload, present on `data` cells and `addAnswer` cells. */
  questionId?: number;
  field?: string;
  /** The specific Answer._key this cell currently shows, when known. */
  answerKey?: string;
}

export interface RenderRow {
  cells: RenderCell[];
}

export interface RenderTable {
  sectionHeading: string | null;
  caption: string | null;
  columnHeaderRows: RenderCell[][];
  bodyRows: RenderRow[];
}
