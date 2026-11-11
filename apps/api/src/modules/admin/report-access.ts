import { CoopPermissionKey, CoopPermissions } from '@opencoop/shared';
import { isPermitted } from '../../common/utils/coop-permissions';

/** The register CSV/PDF used to share the reports gate, so a GDPR Viewer could export it. */
export function requiredPermissionForReport(type: string): CoopPermissionKey {
  return type === 'shareholder-register' ? 'canViewShareholderRegister' : 'canViewReports';
}

export function canExportReport(
  role: string,
  permissions: Partial<CoopPermissions> | undefined,
  type: string,
): boolean {
  if (role === 'SYSTEM_ADMIN') return true;
  if (!permissions) return false;
  return isPermitted(permissions, requiredPermissionForReport(type));
}

/**
 * Audit rows include names, emails and bank details. A GDPR Viewer has
 * reports access and no PII access, so reports alone are not enough.
 * Shareholder managers still need the history tab on the member page.
 */
export function canReadCoopAudit(
  role: string,
  permissions: Partial<CoopPermissions> | undefined,
): boolean {
  if (role === 'SYSTEM_ADMIN') return true;
  if (!permissions) return false;
  return (
    isPermitted(permissions, 'canViewPII') || isPermitted(permissions, 'canManageShareholders')
  );
}
