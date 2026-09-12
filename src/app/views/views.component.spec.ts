import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { ViewsComponent } from './views.component';

describe('ViewsComponent', () => {
  let component: ViewsComponent;
  let fixture: ComponentFixture<ViewsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewsComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // formatValue just delegates to the shared formatFieldValue (see
  // shared/format-field-value.spec.ts for the full behaviour matrix) — this
  // pins the delegation itself, regression for the comparison view showing
  // literal "[object Object]" for origin/base_origin/markers-shaped fields.
  it('formatValue flattens a nested object instead of showing [object Object]', () => {
    expect(component.formatValue({ source: 'Inherited', language: null })).toBe('Inherited');
  });
});
