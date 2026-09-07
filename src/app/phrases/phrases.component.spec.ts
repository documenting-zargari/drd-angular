import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { PhrasesComponent } from './phrases.component';

describe('PhrasesComponent', () => {
  let component: PhrasesComponent;
  let fixture: ComponentFixture<PhrasesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhrasesComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(PhrasesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
