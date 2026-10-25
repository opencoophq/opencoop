import { apiFetch } from './api';

/** Download a gift-certificate PDF with the session token from apiFetch. */
export async function downloadGiftCertificate(
  shareholderId: string,
  registrationId: string,
  giftCode: string,
): Promise<void> {
  const response = await apiFetch(
    `/shareholders/${shareholderId}/gift-certificate/${registrationId}`,
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gift-certificate-${giftCode}.pdf`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
