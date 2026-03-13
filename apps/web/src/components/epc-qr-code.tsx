'use client';

import { QRCodeSVG } from 'qrcode.react';
import { generateEpcQrPayload, formatIban } from '@opencoop/shared';

interface EpcQrCodeProps {
  bic?: string;
  beneficiaryName: string;
  iban: string;
  amount: number;
  reference?: string;
  unstructured?: string;
  label?: string;
  size?: number;
}

export function EpcQrCode({
  bic,
  beneficiaryName,
  iban,
  amount,
  reference,
  unstructured,
  label,
  size = 200,
}: EpcQrCodeProps) {
  if (!iban || !beneficiaryName || !amount) {
    return null;
  }

  const payload = generateEpcQrPayload({
    bic,
    beneficiaryName,
    iban,
    amount,
    reference,
    unstructured,
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <QRCodeSVG value={payload} size={size} level="M" />
      {label && (
        <p className="text-xs font-medium text-center max-w-[200px]">{label}</p>
      )}
      <p className="text-xs text-muted-foreground text-center max-w-[200px]">
        {formatIban(iban)}
      </p>
    </div>
  );
}
