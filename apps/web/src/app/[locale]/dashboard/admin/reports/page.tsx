'use client';

import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnnualOverviewPreview } from '@/components/reports/annual-overview-preview';
import { CapitalStatementPreview } from '@/components/reports/capital-statement-preview';
import { ShareholderRegisterPreview } from '@/components/reports/shareholder-register-preview';
import { DividendSummaryPreview } from '@/components/reports/dividend-summary-preview';
import { ProjectInvestmentPreview } from '@/components/reports/project-investment-preview';

export default function ReportsPage() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();

  if (!selectedCoop) {
    return <p className="text-muted-foreground">{t('selectCoop')}</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>

      <Tabs defaultValue="annual-overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="annual-overview">{t('tabs.annualOverview')}</TabsTrigger>
          <TabsTrigger value="capital-statement">{t('tabs.capitalStatement')}</TabsTrigger>
          <TabsTrigger value="shareholder-register">{t('tabs.shareholderRegister')}</TabsTrigger>
          <TabsTrigger value="dividend-summary">{t('tabs.dividendSummary')}</TabsTrigger>
          <TabsTrigger value="project-investment">{t('tabs.projectInvestment')}</TabsTrigger>
        </TabsList>

        <TabsContent value="annual-overview" className="mt-6">
          <AnnualOverviewPreview />
        </TabsContent>

        <TabsContent value="capital-statement" className="mt-6">
          <CapitalStatementPreview />
        </TabsContent>

        <TabsContent value="shareholder-register" className="mt-6">
          <ShareholderRegisterPreview />
        </TabsContent>

        <TabsContent value="dividend-summary" className="mt-6">
          <DividendSummaryPreview />
        </TabsContent>

        <TabsContent value="project-investment" className="mt-6">
          <ProjectInvestmentPreview />
        </TabsContent>
      </Tabs>
    </div>
  );
}
