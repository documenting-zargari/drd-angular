import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../../testing/test-providers';

import { SamplesPageComponent } from './samples-page.component';

describe('SamplesPageComponent', () => {
  let component: SamplesPageComponent;
  let fixture: ComponentFixture<SamplesPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SamplesPageComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SamplesPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
