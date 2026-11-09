jest.mock('@react-pdf/renderer', () => ({ renderToBuffer: jest.fn() }));
jest.mock('@opencoop/pdf-templates', () => ({}));

import { ReportsService } from './reports.service';

describe('ReportsService.exportReport capital-statement', () => {
  afterEach(() => jest.useRealTimers());

  function build() {
    const service = new ReportsService({} as any);
    const spy = jest
      .spyOn(service, 'getCapitalStatement')
      .mockResolvedValue({ movements: [] } as any);
    return { service, spy };
  }

  it('defaults a missing range to this year so no Invalid Date reaches SQL', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-09T10:00:00Z'));
    const { service, spy } = build();

    await service.exportReport('coop-1', 'capital-statement', {});

    expect(spy).toHaveBeenCalledWith('coop-1', '2026-01-01', '2026-11-09');
  });

  it('keeps an explicit range', async () => {
    const { service, spy } = build();

    await service.exportReport('coop-1', 'capital-statement', {
      from: '2025-02-01',
      to: '2025-03-01',
    });

    expect(spy).toHaveBeenCalledWith('coop-1', '2025-02-01', '2025-03-01');
  });
});
