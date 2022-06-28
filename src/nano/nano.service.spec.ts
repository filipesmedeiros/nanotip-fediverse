import { Test, TestingModule } from '@nestjs/testing';
import { NanoService } from './nano.service';

describe('NanoService', () => {
  let service: NanoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NanoService],
    }).compile();

    service = module.get<NanoService>(NanoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
