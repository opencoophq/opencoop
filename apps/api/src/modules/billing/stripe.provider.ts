import { Provider } from '@nestjs/common';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const StripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    return new Stripe(key);
  },
};
