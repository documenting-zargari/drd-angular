/**
 * Golden render-parity proof: for every live view in the real-data corpus
 * (see `roma-server/data/management/commands/dump_table_parity_fixtures.py`),
 * assert the new spec pipeline (`TableSpecRendererService`) renders the same
 * visible table text as the legacy `content`-parsing pipeline
 * (`parseTableContent` / `processAnswers` / `updateTableWithAnswers`), given
 * the same real answer data.
 *
 * This is the proof required before the legacy pipeline and the `content`
 * field can be deleted (see the Tables view-spec refactor plan). It is a
 * one-time migration gate, not a permanent regression suite — safe to delete
 * once the legacy pipeline itself is deleted.
 *
 * Both pipelines are driven directly off a bare `TablesComponent` instance:
 * the new pipeline via `TableSpecRendererService.buildRenderModel` (pure, no
 * DOM), the legacy one via the component's own `parseTableContent` /
 * `processAnswers` / `updateTableWithAnswers` (needs a real DOM, hence
 * Karma/ChromeHeadless). Visible output is compared via the rendered DOM
 * text of the `<table>` elements the template produces for each pipeline —
 * toggling `component.spec` between the real spec and `null` switches which
 * of the two mutually-exclusive template blocks renders, with no edit/
 * master-edit/search mode involved (so no permission-gated UI - e.g. the
 * "+ Add another answer" row - leaks into either rendering).
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { TablesComponent } from './tables.component';
import { TableSpecRendererService } from './table-spec-renderer.service';
import fixturesData from './testing/parity-fixtures.generated.json';

interface ParityFixture {
  slug: string;
  content: string;
  spec: any;
  sampleRef: string;
  coverage: string;
  answersByQuestion: Record<string, any[]>;
}

const fixtures: ParityFixture[] = (fixturesData as any).fixtures;

function normalizeText(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function extractTableTexts(fixture: ComponentFixture<TablesComponent>): string[] {
  const tables: HTMLTableElement[] = Array.from(
    fixture.nativeElement.querySelectorAll('table'),
  );
  return tables.map((t) => normalizeText(t.textContent));
}

describe('Tables render parity: legacy content vs spec pipeline (golden corpus)', () => {
  fixtures.forEach((fx) => {
    it(`renders identically for "${fx.slug}" (sample ${fx.sampleRef}, coverage ${fx.coverage})`, async () => {
      await TestBed.configureTestingModule({
        imports: [TablesComponent],
        providers: [...commonTestProviders()],
      }).compileComponents();

      const fixture = TestBed.createComponent(TablesComponent);
      const component = fixture.componentInstance;
      component.selectedSample = { sample_ref: fx.sampleRef };

      // --- new pipeline ---
      const answersByQuestion = new Map<number, any[]>();
      Object.entries(fx.answersByQuestion).forEach(([qid, answers]) => {
        answersByQuestion.set(Number(qid), answers);
      });
      component.spec = fx.spec;
      component.renderTables = new TableSpecRendererService().buildRenderModel(
        fx.spec,
        answersByQuestion,
      );
      fixture.detectChanges();
      const newTables = extractTableTexts(fixture);

      // --- legacy pipeline ---
      const allAnswers = Object.values(fx.answersByQuestion).flat();
      component.parseTableContent(fx.content);
      component.processAnswers(allAnswers);
      component.updateTableWithAnswers();
      component.spec = null;
      fixture.detectChanges();
      const legacyTables = extractTableTexts(fixture);

      expect(newTables.length)
        .withContext(`table count for "${fx.slug}"`)
        .toBe(legacyTables.length);
      newTables.forEach((text, i) => {
        expect(text).withContext(`table[${i}] for "${fx.slug}"`).toBe(legacyTables[i]);
      });
    });
  });
});
