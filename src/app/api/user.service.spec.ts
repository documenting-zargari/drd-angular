import { TestBed } from '@angular/core/testing';

import { UserService } from './user.service';
import { commonTestProviders } from '../testing/test-providers';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...commonTestProviders()] });
    service = TestBed.inject(UserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
