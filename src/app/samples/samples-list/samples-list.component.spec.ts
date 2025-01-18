import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SamplesListComponent } from './samples-list.component';

describe('SamplesListComponent', () => {
  let component: SamplesListComponent;
  let fixture: ComponentFixture<SamplesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SamplesListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SamplesListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
