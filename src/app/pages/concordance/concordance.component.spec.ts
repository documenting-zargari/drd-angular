import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { ConcordanceComponent } from './concordance.component';

describe('ConcordanceComponent', () => {
  let component: ConcordanceComponent;
  let fixture: ComponentFixture<ConcordanceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConcordanceComponent, HttpClientTestingModule],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ConcordanceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
