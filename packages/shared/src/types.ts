// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// Address Type
// ============================================================================

export interface Address {
  street: string;
  number: string;
  box?: string;
  postalCode: string;
  city: string;
  country: string;
}

// ============================================================================
// Coop Permissions
// ============================================================================

export interface CoopPermissions {
  canManageShareholders: boolean;
  canManageTransactions: boolean;
  canManageShareClasses: boolean;
  canManageProjects: boolean;
  canManageDividends: boolean;
  canManageMessages: boolean;
  canManageMeetings: boolean;
  canManageSettings: boolean;
  canManageAdmins: boolean;
  canViewPII: boolean;
  canViewReports: boolean;
  canViewShareholderRegister: boolean;
  canViewVolunteers: boolean;
}

export const DEFAULT_ROLES: Record<string, CoopPermissions> = {
  Admin: {
    canManageShareholders: true,
    canManageTransactions: true,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageMessages: true,
    canManageMeetings: true,
    canManageSettings: true,
    canManageAdmins: true,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
    canViewVolunteers: false,
  },
  Viewer: {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageMessages: false,
    canManageMeetings: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
    canViewVolunteers: false,
  },
  'Meeting Admin': {
    // Run AGMs without seeing or changing financial / shareholder data.
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageMessages: false,
    canManageMeetings: true,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: true, // needs names/addresses for the attendance sheet
    canViewReports: false,
    canViewShareholderRegister: true, // needs the register to verify proxies
    canViewVolunteers: false,
  },
  'GDPR Viewer': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageMessages: false,
    canManageMeetings: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
    canViewVolunteers: false,
  },
  'GDPR Admin': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageMessages: false,
    canManageMeetings: false,
    canManageSettings: true,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
    canViewVolunteers: false,
  },
};

/** Bump when the volunteer consent copy in the four locales changes meaning. */
export const VOLUNTEER_CONSENT_TEXT_VERSION = 'volunteer-consent-v1';

/** Used when a coop has not configured its own interest tags. */
export const DEFAULT_VOLUNTEER_INTERESTS = [
  'flyers',
  'stands',
  'workshops',
  'technical',
  'admin',
] as const;

/**
 * Tags the signup form can translate. `board` is intentionally absent from
 * the defaults, so a coop only shows it after adding the tag itself.
 */
export const KNOWN_VOLUNTEER_INTERESTS = [...DEFAULT_VOLUNTEER_INTERESTS, 'board'] as const;

export type KnownVolunteerInterest = (typeof KNOWN_VOLUNTEER_INTERESTS)[number];

/** Labels for known tags. A coop-specific tag has no entry and is shown as itself. */
export const VOLUNTEER_INTEREST_LABELS: Record<
  KnownVolunteerInterest,
  { nl: string; fr: string; de: string; en: string }
> = {
  flyers: { nl: 'Flyers', fr: 'Flyers', de: 'Flyer', en: 'Flyers' },
  stands: {
    nl: 'Evenementen/standen',
    fr: 'Événements et stands',
    de: 'Veranstaltungen und Stände',
    en: 'Events and stands',
  },
  workshops: { nl: 'Workshops', fr: 'Ateliers', de: 'Workshops', en: 'Workshops' },
  technical: { nl: 'Technisch', fr: 'Technique', de: 'Technik', en: 'Technical' },
  admin: { nl: 'Administratie', fr: 'Administration', de: 'Verwaltung', en: 'Administration' },
  board: {
    nl: 'Bestuur',
    fr: "Conseil d'administration",
    de: 'Vorstand',
    en: 'Board of directors',
  },
};

export type CoopPermissionKey = keyof CoopPermissions;

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'SYSTEM_ADMIN' | 'COOP_ADMIN' | 'SHAREHOLDER';

// ============================================================================
// Billing Types
// ============================================================================

export type CoopPlan = 'FREE' | 'ESSENTIALS' | 'PROFESSIONAL';
export type BillingPeriod = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID' | 'INCOMPLETE';

// ============================================================================
// Coop Types
// ============================================================================

export interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  bankName?: string;
  bankIban?: string;
  bankBic?: string;
  shareClasses: ShareClassDto[];
  projects: ProjectDto[];
}

// ============================================================================
// Shareholder Types
// ============================================================================

export type ShareholderType = 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
export type ShareholderStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

export interface BeneficialOwnerDto {
  id: string;
  firstName: string;
  lastName: string;
  nationalId?: string;
  ownershipPercentage: number;
}

// ============================================================================
// Share Class Types
// ============================================================================

export interface ShareClassDto {
  id: string;
  coopId: string;
  name: string;
  code: string;
  pricePerShare: number;
  minShares: number;
  maxShares?: number;
  hasVotingRights: boolean;
  dividendRateOverride?: number;
  isActive: boolean;
}

// ============================================================================
// Project Types
// ============================================================================

export interface ProjectDto {
  id: string;
  coopId: string;
  name: string;
  description?: string;
  isActive: boolean;
}

// ============================================================================
// Registration Types
// ============================================================================

export type RegistrationType = 'BUY' | 'SELL';
export type RegistrationStatus = 'PENDING' | 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// ============================================================================
// Dividend Types
// ============================================================================

export type DividendPeriodStatus = 'DRAFT' | 'CALCULATED' | 'PAID';

// ============================================================================
// Document Types
// ============================================================================

export type DocumentType =
  | 'SHARE_CERTIFICATE'
  | 'PURCHASE_STATEMENT'
  | 'DIVIDEND_STATEMENT'
  | 'TRANSACTION_REPORT'
  | 'CORRESPONDENCE';

// ============================================================================
// AGM (Algemene Vergadering) Types
// ============================================================================

export type MeetingType = 'ANNUAL' | 'EXTRAORDINARY' | 'WRITTEN';
export type MeetingFormat = 'PHYSICAL' | 'HYBRID' | 'DIGITAL';
export type MeetingStatus = 'DRAFT' | 'CONVOKED' | 'HELD' | 'CLOSED' | 'CANCELLED';
export type VotingWeight = 'PER_SHAREHOLDER' | 'PER_SHARE';
export type AgendaType = 'INFORMATIONAL' | 'RESOLUTION' | 'ELECTION';
export type MajorityType = 'SIMPLE' | 'TWO_THIRDS' | 'THREE_QUARTERS';
export type VoteChoice = 'FOR' | 'AGAINST' | 'ABSTAIN';
export type RSVPStatus = 'ATTENDING' | 'PROXY' | 'ABSENT' | 'UNKNOWN';
export type CheckInMethod = 'ADMIN' | 'KIOSK' | 'PAPER_RECONCILED';

export interface MeetingDto {
  id: string;
  coopId: string;
  type: MeetingType;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  location?: string | null;
  format: MeetingFormat;
  votingWeight: VotingWeight;
  maxProxiesPerPerson: number;
  convocationSentAt?: string | null;
  status: MeetingStatus;
  reminderDaysBefore: number[];
  createdAt: string;
  updatedAt: string;
}

export interface AgendaItemDto {
  id: string;
  meetingId: string;
  order: number;
  title: string;
  description?: string | null;
  type: AgendaType;
  resolution?: ResolutionDto | null;
  attachments?: AgendaAttachmentDto[];
}

export interface AgendaAttachmentDto {
  id: string;
  agendaItemId: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
}

export interface ResolutionDto {
  id: string;
  agendaItemId: string;
  proposedText: string;
  majorityType: MajorityType;
  quorumRequired?: string | null;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  passed?: boolean | null;
  closedAt?: string | null;
}

export interface ProxyDto {
  id: string;
  meetingId: string;
  grantorShareholderId: string;
  delegateShareholderId: string;
  signedFormUrl?: string | null;
  grantedAt: string;
  revokedAt?: string | null;
}

export interface MeetingAttendanceDto {
  id: string;
  meetingId: string;
  shareholderId: string;
  rsvpStatus: RSVPStatus;
  rsvpAt?: string | null;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  checkInMethod?: CheckInMethod | null;
  signatureImageUrl?: string | null;
}

export interface MeetingMinutesDto {
  id: string;
  meetingId: string;
  content: string;
  generatedPdfUrl?: string | null;
  signedPdfUrl?: string | null;
  signedAt?: string | null;
  signedByName?: string | null;
}
