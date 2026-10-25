import { apiFetch } from './api';
import { downloadGiftCertificate } from './gift-certificate';

jest.mock('./api', () => ({
  apiFetch: jest.fn(),
}));

describe('downloadGiftCertificate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('downloads through the authenticated API client', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
    });
    let downloadName = '';
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:gift'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });

    await downloadGiftCertificate('sh-1', 'reg-9', 'GIFT1');

    expect(apiFetch).toHaveBeenCalledWith('/shareholders/sh-1/gift-certificate/reg-9');
    expect(click).toHaveBeenCalled();
    expect(downloadName).toBe('gift-certificate-GIFT1.pdf');
    expect(document.querySelector('a')).toBeNull();
  });
});
