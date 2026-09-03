import { TestBed } from '@angular/core/testing';

import { DataService } from './data.service';
import { commonTestProviders } from '../testing/test-providers';

describe('DataService', () => {
  let service: DataService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...commonTestProviders()] });
    service = TestBed.inject(DataService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
