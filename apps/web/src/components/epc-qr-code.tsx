'use client';

import { QRCodeSVG } from 'qrcode.react';
import { generateEpcQrPayload, formatIban } from '@opencoop/shared';

interface EpcQrCodeProps {
  bic: string;
  beneficiaryName: string;
  iban: string;
  amount: number;
  reference?: string;
  unstructured?: string;
  size?: number;
}

export function EpcQrCode({
  bic,
  beneficiaryName,
  iban,
  amount,
  reference,
  unstructured,
  size = 200,
}: EpcQrCodeProps) {
  if (!bic || !iban || !beneficiaryName || !amount) {
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
      <p className="text-xs text-muted-foreground text-center max-w-[200px]">
        {formatIban(iban)}
      </p>
    </div>
  );
}
