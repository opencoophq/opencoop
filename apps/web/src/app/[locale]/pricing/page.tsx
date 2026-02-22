import { PricingPage } from './pricing-page';

export const dynamic = 'force-dynamic';

export default function Page() {
  const isWaitlistMode = process.env.LAUNCH_MODE === 'waitlist';
  return <PricingPage isWaitlistMode={isWaitlistMode} />;
}
