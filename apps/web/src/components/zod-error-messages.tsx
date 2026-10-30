'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { createZodErrorMap, type ValidationTranslator } from '@/lib/zod-error-map';

/**
 * Points zod's global error map at the active locale, so every form validated with
 * zodResolver shows translated, plain-language messages instead of zod's English defaults.
 */
export function ZodErrorMessages() {
  const t = useTranslations('validation');

  useEffect(() => {
    z.config({ customError: createZodErrorMap(t as unknown as ValidationTranslator) });
  }, [t]);

  return null;
}
