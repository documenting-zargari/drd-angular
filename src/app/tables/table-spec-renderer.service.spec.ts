import { TableSpecRendererService } from './table-spec-renderer.service';
import { TableDef, TableSpec } from './table-spec.model';

function wrap(table: TableDef): TableSpec {
  return { schemaVersion: 1, title: 'T', sections: [{ heading: null, tables: [table] }] };
}

const svc = new TableSpecRendererService();

describe('TableSpecRendererService', () => {
  it('template: one body row per answer, N answers -> N rows', () => {
    const table: TableDef = {
      kind: 'template',
      caption: null,
      rowHeaderWidth: 1,
      columnHeader: [[{ label: '' }, { label: 'Form' }]],
      columns: [{ cell: { field: 'form' } }],
      multiAnswer: 'rows',
      rows: [{ labels: ['once'], questionId: 10 }],
    };
    const answers = new Map<number, any[]>([[10, [{ _key: 'a', form: 'jekh' }, { _key: 'b', form: ' jek' }]]]);
    const [rt] = svc.buildRenderModel(wrap(table), answers);
    expect(rt.bodyRows.length).toBe(2);
    expect(rt.bodyRows[0].cells.map((c) => c.kind)).toEqual(['rowHeader', 'data']);
    // label spans both answer rows
    expect(rt.bodyRows[0].cells[0].rowspan).toBe(2);
    expect(rt.bodyRows[1].cells[0].hidden).toBeTrue();
    expect(rt.bodyRows[0].cells[1].text).toBe('jekh');
    expect(rt.bodyRows[0].cells[1].answerKey).toBe('a');
  });

  it('template: zero answers -> one empty but clickable row', () => {
    const table: TableDef = {
      kind: 'template',
      caption: null,
      rowHeaderWidth: 1,
      columnHeader: [[{ label: '' }, { label: 'Form' }]],
      columns: [{ cell: { field: 'form' } }],
      multiAnswer: 'rows',
      rows: [{ labels: ['once'], questionId: 10 }],
    };
    const [rt] = svc.buildRenderModel(wrap(table), new Map());
    expect(rt.bodyRows.length).toBe(1);
    const dataCell = rt.bodyRows[0].cells[1];
    expect(dataCell.text).toBe('');
    expect(dataCell.questionId).toBe(10);
  });

  it('label run-merge: adjacent groups sharing labels[0] but not [1]', () => {
    const table: TableDef = {
      kind: 'template',
      caption: null,
      rowHeaderWidth: 3,
      columnHeader: [[{ label: '', colspan: 3 }, { label: 'F' }]],
      columns: [{ cell: { field: 'form' } }],
      multiAnswer: 'rows',
      rows: [
        { labels: ['Local', 'Incorporative', 'in'], questionId: 1 },
        { labels: ['Local', 'Incorporative', 'out'], questionId: 2 },
        { labels: ['Local', 'Non-incorporative', 'at'], questionId: 3 },
      ],
    };
    const answers = new Map<number, any[]>([
      [1, [{ form: 'x' }]],
      [2, [{ form: 'y' }]],
      [3, [{ form: 'z' }]],
    ]);
    const [rt] = svc.buildRenderModel(wrap(table), answers);
    // row 0: Local(rowspan 3), Incorporative(rowspan 2), leaf "in" colspan 1
    const r0 = rt.bodyRows[0].cells;
    expect(r0[0].text).toBe('Local');
    expect(r0[0].rowspan).toBe(3);
    expect(r0[1].text).toBe('Incorporative');
    expect(r0[1].rowspan).toBe(2);
    expect(r0[2].text).toBe('in');
    expect(r0[2].colspan).toBe(1);
    // row 1: only the leaf "out" is visible (Local + Incorporative hidden)
    expect(rt.bodyRows[1].cells.filter((c) => !c.hidden && c.kind === 'rowHeader').map((c) => c.text)).toEqual(['out']);
    // row 2: Non-incorporative starts fresh
    expect(rt.bodyRows[2].cells.filter((c) => !c.hidden && c.kind === 'rowHeader').map((c) => c.text)).toEqual(['Non-incorporative', 'at']);
  });

  it('leaf label colspan = rowHeaderWidth - depth', () => {
    const table: TableDef = {
      kind: 'template',
      caption: null,
      rowHeaderWidth: 4,
      columnHeader: [[{ label: '', colspan: 4 }, { label: 'F' }]],
      columns: [{ cell: { field: 'form' } }],
      multiAnswer: 'rows',
      rows: [{ labels: ['Possession', 'Possessive construction'], questionId: 1 }],
    };
    const [rt] = svc.buildRenderModel(wrap(table), new Map([[1, [{ form: 'x' }]]]));
    const cells = rt.bodyRows[0].cells.filter((c) => c.kind === 'rowHeader');
    expect(cells[0].colspan).toBe(1); // Possession
    expect(cells[1].colspan).toBe(3); // leaf: 4 - 1
  });

  it('grid: each cell binds its own question', () => {
    const table: TableDef = {
      kind: 'grid',
      caption: null,
      rowHeaderWidth: 1,
      columnHeader: [[{ label: 'Meaning' }, { label: 'Stative' }, { label: 'Directive' }]],
      columns: [{ cell: null }, { cell: null }],
      rows: [
        {
          labels: ['inside'],
          cells: [
            { field: 'form', questionId: 100 },
            { field: 'form', questionId: 101 },
          ],
        },
      ],
    };
    const answers = new Map<number, any[]>([
      [100, [{ _key: 'k100', form: 'andre' }]],
      [101, [{ _key: 'k101', form: 'andro' }]],
    ]);
    const [rt] = svc.buildRenderModel(wrap(table), answers);
    const data = rt.bodyRows[0].cells.filter((c) => c.kind === 'data');
    expect(data.map((c) => c.text)).toEqual(['andre', 'andro']);
    expect(data.map((c) => c.questionId)).toEqual([100, 101]);
    expect(data[0].answerKey).toBe('k100');
  });

  it('grid ragged labels: repeated label merges into a rowspan', () => {
    const table: TableDef = {
      kind: 'grid',
      caption: null,
      rowHeaderWidth: 2,
      columnHeader: [[{ label: '', colspan: 2 }, { label: 'Nom' }]],
      columns: [{ cell: null }],
      rows: [
        { labels: ['Singular', 'Masc.'], cells: [{ field: 'form', questionId: 1 }] },
        { labels: ['Singular', 'Fem.'], cells: [{ field: 'form', questionId: 2 }] },
        { labels: ['Plural', ''], cells: [{ field: 'form', questionId: 3 }] },
      ],
    };
    const [rt] = svc.buildRenderModel(
      wrap(table),
      new Map([
        [1, [{ form: 'a' }]],
        [2, [{ form: 'b' }]],
        [3, [{ form: 'c' }]],
      ]),
    );
    expect(rt.bodyRows[0].cells[0].text).toBe('Singular');
    expect(rt.bodyRows[0].cells[0].rowspan).toBe(2);
    expect(rt.bodyRows[1].cells[0].hidden).toBeTrue(); // Singular covered
    expect(rt.bodyRows[2].cells[0].text).toBe('Plural');
  });

  it('edit mode adds an addAnswer row after a non-empty template group', () => {
    const table: TableDef = {
      kind: 'template',
      caption: null,
      rowHeaderWidth: 1,
      columnHeader: [[{ label: '' }, { label: 'F' }]],
      columns: [{ cell: { field: 'form' } }],
      multiAnswer: 'rows',
      rows: [{ labels: ['x'], questionId: 1 }],
    };
    const answers = new Map<number, any[]>([[1, [{ form: 'a' }]]]);
    const withEdit = svc.buildRenderModel(wrap(table), answers, { editMode: true, canEdit: true });
    const kinds = withEdit[0].bodyRows.map((r) => r.cells.some((c) => c.kind === 'addAnswer'));
    expect(kinds).toEqual([false, true]);
    const withoutEdit = svc.buildRenderModel(wrap(table), answers);
    expect(withoutEdit[0].bodyRows.length).toBe(1);
  });

  // --- regression fixtures from real live views, pinning the legacy
  // "[object Object]" / "four one-line tables" bugs fixed by this renderer
  // (see project_tables_view_spec_refactor.md) ------------------------------

  it('regression: nested/array tableField columns resolve to text, not [object Object]', () => {
    // browse-indefinites-etymology-manner.php, section "Specific", question 1431
    const spec: TableSpec = {
      schemaVersion: 1,
      title: 'Indefinites - Etymology - Referent: Manner',
      sections: [{
        heading: 'Specific',
        tables: [{
          kind: 'template', caption: null, rowHeaderWidth: 0,
          columnHeader: [[
            { label: 'Form' }, { label: 'Form source' }, { label: 'Form Inherit.' },
            { label: 'Base' }, { label: 'Base source' }, { label: 'Base inherit.' },
            { label: 'Marker' }, { label: 'Marker source' }, { label: 'Marker inherit.' },
          ]],
          columns: [
            { cell: { field: 'form', layout: 'inline' } },
            { cell: { field: 'origin.source|origin.language', layout: 'inline' } },
            { cell: { field: 'inheritance', layout: 'inline' } },
            { cell: { field: 'base', layout: 'inline' } },
            { cell: { field: 'base_origin.source|base_origin.language', layout: 'inline' } },
            { cell: { field: 'base_inheritance', layout: 'inline' } },
            { cell: { field: 'markers.marker', layout: 'stack' } },
            { cell: { field: 'markers.origin.source|markers.origin.language', layout: 'stack' } },
            { cell: { field: 'markers.inheritance', layout: 'stack' } },
          ],
          multiAnswer: 'rows',
          rows: [{ labels: [], questionId: 1431 }],
        }],
      }],
    };
    // real answer doc, sample BG-001
    const answer = {
      _key: '298006564', base: 'tǝ ovel', base_inheritance: 'avel',
      base_origin: { language: null, source: 'Inherited' },
      form: 'sar tǝ ovel', inheritance: 'avel',
      markers: [{ inheritance: 'sar', marker: 'sar', origin: { language: null, source: 'Inherited' } }],
      origin: { language: null, source: 'Inherited' },
      question_id: 1431, sample: 'BG-001',
    };
    const [rt] = svc.buildRenderModel(spec, new Map([[1431, [answer]]]));
    const text = rt.bodyRows[0].cells.map((c) => c.text);
    expect(text).toEqual([
      'sar tǝ ovel',  // form
      'Inherited',    // origin.source|origin.language (language is null, dropped)
      'avel',         // inheritance
      'tǝ ovel',      // base
      'Inherited',    // base_origin.source|base_origin.language
      'avel',         // base_inheritance
      'sar',          // markers.marker (stacked array of 1)
      'Inherited',    // markers.origin.source|markers.origin.language
      'sar',          // markers.inheritance
    ]);
    expect(text.some((t) => t.includes('[object Object]'))).toBeFalse();
  });

  it('regression: a flat grid stays ONE table, not four one-row tables', () => {
    // browse-indefinites-markers.php: 6 rows (Determiner..Manner) x 4 columns
    // (Specific/Negative/Free choice/Universal), each cell its own question.
    const spec: TableSpec = {
      schemaVersion: 1,
      title: 'Indefinites - Markers',
      sections: [{
        heading: null,
        tables: [{
          kind: 'grid', caption: null, rowHeaderWidth: 1,
          columnHeader: [[
            { label: '' }, { label: 'Specific' }, { label: 'Negative' },
            { label: 'Free choice' }, { label: 'Universal' },
          ]],
          columns: [{ cell: null }, { cell: null }, { cell: null }, { cell: null }],
          rows: [
            { labels: ['Determiner'], cells: [
              { field: 'marker', questionId: 1377 }, { field: 'marker', questionId: 1376 },
              { field: 'marker', questionId: 1375 }, { field: 'marker', questionId: 1378 },
            ] },
            { labels: ['Person'], cells: [
              { field: 'marker', questionId: 1382 }, { field: 'marker', questionId: 1381 },
              { field: 'marker', questionId: 1380 }, { field: 'marker', questionId: 1383 },
            ] },
          ],
        }],
      }],
    };
    const answers = new Map<number, any[]>([
      [1377, [{ marker: 'ci' }]], [1376, [{ marker: 'na' }]],
      [1375, [{ marker: 'kaj' }]], [1378, [{ marker: 'sa' }]],
      [1382, [{ marker: 'ko' }]], [1381, [{ marker: 'niko' }]],
      [1380, [{ marker: 'vareko' }]], [1383, [{ marker: 'saviko' }]],
    ]);
    const renderTables = svc.buildRenderModel(spec, answers);
    expect(renderTables.length).toBe(1); // one table, not four
    expect(renderTables[0].bodyRows.length).toBe(2); // Determiner, Person
    expect(renderTables[0].bodyRows[0].cells.filter((c) => c.kind === 'data').map((c) => c.text))
      .toEqual(['ci', 'na', 'kaj', 'sa']);
  });
});
