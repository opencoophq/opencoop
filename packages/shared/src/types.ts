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

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
// Auth Types
// ============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  preferredLanguage?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
  coopIds?: string[]; // coop IDs for admins
  coopPermissions?: Record<string, CoopPermissions>; // permissions per coopId
  iat?: number;
  exp?: number;
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
  canManageSettings: boolean;
  canManageAdmins: boolean;
  canViewPII: boolean;
  canViewReports: boolean;
  canViewShareholderRegister: boolean;
}

export const DEFAULT_ROLES: Record<string, CoopPermissions> = {
  Admin: {
    canManageShareholders: true,
    canManageTransactions: true,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageMessages: true,
    canManageSettings: true,
    canManageAdmins: true,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
  },
  Viewer: {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageMessages: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
  },
  'GDPR Viewer': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageMessages: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
  },
  'GDPR Admin': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageMessages: false,
    canManageSettings: true,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
  },
};

export type CoopPermissionKey = keyof CoopPermissions;

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'SYSTEM_ADMIN' | 'COOP_ADMIN' | 'SHAREHOLDER';

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  preferredLanguage: string;
  emailVerified: boolean;
  createdAt: string;
}

// ============================================================================
// Billing Types
// ============================================================================

export type CoopPlan = 'FREE' | 'ESSENTIALS' | 'PROFESSIONAL';
export type BillingPeriod = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID' | 'INCOMPLETE';

export interface SubscriptionDto {
  id: string;
  coopId: string;
  status: SubscriptionStatus;
  billingPeriod: BillingPeriod;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
}

export interface CoopBillingInfo {
  plan: CoopPlan;
  trialEndsAt?: string;
  isReadOnly: boolean;
  subscription?: SubscriptionDto;
}

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

export interface CoopDto {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  requiresApproval: boolean;
  ogmPrefix: string;
  bankName?: string;
  bankIban?: string;
  bankBic?: string;
  plan?: CoopPlan;
  trialEndsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCoopRequest {
  slug: string;
  name: string;
  ogmPrefix: string;
  requiresApproval?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface UpdateCoopRequest {
  name?: string;
  requiresApproval?: boolean;
  bankName?: string;
  bankIban?: string;
  bankBic?: string;
}

export interface UpdateCoopBrandingRequest {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

// ============================================================================
// Shareholder Types
// ============================================================================

export type ShareholderType = 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
export type ShareholderStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

export interface ShareholderDto {
  id: string;
  coopId: string;
  type: ShareholderType;
  status: ShareholderStatus;
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  birthDate?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  legalForm?: string;
  email: string;
  phone?: string;
  address?: Address;
  beneficialOwners?: BeneficialOwnerDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateShareholderRequest {
  type: ShareholderType;
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  birthDate?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  legalForm?: string;
  email: string;
  phone?: string;
  address?: Address;
  beneficialOwners?: CreateBeneficialOwnerRequest[];
}

export interface BeneficialOwnerDto {
  id: string;
  firstName: string;
  lastName: string;
  nationalId?: string;
  ownershipPercentage: number;
}

export interface CreateBeneficialOwnerRequest {
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

export interface CreateShareClassRequest {
  name: string;
  code: string;
  pricePerShare: number;
  minShares?: number;
  maxShares?: number;
  hasVotingRights?: boolean;
  dividendRateOverride?: number;
}

export interface UpdateShareClassRequest {
  name?: string;
  pricePerShare?: number;
  minShares?: number;
  maxShares?: number;
  hasVotingRights?: boolean;
  dividendRateOverride?: number;
  isActive?: boolean;
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

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  isActive?: boolean;
}

// ============================================================================
// Registration Types
// ============================================================================

export type RegistrationType = 'BUY' | 'SELL';
export type RegistrationStatus = 'PENDING' | 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface RegistrationDto {
  id: string;
  coopId: string;
  shareholderId: string;
  shareClassId: string;
  projectId?: string;
  type: RegistrationType;
  status: RegistrationStatus;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  registerDate: string;
  isSavings: boolean;
  ogmCode?: string;
  certificateNumber?: string;
  fromShareholderId?: string;
  toShareholderId?: string;
  processedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  shareholder?: ShareholderDto;
  shareClass?: ShareClassDto;
  project?: ProjectDto;
  payments?: PaymentDto[];
  // Derived fields (computed by API)
  totalPaid?: number;
  sharesOwned?: number;
  sharesRemaining?: number;
  fullyPaid?: boolean;
}

export interface CreateBuyRequest {
  shareClassId: string;
  projectId?: string;
  quantity: number;
  isSavings?: boolean;
}

export interface CreateSellRequest {
  registrationId: string;
  quantity: number;
}

export interface CreateTransferRequest {
  fromShareholderId: string;
  toShareholderId: string;
  registrationId: string;
  quantity: number;
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentDto {
  id: string;
  registrationId: string;
  coopId: string;
  amount: number;
  bankDate: string;
  bankTransactionId?: string;
  matchedByUserId?: string;
  matchedAt?: string;
  createdAt: string;
}

export interface BankTransferDetails {
  bankName: string;
  iban: string;
  bic: string;
  ogmCode: string;
  amount: number;
  beneficiary: string;
}

// ============================================================================
// Bank Import Types
// ============================================================================

export type BankTransactionMatchStatus = 'UNMATCHED' | 'AUTO_MATCHED' | 'MANUAL_MATCHED';

export interface BankImportDto {
  id: string;
  coopId: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
}

export interface BankTransactionDto {
  id: string;
  coopId: string;
  bankImportId: string;
  date: string;
  amount: number;
  counterparty?: string;
  ogmCode?: string;
  referenceText?: string;
  matchStatus: BankTransactionMatchStatus;
}

export interface MatchBankTransactionRequest {
  registrationId: string;
}

// ============================================================================
// Dividend Types
// ============================================================================

export type DividendPeriodStatus = 'DRAFT' | 'CALCULATED' | 'PAID';

export interface DividendPeriodDto {
  id: string;
  coopId: string;
  year: number;
  status: DividendPeriodStatus;
  dividendRate: number;
  withholdingTaxRate: number;
  exDividendDate: string;
  totalGrossAmount?: number;
  totalTaxAmount?: number;
  totalNetAmount?: number;
  payoutCount?: number;
}

export interface CreateDividendPeriodRequest {
  year: number;
  dividendRate: number;
  withholdingTaxRate?: number;
  exDividendDate: string;
}

export interface DividendPayoutDto {
  id: string;
  dividendPeriodId: string;
  shareholderId: string;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
  calculationDetails?: DividendCalculationDetail[];
  paidAt?: string;
  paymentReference?: string;
  shareholder?: ShareholderDto;
}

export interface DividendCalculationDetail {
  shareClassId: string;
  shareClassName: string;
  quantity: number;
  pricePerShare: number;
  totalValue: number;
  dividendRate: number;
  dividendAmount: number;
}

// ============================================================================
// Registration Flow Types
// ============================================================================

export type BeneficiaryType = 'self' | 'family' | 'company' | 'gift';

export interface ShareRegistrationRequest {
  beneficiaryType: BeneficiaryType;
  shareholder: CreateShareholderRequest;
  shareClassId: string;
  projectId?: string;
  quantity: number;
  isSavings?: boolean;
  createAccount?: boolean;
  accountEmail?: string;
  accountPassword?: string;
}

export interface ShareRegistrationResponse {
  registrationId: string;
  status: RegistrationStatus;
  ogmCode?: string;
  bankTransferDetails?: BankTransferDetails;
}

// ============================================================================
// Document Types
// ============================================================================

export type DocumentType =
  | 'SHARE_CERTIFICATE'
  | 'PURCHASE_STATEMENT'
  | 'DIVIDEND_STATEMENT'
  | 'TRANSACTION_REPORT'
  | 'CORRESPONDENCE';

export interface DocumentDto {
  id: string;
  shareholderId: string;
  type: DocumentType;
  filePath: string;
  generatedAt: string;
}

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

export interface VoteDto {
  id: string;
  resolutionId: string;
  shareholderId: string;
  choice: VoteChoice;
  castViaProxyId?: string | null;
  weight: number;
  castAt: string;
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

export interface ResolutionOutcome {
  resolutionId: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  passed: boolean;
  majorityType: MajorityType;
}
