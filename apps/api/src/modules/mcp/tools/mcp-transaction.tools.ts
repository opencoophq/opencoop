import { Injectable } from '@nestjs/common';
import { RegistrationStatus, RegistrationType } from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { maskShareholderPII } from '../../../common/utils/mask-pii';
import { PaymentsService } from '../../payments/payments.service';
import { AddPaymentDto } from '../../registrations/dto/add-payment.dto';
import { CancelRegistrationDto } from '../../registrations/dto/cancel-registration.dto';
import { CompleteRegistrationDto } from '../../registrations/dto/complete-registration.dto';
import { CreateBuyDto } from '../../registrations/dto/create-buy.dto';
import { CreateSellDto } from '../../registrations/dto/create-sell.dto';
import { CreateTransferDto } from '../../registrations/dto/create-transfer.dto';
import { RejectRegistrationDto } from '../../registrations/dto/reject-registration.dto';
import { UpdatePaymentDateDto } from '../../registrations/dto/update-payment-date.dto';
import { RegistrationsService } from '../../registrations/registrations.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listRegistrationsParameters = z
  .object({
    status: z
      .nativeEnum(RegistrationStatus)
      .optional()
      .describe('Filter by status: PENDING, PENDING_PAYMENT, ACTIVE, COMPLETED, or CANCELLED'),
    type: z.nativeEnum(RegistrationType).optional().describe('Filter by type: BUY or SELL'),
    shareholderId: z.string().optional().describe('Filter by shareholder ID'),
    channelId: z.string().optional().describe('Filter by channel ID'),
    fromDate: isoDate.optional().describe('Start date filter (ISO 8601, e.g. 2025-01-01)'),
    toDate: isoDate.optional().describe('End date filter (ISO 8601, e.g. 2025-12-31)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Items per page (default 25, max 100)'),
  })
  .strict();

export const getRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
  })
  .strict();

export const approveRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
  })
  .strict();

export const rejectRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
    reason: z.string().describe('Reason for rejecting the registration'),
  })
  .strict();

export const cancelRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
    reason: z.string().optional().describe('Optional reason for cancelling the registration'),
  })
  .strict();

export const createTransferParameters = z
  .object({
    fromShareholderId: z.string().describe('Shareholder transferring the shares'),
    toShareholderId: z.string().describe('Shareholder receiving the shares'),
    registrationId: z.string().describe('Buy registration from which to transfer shares'),
    quantity: z.number().int().min(1).describe('Number of shares to transfer'),
  })
  .strict();

export const buySharesForShareholderParameters = z
  .object({
    shareholderId: z.string().describe('The shareholder ID'),
    shareClassId: z.string().describe('Share class to purchase'),
    quantity: z.number().int().min(1).describe('Number of shares to purchase'),
    projectId: z.string().optional().describe('Project to assign shares to'),
    isSavings: z.boolean().optional().describe('Whether this is a savings share'),
  })
  .strict();

export const sellSharesForShareholderParameters = z
  .object({
    shareholderId: z.string().describe('The shareholder ID'),
    registrationId: z.string().describe('Buy registration to sell shares from'),
    quantity: z.number().int().min(1).describe('Number of shares to sell'),
  })
  .strict();

export const getPaymentDetailsParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
  })
  .strict();

export const completeRegistrationParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
    bankDate: isoDate.optional().describe('Optional bank value date of the payment'),
  })
  .strict();

export const setPaymentDateParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
    bankDate: isoDate.describe('Bank value date of the payment'),
  })
  .strict();

export const addPaymentParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
    amount: z.number().positive().describe('Payment amount'),
    bankDate: isoDate.describe('Bank value date of the payment'),
  })
  .strict();

export const resendPaymentEmailParameters = z
  .object({
    registrationId: z.string().describe('The registration ID'),
  })
  .strict();

type ListRegistrationsParams = z.infer<typeof listRegistrationsParameters>;
type GetRegistrationParams = z.infer<typeof getRegistrationParameters>;
type ApproveRegistrationParams = z.infer<typeof approveRegistrationParameters>;
type RejectRegistrationParams = z.infer<typeof rejectRegistrationParameters>;
type CancelRegistrationParams = z.infer<typeof cancelRegistrationParameters>;
type CreateTransferParams = z.infer<typeof createTransferParameters>;
type BuySharesForShareholderParams = z.infer<typeof buySharesForShareholderParameters>;
type SellSharesForShareholderParams = z.infer<typeof sellSharesForShareholderParameters>;
type GetPaymentDetailsParams = z.infer<typeof getPaymentDetailsParameters>;
type CompleteRegistrationParams = z.infer<typeof completeRegistrationParameters>;
type SetPaymentDateParams = z.infer<typeof setPaymentDateParameters>;
type AddPaymentParams = z.infer<typeof addPaymentParameters>;
type ResendPaymentEmailParams = z.infer<typeof resendPaymentEmailParameters>;

@Injectable()
export class McpTransactionTools {
  constructor(
    private readonly registrationsService: RegistrationsService,
    private readonly paymentsService: PaymentsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/registrations
  @Tool({
    name: 'list_registrations',
    description:
      'List share registrations (buy/sell transactions) with optional filtering by status, type, shareholder, channel, and date range. Supports pagination.',
    parameters: listRegistrationsParameters,
  })
  async listRegistrations(params: ListRegistrationsParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) =>
      this.registrationsService.findAll(ctx.coopId, {
        status: params.status,
        type: params.type,
        shareholderId: params.shareholderId,
        channelId: params.channelId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        page: params.page,
        pageSize: params.pageSize ?? 25,
      }),
    );
  }

  // Mirrors GET admin/coops/:coopId/registrations
  @Tool({
    name: 'get_registration',
    description:
      'Get full details for a single registration (share transaction) by ID, including shareholder info, share class, project, and payments.',
    parameters: getRegistrationParameters,
  })
  async getRegistration(params: GetRegistrationParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) => {
      const registration = await this.registrationsService.findById(
        params.registrationId,
        ctx.coopId,
      );
      const { shareholder, ...rest } = registration;
      const shareholderSummary = {
        id: shareholder.id,
        type: shareholder.type,
        firstName: shareholder.firstName,
        lastName: shareholder.lastName,
        companyName: shareholder.companyName,
        email: shareholder.email,
      };

      return {
        ...rest,
        shareholder: ctx.canViewPII ? shareholderSummary : maskShareholderPII(shareholderSummary),
      };
    });
  }

  // Mirrors PUT admin/coops/:coopId/registrations/:id/approve
  @Tool({
    name: 'approve_registration',
    description: 'Approve a pending registration and move it to PENDING_PAYMENT.',
    parameters: approveRegistrationParameters,
  })
  async approveRegistration(params: ApproveRegistrationParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true },
      params,
      async (ctx) =>
        this.registrationsService.approve(params.registrationId, ctx.coopId, ctx.userId),
    );
  }

  // Mirrors PUT admin/coops/:coopId/registrations/:id/reject
  @Tool({
    name: 'reject_registration',
    description: 'Irreversibly reject a registration by cancelling it with a reason.',
    parameters: rejectRegistrationParameters,
  })
  async rejectRegistration(params: RejectRegistrationParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: RejectRegistrationDto },
      { reason: params.reason },
      async (ctx, dto) =>
        this.registrationsService.reject(params.registrationId, ctx.coopId, ctx.userId, dto.reason),
    );
  }

  // Mirrors PUT admin/coops/:coopId/registrations/:id/cancel
  @Tool({
    name: 'cancel_registration',
    description: 'Irreversibly cancel a registration as an admin override.',
    parameters: cancelRegistrationParameters,
  })
  async cancelRegistration(params: CancelRegistrationParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: CancelRegistrationDto },
      { reason: params.reason },
      async (ctx, dto) =>
        this.registrationsService.cancel(params.registrationId, ctx.coopId, ctx.userId, dto.reason),
    );
  }

  // Mirrors POST admin/coops/:coopId/transfers
  @Tool({
    name: 'create_transfer',
    description:
      'Create an irreversible admin-initiated share transfer between two shareholders. This creates a SELL for the source and a BUY for the destination.',
    parameters: createTransferParameters,
  })
  async createTransfer(params: CreateTransferParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: CreateTransferDto },
      params,
      async (ctx, dto) =>
        this.registrationsService.createTransfer({
          coopId: ctx.coopId,
          fromShareholderId: dto.fromShareholderId,
          toShareholderId: dto.toShareholderId,
          registrationId: dto.registrationId,
          quantity: dto.quantity,
          processedByUserId: ctx.userId,
        }),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/buy
  @Tool({
    name: 'buy_shares_for_shareholder',
    description:
      'Create a buy registration on behalf of a shareholder. This moves money and share ownership.',
    parameters: buySharesForShareholderParameters,
  })
  async buySharesForShareholder(params: BuySharesForShareholderParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: CreateBuyDto },
      {
        shareClassId: params.shareClassId,
        quantity: params.quantity,
        projectId: params.projectId,
        isSavings: params.isSavings,
      },
      async (ctx, dto) =>
        this.registrationsService.createBuy({
          coopId: ctx.coopId,
          shareholderId: params.shareholderId,
          shareClassId: dto.shareClassId,
          quantity: dto.quantity,
          projectId: dto.projectId,
          isSavings: dto.isSavings,
        }),
    );
  }

  // Mirrors POST admin/coops/:coopId/shareholders/:shareholderId/sell
  @Tool({
    name: 'sell_shares_for_shareholder',
    description: 'Create an irreversible sell registration on behalf of a shareholder.',
    parameters: sellSharesForShareholderParameters,
  })
  async sellSharesForShareholder(params: SellSharesForShareholderParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: CreateSellDto },
      {
        registrationId: params.registrationId,
        quantity: params.quantity,
      },
      async (ctx, dto) =>
        this.registrationsService.createSell({
          coopId: ctx.coopId,
          shareholderId: params.shareholderId,
          registrationId: dto.registrationId,
          quantity: dto.quantity,
        }),
    );
  }

  // Mirrors GET admin/coops/:coopId/registrations/:id/payment-details
  @Tool({
    name: 'get_payment_details',
    description: 'Return the IBAN, BIC, amount, and OGM code to pay or be paid for a registration.',
    parameters: getPaymentDetailsParameters,
  })
  async getPaymentDetails(params: GetPaymentDetailsParams) {
    return this.toolkit.run({ permission: 'canManageTransactions' }, params, async (ctx) =>
      this.registrationsService.getPaymentDetails(params.registrationId, ctx.coopId),
    );
  }

  // Mirrors PUT admin/coops/:coopId/registrations/:id/complete
  @Tool({
    name: 'complete_registration',
    description:
      'Irreversibly mark a registration COMPLETED. This may generate a gift code and trigger downstream effects.',
    parameters: completeRegistrationParameters,
  })
  async completeRegistration(params: CompleteRegistrationParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: CompleteRegistrationDto },
      { bankDate: params.bankDate },
      async (ctx, dto) => {
        const paymentDate = dto.bankDate ? new Date(dto.bankDate) : undefined;
        return this.registrationsService.complete(
          params.registrationId,
          ctx.userId,
          paymentDate,
          ctx.coopId,
        );
      },
    );
  }

  // Mirrors PATCH admin/coops/:coopId/registrations/:id/payment-date
  @Tool({
    name: 'set_payment_date',
    description: "Update the recorded bank value date on a completed registration's payments.",
    parameters: setPaymentDateParameters,
  })
  async setPaymentDate(params: SetPaymentDateParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: UpdatePaymentDateDto },
      { bankDate: params.bankDate },
      async (ctx, dto) =>
        this.registrationsService.updatePaymentDate(
          params.registrationId,
          ctx.coopId,
          new Date(dto.bankDate),
        ),
    );
  }

  // Mirrors POST admin/coops/:coopId/registrations/:id/payments
  @Tool({
    name: 'add_payment',
    description: 'Manually record a partial payment against a registration for savings shares.',
    parameters: addPaymentParameters,
  })
  async addPayment(params: AddPaymentParams) {
    return this.toolkit.run(
      { permission: 'canManageTransactions', write: true, dto: AddPaymentDto },
      { amount: params.amount, bankDate: params.bankDate },
      async (ctx, dto) =>
        this.paymentsService.addPayment({
          registrationId: params.registrationId,
          coopId: ctx.coopId,
          amount: dto.amount,
          bankDate: new Date(dto.bankDate),
          matchedByUserId: ctx.userId,
        }),
    );
  }

  // Mirrors POST admin/coops/:coopId/registrations/:registrationId/resend-payment-email
  @Tool({
    name: 'resend_payment_email',
    description: 'Send a payment-info email to the shareholder for a registration.',
    parameters: resendPaymentEmailParameters,
  })
  async resendPaymentEmail(params: ResendPaymentEmailParams) {
    return this.toolkit.run(
      { permission: 'canManageShareholders', write: true },
      params,
      async (ctx) =>
        this.registrationsService.resendPaymentEmail(params.registrationId, ctx.coopId),
    );
  }
}
