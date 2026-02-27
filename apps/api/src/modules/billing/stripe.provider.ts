import { Provider, Logger } from '@nestjs/common';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const StripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      new Logger('StripeProvider').warn(
        'STRIPE_SECRET_KEY is not set — billing endpoints will not work',
      );
      return null;
    }
    return new Stripe(key);
  },
};
