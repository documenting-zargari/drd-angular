/**
 * Column/row model for the search-results comparison table (and its export).
 *
 * One row per sample. For a search on an attribute (e.g. `origin`) a
 * question gets one column per searched field, followed by its own Form
 * column — a cell showing only "Current-L2" with no form was useless, and
 * putting form and attribute into one column mixed the two (4–5 Oct 2026).
 * When a question has several columns, each answer is one line in every
 * column, so a form and its attribute stay on the same line.
 *
 * Without search criteria (plain category browsing) a question keeps a
 * single column whose value comes from the caller's `fallbackValue`.
 */

import { ANSWER_VALUE_FIELDS } from '../api/data.service';
import { formatFieldValue } from '../shared/format-field-value';
import { getByPath, splitFieldNames } from '../tables/field-eval';

export interface ComparisonColumn {
  /** Sort/URL key: the question id for a single-column question, else `<id>:<field>`. */
  key: string;
  questionId: any;
  /** Answer field shown in this column; null = caller's fallback value. */
  field: string | null;
  /** Readable field name when the question has several columns, else null. */
  fieldLabel: string | null;
}

export interface ComparisonRow {
  sample_ref: string;
  /** Cell text per column key ('-' when empty). */
  cells: Map<string, string>;
}

const questionOf = (r: any): string => String(r.question_id ?? r.category);

/** Display text of `field` (a `|`-compound of `.`-paths) on one answer. */
export function fieldText(result: any, field: string): string {
  return splitFieldNames(field)
    .map(path => formatFieldValue(getByPath(result, path)).trim())
    .filter(v => v)
    .join(': ');
}

export function fieldLabel(field: string): string {
  const text = splitFieldNames(field).join(' / ').replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildComparisonColumns(results: any[], questionIds: any[]): ComparisonColumn[] {
  const columns: ComparisonColumn[] = [];
  for (const questionId of questionIds) {
    const qid = String(questionId);
    const answers = results.filter(r => questionOf(r) === qid);

    const searched: string[] = [];
    for (const r of answers) {
      for (const f of r.matched_fields ?? (r.matched_field ? [r.matched_field] : [])) {
        if (!searched.includes(f)) searched.push(f);
      }
    }
    const formField = ANSWER_VALUE_FIELDS.find(f => answers.some(r => fieldText(r, f)));
    const fields = searched.filter(f => f !== formField);
    if (formField && (fields.length > 0 || searched.includes(formField))) fields.push(formField);

    if (fields.length <= 1) {
      columns.push({ key: qid, questionId, field: fields[0] ?? null, fieldLabel: null });
    } else {
      for (const field of fields) {
        columns.push({ key: `${qid}:${field}`, questionId, field, fieldLabel: fieldLabel(field) });
      }
    }
  }
  return columns;
}

export function buildComparisonRows(
  results: any[],
  columns: ComparisonColumn[],
  fallbackValue: (result: any) => string
): ComparisonRow[] {
  const byQuestion = new Map<string, ComparisonColumn[]>();
  for (const col of columns) {
    const qid = String(col.questionId);
    byQuestion.set(qid, [...(byQuestion.get(qid) ?? []), col]);
  }

  // sample -> question -> distinct answer lines (one value per column)
  const samples = new Map<string, Map<string, string[][]>>();
  for (const r of results) {
    const qid = questionOf(r);
    const cols = byQuestion.get(qid);
    if (!cols) continue;
    if (!samples.has(r.sample)) samples.set(r.sample, new Map());
    const perQuestion = samples.get(r.sample)!;
    const line = cols.map(c => (c.field ? fieldText(r, c.field) : fallbackValue(r)) || '-');
    const lines = perQuestion.get(qid) ?? [];
    if (line.some(v => v !== '-') || lines.length === 0) {
      if (lines.length === 1 && lines[0].every(v => v === '-')) lines.pop();
      if (!lines.some(l => l.join('\u0000') === line.join('\u0000'))) lines.push(line);
    }
    perQuestion.set(qid, lines);
  }

  return Array.from(samples, ([sample_ref, perQuestion]) => {
    const cells = new Map<string, string>();
    for (const [qid, cols] of byQuestion) {
      const lines = perQuestion.get(qid) ?? [];
      cols.forEach((col, i) => {
        const values = lines.map(l => l[i]);
        // Several columns: keep one line per answer so they line up.
        // Single column: distinct non-empty values, comma-joined (as before).
        const text = cols.length > 1
          ? values.join('\n')
          : [...new Set(values.filter(v => v !== '-'))].join(', ');
        cells.set(col.key, text || '-');
      });
    }
    return { sample_ref, cells };
  });
}
