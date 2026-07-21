import { Test } from '@nestjs/testing';
import { AudienceSyncProcessor } from './audience-sync.processor';
import { AudienceSyncService } from './audience-sync.service';

describe('AudienceSyncProcessor', () => {
  let processor: AudienceSyncProcessor;
  let service: { reconcileOne: jest.Mock; reconcileAll: jest.Mock };

  beforeEach(async () => {
    service = {
      reconcileOne: jest.fn().mockResolvedValue({}),
      reconcileAll: jest.fn().mockResolvedValue({}),
    };
    const mod = await Test.createTestingModule({
      providers: [AudienceSyncProcessor, { provide: AudienceSyncService, useValue: service }],
    }).compile();
    processor = mod.get(AudienceSyncProcessor);
  });

  it('reconcile-one delegates to the service', async () => {
    await processor.handleReconcileOne({
      data: { coopId: 'c1', shareholderId: 's1' },
    } as any);
    expect(service.reconcileOne).toHaveBeenCalledWith('c1', 's1');
  });

  it('reconcile-all delegates with trigger', async () => {
    await processor.handleReconcileAll({
      data: { coopId: 'c1', trigger: 'cron' },
    } as any);
    expect(service.reconcileAll).toHaveBeenCalledWith('c1', 'cron');
  });
});
