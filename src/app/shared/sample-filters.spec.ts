import {
  EMPTY_SAMPLE_FILTERS, SampleFilters, dialectGroupOptions, hasSampleFilters, sampleFiltersFromParams,
  sampleFiltersKey, sampleFiltersRequestParams, sampleFiltersToParams, sampleMatchesFilters,
  toggleSampleFilter, withSampleFilters,
} from './sample-filters';

const SAMPLES = [
  { sample_ref: 'AL-001', country_code: 'AL', dialect_group_name: 'Balkan', source_type: 'RMS Questionaire',
    migrant: 'No', contact_languages: [{ language: 'Albanian', level: 'Current-L2' }] },
  { sample_ref: 'PUB-001', country_code: 'YU', dialect_group_name: 'Balkan', source_type: 'Published Source', migrant: 'No' },
  { sample_ref: 'DE-010', country_code: 'DE', dialect_group_name: null, source_type: 'External Fieldwork', migrant: 'Yes' },
  // Some pages normalise migrant to a boolean in place (see SearchComponent.loadSamples).
  { sample_ref: 'FI-002', country_code: 'FIN', dialect_group_name: 'Northern', source_type: 'RMS Questionaire', migrant: true },
];

function refs(filters: Partial<SampleFilters>): string[] {
  const f = { ...EMPTY_SAMPLE_FILTERS, ...filters };
  return SAMPLES.filter(s => sampleMatchesFilters(s, f)).map(s => s.sample_ref);
}

describe('sample-filters', () => {
  it('round-trips through URL params', () => {
    const f: SampleFilters = { countries: ['AL', '__none__'], l2: ['any:Turkish'], groups: ['Balkan'], source: 'Published Source', migrant: 'exclude' };
    const params = sampleFiltersToParams(f);
    expect(sampleFiltersFromParams(k => params[k] ?? null)).toEqual(f);
  });

  it('writes nothing to the URL for empty filters', () => {
    expect(Object.values(sampleFiltersToParams(EMPTY_SAMPLE_FILTERS)).every(v => v === null)).toBeTrue();
    expect(hasSampleFilters(EMPTY_SAMPLE_FILTERS)).toBeFalse();
  });

  it('reads the legacy migrant=0 toggle as "exclude"; ignores the dropped "only" and unknown sources', () => {
    expect(sampleFiltersFromParams(k => (k === 'migrant' ? '0' : null)).migrant).toBe('exclude');
    expect(sampleFiltersFromParams(k => (k === 'migrant' ? 'only' : null)).migrant).toBe('all');
    expect(sampleFiltersFromParams(k => (k === 'source' ? 'Bogus' : null)).source).toBeNull();
  });

  it('sends only active filters, under the server param names', () => {
    expect(sampleFiltersRequestParams(EMPTY_SAMPLE_FILTERS)).toEqual({});
    expect(sampleFiltersRequestParams({ ...EMPTY_SAMPLE_FILTERS, groups: ['Balkan'], migrant: 'exclude' }))
      .toEqual({ dialect_groups: ['Balkan'], migrant: 'exclude' });
  });

  it('key ignores list order', () => {
    expect(sampleFiltersKey({ ...EMPTY_SAMPLE_FILTERS, groups: ['A', 'B'] }))
      .toBe(sampleFiltersKey({ ...EMPTY_SAMPLE_FILTERS, groups: ['B', 'A'] }));
  });

  it('matches samples like the server does', () => {
    expect(refs({ countries: ['FI'] })).toEqual(['FI-002']);               // legacy FIN resolves to FI
    expect(refs({ groups: ['__none__'] })).toEqual(['DE-010']);
    expect(refs({ source: 'Published Source' })).toEqual(['PUB-001']);
    expect(refs({ migrant: 'exclude' })).toEqual(['AL-001', 'PUB-001']);
    expect(refs({ l2: ['Current-L2:Albanian'] })).toEqual(['AL-001']);
    expect(refs({ groups: ['Balkan'], source: 'RMS Questionaire' })).toEqual(['AL-001']);
  });

  it('lists dialect groups with counts, "No group" last', () => {
    expect(dialectGroupOptions(SAMPLES)).toEqual([
      { value: 'Balkan', label: 'Balkan', count: 2 },
      { value: 'Northern', label: 'Northern', count: 1 },
      { value: '__none__', label: 'No group', count: 1 },
    ]);
  });

  it('toggles a value in and out of a list without mutating', () => {
    const on = toggleSampleFilter(EMPTY_SAMPLE_FILTERS, 'groups', 'Balkan');
    expect(on.groups).toEqual(['Balkan']);
    expect(EMPTY_SAMPLE_FILTERS.groups).toEqual([]);
    expect(toggleSampleFilter(on, 'groups', 'Balkan').groups).toEqual([]);
  });

  it('folds raw selectMany params into one filters object', () => {
    const vm = withSampleFilters({ page: 2, countries: 'al', l2: null, groups: 'Balkan', source: null, migrant: 'exclude' });
    expect(vm).toEqual({ page: 2, filters: { countries: ['AL'], l2: [], groups: ['Balkan'], source: null, migrant: 'exclude' } } as any);
  });
});
