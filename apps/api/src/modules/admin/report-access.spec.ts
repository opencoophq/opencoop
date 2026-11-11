import { DEFAULT_ROLES } from '@opencoop/shared';
import { canExportReport, canReadCoopAudit, requiredPermissionForReport } from './report-access';

describe('report and audit access', () => {
  const gdpr = DEFAULT_ROLES['GDPR Viewer'];
  const viewer = DEFAULT_ROLES.Viewer;
  const admin = DEFAULT_ROLES.Admin;

  it('requires the register permission only for the shareholder register export', () => {
    expect(requiredPermissionForReport('shareholder-register')).toBe('canViewShareholderRegister');
    expect(requiredPermissionForReport('capital-statement')).toBe('canViewReports');
  });

  it('lets a GDPR Viewer export ordinary reports and not the register', () => {
    expect(canExportReport('COOP_ADMIN', gdpr, 'capital-statement')).toBe(true);
    expect(canExportReport('COOP_ADMIN', gdpr, 'shareholder-register')).toBe(false);
  });

  it('lets a Viewer export the register', () => {
    expect(canExportReport('COOP_ADMIN', viewer, 'shareholder-register')).toBe(true);
  });

  it('lets a system admin export without coop permissions', () => {
    expect(canExportReport('SYSTEM_ADMIN', undefined, 'shareholder-register')).toBe(true);
  });

  it('hides coop audit logs from a GDPR Viewer and shows them to people who see PII or manage members', () => {
    expect(canReadCoopAudit('COOP_ADMIN', gdpr)).toBe(false);
    expect(canReadCoopAudit('COOP_ADMIN', viewer)).toBe(true);
    expect(canReadCoopAudit('COOP_ADMIN', admin)).toBe(true);
    expect(canReadCoopAudit('COOP_ADMIN', { canManageShareholders: true, canViewPII: false })).toBe(
      true,
    );
    expect(canReadCoopAudit('COOP_ADMIN', undefined)).toBe(false);
    expect(canReadCoopAudit('SYSTEM_ADMIN', undefined)).toBe(true);
  });
});
