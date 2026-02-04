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
  iat?: number;
  exp?: number;
}

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
// Share Types
// ============================================================================

export type ShareStatus = 'PENDING' | 'ACTIVE' | 'SOLD' | 'TRANSFERRED';

export interface ShareDto {
  id: string;
  coopId: string;
  shareholderId: string;
  shareClassId: string;
  projectId?: string;
  quantity: number;
  purchasePricePerShare: number;
  purchaseDate: string;
  status: ShareStatus;
  certificateNumber?: string;
  shareClass?: ShareClassDto;
  project?: ProjectDto;
}

export interface PurchaseSharesRequest {
  shareClassId: string;
  projectId?: string;
  quantity: number;
}

// ============================================================================
// Transaction Types
// ============================================================================

export type TransactionType = 'PURCHASE' | 'SALE' | 'TRANSFER_IN' | 'TRANSFER_OUT';
export type TransactionStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface TransactionDto {
  id: string;
  coopId: string;
  type: TransactionType;
  status: TransactionStatus;
  shareholderId: string;
  shareId?: string;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  fromShareholderId?: string;
  toShareholderId?: string;
  processedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  shareholder?: ShareholderDto;
  share?: ShareDto;
  payment?: PaymentDto;
}

export interface CreateTransferRequest {
  fromShareholderId: string;
  toShareholderId: string;
  shareId: string;
  quantity: number;
}

// ============================================================================
// Payment Types
// ============================================================================

export type PaymentMethod = 'BANK_TRANSFER' | 'MOLLIE' | 'STRIPE';
export type PaymentStatus = 'PENDING' | 'MATCHED' | 'CONFIRMED' | 'FAILED';

export interface PaymentDto {
  id: string;
  coopId: string;
  transactionId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  ogmCode?: string;
  externalReference?: string;
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
  matchedPaymentId?: string;
}

export interface MatchBankTransactionRequest {
  paymentId: string;
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
  paymentMethod: PaymentMethod;
  createAccount?: boolean;
  accountEmail?: string;
  accountPassword?: string;
}

export interface ShareRegistrationResponse {
  transactionId: string;
  paymentId: string;
  status: TransactionStatus;
  bankTransferDetails?: BankTransferDetails;
  paymentRedirectUrl?: string;
}

// ============================================================================
// Document Types
// ============================================================================

export type DocumentType =
  | 'SHARE_CERTIFICATE'
  | 'PURCHASE_STATEMENT'
  | 'DIVIDEND_STATEMENT'
  | 'TRANSACTION_REPORT';

export interface DocumentDto {
  id: string;
  shareholderId: string;
  type: DocumentType;
  filePath: string;
  generatedAt: string;
}
