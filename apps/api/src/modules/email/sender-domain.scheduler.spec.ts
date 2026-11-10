import { Test } from '@nestjs/testing';
import { SenderDomainScheduler } from './sender-domain.scheduler';
import { SenderDomainService } from './sender-domain.service';

describe('SenderDomainScheduler', () => {
  it('rechecks stored sender domains on the nightly tick', async () => {
    const senderDomains = { recheckAll: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [SenderDomainScheduler, { provide: SenderDomainService, useValue: senderDomains }],
    }).compile();

    await module.get(SenderDomainScheduler).nightlyTick();

    expect(senderDomains.recheckAll).toHaveBeenCalledTimes(1);
  });
});
