jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));
jest.mock('./reports.service', () => ({
  ReportsService: class ReportsServiceMock {},
}));

import { AdminController } from './admin.controller';

describe('AdminController bank transaction stats', () => {
  it('counts only strictly unmatched bank transactions', async () => {
    const bankTransactionCount = jest.fn().mockResolvedValue(1);
    const controller = Object.create(AdminController.prototype) as any;
    controller.prisma = {
      shareholder: { count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(8) },
      registration: { count: jest.fn().mockResolvedValue(2) },
      bankTransaction: { count: bankTransactionCount },
      $queryRaw: jest.fn().mockResolvedValue([{ total: '0' }]),
    };

    const result = await controller.getStats('coop-1');

    expect(result.unmatchedBankTransactions).toBe(1);
    expect(bankTransactionCount).toHaveBeenCalledWith({
      where: { coopId: 'coop-1', matchStatus: 'UNMATCHED' },
    });
  });
});

describe('AdminController CSV imports without a file', () => {
  const controller = Object.create(AdminController.prototype) as any;

  it('rejects importProjects with a 400', async () => {
    await expect(controller.importProjects('coop-1', undefined)).rejects.toThrow(
      'File is required',
    );
  });

  it('rejects importShareClasses with a 400', async () => {
    await expect(controller.importShareClasses('coop-1', undefined)).rejects.toThrow(
      'File is required',
    );
  });

  it('rejects importBankTransactions with a 400', async () => {
    await expect(
      controller.importBankTransactions('coop-1', { id: 'user-1' }, undefined),
    ).rejects.toThrow('File is required');
  });
});
