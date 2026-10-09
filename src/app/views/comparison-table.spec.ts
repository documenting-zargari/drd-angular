import { buildComparisonColumns, buildComparisonRows } from './comparison-table';

const fallback = (r: any) => r.form ?? '-';

describe('comparison table model', () => {
  const originResults = [
    { sample: 'BG-001', question_id: 1936, form: 'trebul', origin: 'Current-L2', matched_fields: ['origin'] },
    { sample: 'BG-001', question_id: 1936, form: 'mora', origin: 'Inherited', matched_fields: ['origin'] },
    { sample: 'RO-002', question_id: 1936, form: 'trebul', origin: 'Current-L2', matched_fields: ['origin', 'form'] },
  ];

  it('gives an attribute search its own column first, then a separate Form column', () => {
    const cols = buildComparisonColumns(originResults, [1936]);
    expect(cols.map(c => c.key)).toEqual(['1936:origin', '1936:form']);
    expect(cols.map(c => c.fieldLabel)).toEqual(['Origin', 'Form']);
  });

  it('keeps each answer on its own line so the attribute lines up with its form', () => {
    const cols = buildComparisonColumns(originResults, [1936]);
    const rows = buildComparisonRows(originResults, cols, fallback);
    const bg = rows.find(r => r.sample_ref === 'BG-001')!;
    expect(bg.cells.get('1936:origin')).toBe('Current-L2\nInherited');
    expect(bg.cells.get('1936:form')).toBe('trebul\nmora');
  });

  it('keeps a single column for a form search', () => {
    const results = [
      { sample: 'A', question_id: 5, form: 'x', matched_fields: ['form'] },
      { sample: 'A', question_id: 5, form: 'y', matched_fields: ['form'] },
    ];
    const cols = buildComparisonColumns(results, [5]);
    expect(cols).toEqual([{ key: '5', questionId: 5, field: 'form', fieldLabel: null }]);
    expect(buildComparisonRows(results, cols, fallback)[0].cells.get('5')).toBe('x, y');
  });

  it('uses the marker as the form column when the answer has no form', () => {
    const results = [{ sample: 'A', question_id: 7, marker: '-to', origin: 'Inherited', matched_fields: ['origin'] }];
    expect(buildComparisonColumns(results, [7]).map(c => c.key)).toEqual(['7:origin', '7:marker']);
  });

  it('falls back to one column per question without search criteria', () => {
    const results = [{ sample: 'A', question_id: 9, form: 'nasul' }];
    const cols = buildComparisonColumns(results, [9]);
    expect(cols).toEqual([{ key: '9', questionId: 9, field: null, fieldLabel: null }]);
    expect(buildComparisonRows(results, cols, fallback)[0].cells.get('9')).toBe('nasul');
  });

  it('shows "-" for a question the sample has no answer for', () => {
    const results = [
      { sample: 'A', question_id: 1, form: 'a', matched_fields: ['form'] },
      { sample: 'B', question_id: 2, form: 'b', matched_fields: ['form'] },
    ];
    const cols = buildComparisonColumns(results, [1, 2]);
    const a = buildComparisonRows(results, cols, fallback).find(r => r.sample_ref === 'A')!;
    expect(a.cells.get('2')).toBe('-');
  });
});
