import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../../testing/test-providers';

import { SampleSelectionComponent } from './sample-selection.component';

describe('SampleSelectionComponent', () => {
  let component: SampleSelectionComponent;
  let fixture: ComponentFixture<SampleSelectionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleSelectionComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SampleSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
