import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AboutComponent } from './about.component';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AboutComponent, RouterTestingModule]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with aims section', () => {
    expect(component.currentSection).toBe('aims');
  });

  it('should return correct section metadata', () => {
    expect(component.getCurrentSectionData().title).toBe('Aims');
    expect(component.getCurrentSectionData().icon).toBe('bi-target');
  });

  it('should have section data for all sections', () => {
    expect(component.sectionData['aims']).toBeDefined();
    expect(component.sectionData['structure']).toBeDefined();
    expect(component.sectionData['background']).toBeDefined();
  });
});