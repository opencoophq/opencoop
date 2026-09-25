import { Injectable } from '@nestjs/common';
import {
  AgendaType,
  MajorityType,
  MeetingFormat,
  MeetingType,
  VoteChoice,
  VotingWeight,
} from '@opencoop/database';
import { Tool } from '@rekog/mcp-nest';
import { IsString } from 'class-validator';
import { z } from 'zod';
import { maskShareholderPII } from '../../../common/utils/mask-pii';
import { AgendaService } from '../../meetings/agenda.service';
import { AttendanceService } from '../../meetings/attendance.service';
import { CancelMeetingDto } from '../../meetings/dto/cancel-meeting.dto';
import { CreateAgendaItemDto } from '../../meetings/dto/create-agenda-item.dto';
import { CreateMeetingDto } from '../../meetings/dto/create-meeting.dto';
import { CreateProxyDto } from '../../meetings/dto/create-proxy.dto';
import { BulkRecordVotesDto } from '../../meetings/dto/record-vote.dto';
import { SendConvocationDto } from '../../meetings/dto/send-convocation.dto';
import { UpdateAgendaItemDto } from '../../meetings/dto/update-agenda-item.dto';
import { UpdateDocumentsEmailDraftDto } from '../../meetings/dto/update-documents-email-draft.dto';
import { UpdateMeetingDocumentDto } from '../../meetings/dto/update-meeting-document.dto';
import { UpdateMeetingDto } from '../../meetings/dto/update-meeting.dto';
import { UpdateMinutesDto } from '../../meetings/dto/update-minutes.dto';
import { MeetingDocumentsService } from '../../meetings/meeting-documents.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { MinutesService } from '../../meetings/minutes.service';
import { ProxiesService } from '../../meetings/proxies.service';
import { ConvocationService } from '../../meetings/convocation.service';
import { VotesService } from '../../meetings/votes.service';
import { McpToolkit } from '../mcp-toolkit';

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

const resolutionParameters = z
  .object({
    proposedText: z.string(),
    majorityType: z.nativeEnum(MajorityType),
    quorumRequired: z.number().optional(),
  })
  .strict();

const meetingFields = {
  type: z.nativeEnum(MeetingType),
  title: z.string(),
  scheduledAt: isoDate,
  durationMinutes: z.number().int().min(15).optional(),
  location: z.string().optional(),
  format: z.nativeEnum(MeetingFormat),
  votingWeight: z.nativeEnum(VotingWeight).optional(),
  maxProxiesPerPerson: z.number().int().min(1).optional(),
  reminderDaysBefore: z.array(z.number()).optional(),
  customSubject: z.string().nullable().optional(),
  customBody: z.string().nullable().optional(),
};

export const createMeetingParameters = z.object(meetingFields).strict();

export const listMeetingsParameters = z.object({}).strict();

export const getMeetingParameters = z
  .object({ meetingId: z.string().describe('The meeting ID') })
  .strict();

export const updateMeetingParameters = z
  .object({ meetingId: z.string(), ...meetingFields })
  .partial()
  .extend({ meetingId: z.string() })
  .strict();

export const deleteMeetingParameters = getMeetingParameters;

export const cancelMeetingParameters = z
  .object({ meetingId: z.string(), reason: z.string() })
  .strict();

export const addAgendaItemParameters = z
  .object({
    meetingId: z.string(),
    order: z.number().int().min(0),
    title: z.string(),
    description: z.string().optional(),
    type: z.nativeEnum(AgendaType),
    resolution: resolutionParameters.optional(),
  })
  .strict();

export const updateAgendaItemParameters = z
  .object({
    meetingId: z.string(),
    itemId: z.string(),
    order: z.number().int().min(0).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.nativeEnum(AgendaType).optional(),
    resolution: resolutionParameters.optional(),
  })
  .strict();

export const deleteAgendaItemParameters = z
  .object({ meetingId: z.string(), itemId: z.string() })
  .strict();

export const createProxyParameters = z
  .object({
    meetingId: z.string(),
    grantorShareholderId: z.string(),
    delegateShareholderId: z.string(),
  })
  .strict();

export const listProxiesParameters = getMeetingParameters;

export const deleteProxyParameters = z
  .object({ meetingId: z.string(), proxyId: z.string() })
  .strict();

const voteParameters = z
  .object({
    shareholderId: z.string(),
    choice: z.nativeEnum(VoteChoice),
    castViaProxyId: z.string().optional(),
  })
  .strict();

export const recordVotesParameters = z
  .object({ resolutionId: z.string(), votes: z.array(voteParameters) })
  .strict();

export const closeResolutionParameters = z
  .object({ meetingId: z.string(), resolutionId: z.string() })
  .strict();

export const sendConvocationParameters = z
  .object({ meetingId: z.string(), confirmShortNotice: z.boolean().optional() })
  .strict();

export const getConvocationStatusParameters = getMeetingParameters;

export const previewConvocationParameters = z
  .object({ meetingId: z.string(), shareholderId: z.string() })
  .strict();

export const sendConvocationReminderParameters = getMeetingParameters;

export const checkInAttendeeParameters = z
  .object({ meetingId: z.string(), shareholderId: z.string() })
  .strict();

export const undoCheckInParameters = checkInAttendeeParameters;
export const getLiveAttendanceParameters = getMeetingParameters;
export const listAttendanceParameters = getMeetingParameters;
export const getMinutesParameters = getMeetingParameters;
export const generateMinutesParameters = getMeetingParameters;

export const updateMinutesParameters = z
  .object({ meetingId: z.string(), content: z.string() })
  .strict();

export const finalizeMinutesParameters = getMeetingParameters;
export const listMeetingDocumentsParameters = getMeetingParameters;

export const updateMeetingDocumentParameters = z
  .object({
    meetingId: z.string(),
    docId: z.string(),
    displayName: z.string().max(255).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

export const deleteMeetingDocumentParameters = z
  .object({ meetingId: z.string(), docId: z.string() })
  .strict();

export const getDocumentsEmailDraftParameters = getMeetingParameters;

export const updateDocumentsEmailDraftParameters = z
  .object({
    meetingId: z.string(),
    subject: z.string().max(255).optional(),
    intro: z.string().max(10_000).optional(),
  })
  .strict();

export const previewDocumentsEmailParameters = z
  .object({ meetingId: z.string(), shareholderId: z.string() })
  .strict();

export const emailMeetingDocumentsParameters = getMeetingParameters;
export const listRsvpStatusesParameters = getMeetingParameters;

class UpdateMeetingToolDto extends UpdateMeetingDto {
  @IsString()
  meetingId!: string;
}

class CancelMeetingToolDto extends CancelMeetingDto {
  @IsString()
  meetingId!: string;
}

class CreateAgendaItemToolDto extends CreateAgendaItemDto {
  @IsString()
  meetingId!: string;
}

class UpdateAgendaItemToolDto extends UpdateAgendaItemDto {
  @IsString()
  meetingId!: string;

  @IsString()
  itemId!: string;
}

class CreateProxyToolDto extends CreateProxyDto {
  @IsString()
  meetingId!: string;
}

class BulkRecordVotesToolDto extends BulkRecordVotesDto {
  @IsString()
  resolutionId!: string;
}

class SendConvocationToolDto extends SendConvocationDto {
  @IsString()
  meetingId!: string;
}

class UpdateMinutesToolDto extends UpdateMinutesDto {
  @IsString()
  meetingId!: string;
}

class UpdateMeetingDocumentToolDto extends UpdateMeetingDocumentDto {
  @IsString()
  meetingId!: string;

  @IsString()
  docId!: string;
}

class UpdateDocumentsEmailDraftToolDto extends UpdateDocumentsEmailDraftDto {
  @IsString()
  meetingId!: string;
}

type CreateMeetingParams = z.infer<typeof createMeetingParameters>;
type ListMeetingsParams = z.infer<typeof listMeetingsParameters>;
type GetMeetingParams = z.infer<typeof getMeetingParameters>;
type UpdateMeetingParams = z.infer<typeof updateMeetingParameters>;
type CancelMeetingParams = z.infer<typeof cancelMeetingParameters>;
type AddAgendaItemParams = z.infer<typeof addAgendaItemParameters>;
type UpdateAgendaItemParams = z.infer<typeof updateAgendaItemParameters>;
type DeleteAgendaItemParams = z.infer<typeof deleteAgendaItemParameters>;
type CreateProxyParams = z.infer<typeof createProxyParameters>;
type ListProxiesParams = z.infer<typeof listProxiesParameters>;
type DeleteProxyParams = z.infer<typeof deleteProxyParameters>;
type RecordVotesParams = z.infer<typeof recordVotesParameters>;
type CloseResolutionParams = z.infer<typeof closeResolutionParameters>;
type SendConvocationParams = z.infer<typeof sendConvocationParameters>;
type PreviewConvocationParams = z.infer<typeof previewConvocationParameters>;
type CheckInAttendeeParams = z.infer<typeof checkInAttendeeParameters>;
type UpdateMinutesParams = z.infer<typeof updateMinutesParameters>;
type UpdateMeetingDocumentParams = z.infer<typeof updateMeetingDocumentParameters>;
type DeleteMeetingDocumentParams = z.infer<typeof deleteMeetingDocumentParameters>;
type UpdateDocumentsEmailDraftParams = z.infer<typeof updateDocumentsEmailDraftParameters>;
type PreviewDocumentsEmailParams = z.infer<typeof previewDocumentsEmailParameters>;

@Injectable()
export class McpMeetingTools {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly agenda: AgendaService,
    private readonly proxies: ProxiesService,
    private readonly votes: VotesService,
    private readonly convocation: ConvocationService,
    private readonly attendance: AttendanceService,
    private readonly minutes: MinutesService,
    private readonly documents: MeetingDocumentsService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors POST admin/coops/:coopId/meetings
  @Tool({
    name: 'create_meeting',
    description: 'Create a general meeting and return the created meeting.',
    parameters: createMeetingParameters,
  })
  async createMeeting(params: CreateMeetingParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: CreateMeetingDto },
      params,
      async (ctx, dto) => this.meetings.create(ctx.coopId, dto),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings
  @Tool({
    name: 'list_meetings',
    description: 'List all general meetings in the authenticated cooperative.',
    parameters: listMeetingsParameters,
  })
  async listMeetings(params: ListMeetingsParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.meetings.list(ctx.coopId),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id
  @Tool({
    name: 'get_meeting',
    description: 'Get one meeting, including its agenda items and responded RSVPs.',
    parameters: getMeetingParameters,
  })
  async getMeeting(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.meetings.get(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/meetings/:id
  @Tool({
    name: 'update_meeting',
    description: 'Update a meeting and return the updated meeting.',
    parameters: updateMeetingParameters,
  })
  async updateMeeting(params: UpdateMeetingParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: UpdateMeetingToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, ...updateDto } = dto;
        return this.meetings.update(ctx.coopId, dto.meetingId, updateDto);
      },
    );
  }

  // Mirrors DELETE admin/coops/:coopId/meetings/:id
  @Tool({
    name: 'delete_meeting',
    description: 'Delete a draft meeting.',
    parameters: deleteMeetingParameters,
  })
  async deleteMeeting(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.meetings.delete(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/cancel
  @Tool({
    name: 'cancel_meeting',
    description: 'Cancel a meeting with a required reason.',
    parameters: cancelMeetingParameters,
  })
  async cancelMeeting(params: CancelMeetingParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: CancelMeetingToolDto },
      params,
      async (ctx, dto) => this.meetings.cancel(ctx.coopId, dto.meetingId, dto.reason),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/agenda-items
  @Tool({
    name: 'add_agenda_item',
    description: 'Add an agenda item to a meeting and return it.',
    parameters: addAgendaItemParameters,
  })
  async addAgendaItem(params: AddAgendaItemParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: CreateAgendaItemToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, ...agendaDto } = dto;
        return this.agenda.addItem(ctx.coopId, dto.meetingId, agendaDto);
      },
    );
  }

  // Mirrors PATCH admin/coops/:coopId/meetings/:id/agenda-items/:itemId
  @Tool({
    name: 'update_agenda_item',
    description: 'Update an agenda item and return the updated item.',
    parameters: updateAgendaItemParameters,
  })
  async updateAgendaItem(params: UpdateAgendaItemParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: UpdateAgendaItemToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, itemId: _itemId, ...agendaDto } = dto;
        return this.agenda.updateItem(ctx.coopId, dto.itemId, agendaDto);
      },
    );
  }

  // Mirrors DELETE admin/coops/:coopId/meetings/:id/agenda-items/:itemId
  @Tool({
    name: 'delete_agenda_item',
    description: 'Delete an agenda item from a meeting.',
    parameters: deleteAgendaItemParameters,
  })
  async deleteAgendaItem(params: DeleteAgendaItemParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.agenda.removeItem(ctx.coopId, params.itemId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/proxies
  @Tool({
    name: 'create_proxy',
    description: 'Create a proxy for a meeting and return it.',
    parameters: createProxyParameters,
  })
  async createProxy(params: CreateProxyParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: CreateProxyToolDto },
      params,
      async (ctx, dto) =>
        this.proxies.create(
          ctx.coopId,
          dto.meetingId,
          dto.grantorShareholderId,
          dto.delegateShareholderId,
        ),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/proxies
  @Tool({
    name: 'list_proxies',
    description: 'List active proxies for a meeting.',
    parameters: listProxiesParameters,
  })
  async listProxies(params: ListProxiesParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.proxies.list(ctx.coopId, params.meetingId);
      if (ctx.canViewPII) return result;
      return result.map((proxy) => ({
        ...proxy,
        grantor: maskShareholderPII(proxy.grantor),
        delegate: maskShareholderPII(proxy.delegate),
      }));
    });
  }

  // Mirrors DELETE admin/coops/:coopId/meetings/:id/proxies/:proxyId
  @Tool({
    name: 'delete_proxy',
    description: 'Revoke a proxy for a meeting.',
    parameters: deleteProxyParameters,
  })
  async deleteProxy(params: DeleteProxyParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.proxies.revoke(ctx.coopId, params.proxyId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/resolutions/:resId/votes
  @Tool({
    name: 'record_votes',
    description: 'Record or replace votes for a resolution and return the updated resolution.',
    parameters: recordVotesParameters,
  })
  async recordVotes(params: RecordVotesParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: BulkRecordVotesToolDto },
      params,
      async (ctx, dto) => this.votes.recordVotes(ctx.coopId, dto.resolutionId, dto.votes),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/resolutions/:resId/close
  @Tool({
    name: 'close_resolution',
    description:
      'Close voting on a resolution and calculate its outcome. This is irreversible in practice.',
    parameters: closeResolutionParameters,
  })
  async closeResolution(params: z.infer<typeof closeResolutionParameters>) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.votes.closeResolution(ctx.coopId, params.resolutionId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/convocation/send
  @Tool({
    name: 'send_convocation',
    description: 'Send the convocation email to every eligible shareholder. This cannot be undone.',
    parameters: sendConvocationParameters,
  })
  async sendConvocation(params: SendConvocationParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: SendConvocationToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, ...sendDto } = dto;
        return this.convocation.send(ctx.coopId, dto.meetingId, sendDto);
      },
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/convocation/status
  @Tool({
    name: 'get_convocation_status',
    description: 'List convocation and RSVP status for a meeting.',
    parameters: getConvocationStatusParameters,
  })
  async getConvocationStatus(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.convocation.listStatus(ctx.coopId, params.meetingId);
      if (ctx.canViewPII) return result;
      return result.map((row) => ({
        ...row,
        shareholder: maskShareholderPII(row.shareholder),
      }));
    });
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/convocation/email-preview
  @Tool({
    name: 'preview_convocation',
    description: 'Preview the JSON convocation email for one shareholder.',
    parameters: previewConvocationParameters,
  })
  async previewConvocation(params: z.infer<typeof previewConvocationParameters>) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.convocation.previewEmail(
        ctx.coopId,
        params.meetingId,
        params.shareholderId,
      );
      if (ctx.canViewPII) return result;
      const masked = maskShareholderPII({
        id: params.shareholderId,
        firstName: result.shareholderName,
      });
      return {
        ...result,
        shareholderName: masked.firstName,
        recipientEmail: result.recipientEmail ? '***' : result.recipientEmail,
      };
    });
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/convocation/reminder
  @Tool({
    name: 'send_convocation_reminder',
    description:
      'Send a reminder email to shareholders who have not yet responded. This cannot be undone.',
    parameters: sendConvocationReminderParameters,
  })
  async sendConvocationReminder(params: GetMeetingParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true },
      params,
      async (ctx) => {
        const result = await this.convocation.sendReminderNow(ctx.coopId, params.meetingId);
        if (ctx.canViewPII) return result;
        return {
          ...result,
          failures: result.failures.map((entry) => ({ ...entry, to: '***' })),
        };
      },
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/attendance/:shareholderId/check-in
  @Tool({
    name: 'check_in_attendee',
    description: 'Check in a shareholder for a meeting.',
    parameters: checkInAttendeeParameters,
  })
  async checkInAttendee(params: CheckInAttendeeParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.attendance.checkIn(ctx.coopId, params.meetingId, params.shareholderId, ctx.userId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/attendance/:shareholderId/undo
  @Tool({
    name: 'undo_check_in',
    description: 'Undo a shareholder check-in for a meeting.',
    parameters: undoCheckInParameters,
  })
  async undoCheckIn(params: CheckInAttendeeParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.attendance.undo(ctx.coopId, params.meetingId, params.shareholderId),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/live-attendance
  @Tool({
    name: 'get_live_attendance',
    description: 'Get live RSVP, check-in, proxy, and eligible-attendee counts for a meeting.',
    parameters: getLiveAttendanceParameters,
  })
  async getLiveAttendance(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.attendance.liveState(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/attendance
  @Tool({
    name: 'list_attendance',
    description: 'List meeting attendance, shareholder details, and active proxies held.',
    parameters: listAttendanceParameters,
  })
  async listAttendance(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.attendance.list(ctx.coopId, params.meetingId);
      if (ctx.canViewPII) return result;
      return result.map((row) => ({
        ...row,
        shareholder: maskShareholderPII(row.shareholder),
        proxiesHeld: row.proxiesHeld.map((shareholder) => maskShareholderPII(shareholder)),
      }));
    });
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/minutes
  @Tool({
    name: 'get_minutes',
    description: 'Get the minutes for a meeting.',
    parameters: getMinutesParameters,
  })
  async getMinutes(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.minutes.get(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/minutes/generate
  @Tool({
    name: 'generate_minutes',
    description: 'Generate draft minutes from the meeting records.',
    parameters: generateMinutesParameters,
  })
  async generateMinutes(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.minutes.generateDraft(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/meetings/:id/minutes
  @Tool({
    name: 'update_minutes',
    description: 'Replace the minutes content and return the updated minutes.',
    parameters: updateMinutesParameters,
  })
  async updateMinutes(params: UpdateMinutesParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: UpdateMinutesToolDto },
      params,
      async (ctx, dto) => this.minutes.update(ctx.coopId, dto.meetingId, dto.content),
    );
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/minutes/finalize
  @Tool({
    name: 'finalize_minutes',
    description: 'Finalize and lock the minutes. This cannot be undone.',
    parameters: finalizeMinutesParameters,
  })
  async finalizeMinutes(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.minutes.finalize(ctx.coopId, params.meetingId, ''),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/documents
  @Tool({
    name: 'list_meeting_documents',
    description: 'List meeting document metadata without downloading files.',
    parameters: listMeetingDocumentsParameters,
  })
  async listMeetingDocuments(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.documents.list(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/meetings/:id/documents/:docId
  @Tool({
    name: 'update_meeting_document',
    description: 'Update meeting document metadata only; file uploads are not supported.',
    parameters: updateMeetingDocumentParameters,
  })
  async updateMeetingDocument(params: UpdateMeetingDocumentParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: UpdateMeetingDocumentToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, docId: _docId, ...patch } = dto;
        return this.documents.update(ctx.coopId, dto.meetingId, dto.docId, patch);
      },
    );
  }

  // Mirrors DELETE admin/coops/:coopId/meetings/:id/documents/:docId
  @Tool({
    name: 'delete_meeting_document',
    description: 'Delete a meeting document and its stored file.',
    parameters: deleteMeetingDocumentParameters,
  })
  async deleteMeetingDocument(params: DeleteMeetingDocumentParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.documents.remove(ctx.coopId, params.meetingId, params.docId),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/documents-email
  @Tool({
    name: 'get_documents_email_draft',
    description: 'Get the meeting documents email draft and delivery counts.',
    parameters: getDocumentsEmailDraftParameters,
  })
  async getDocumentsEmailDraft(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) =>
      this.documents.getEmailDraft(ctx.coopId, params.meetingId),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/meetings/:id/documents-email
  @Tool({
    name: 'update_documents_email_draft',
    description: 'Update the meeting documents email subject or introduction.',
    parameters: updateDocumentsEmailDraftParameters,
  })
  async updateDocumentsEmailDraft(params: UpdateDocumentsEmailDraftParams) {
    return this.toolkit.run(
      { permission: 'canManageMeetings', write: true, dto: UpdateDocumentsEmailDraftToolDto },
      params,
      async (ctx, dto) => {
        const { meetingId: _meetingId, ...patch } = dto;
        return this.documents.updateEmailDraft(ctx.coopId, dto.meetingId, patch);
      },
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/documents-email/preview
  @Tool({
    name: 'preview_documents_email',
    description: 'Preview the JSON meeting documents email for one shareholder.',
    parameters: previewDocumentsEmailParameters,
  })
  async previewDocumentsEmail(params: PreviewDocumentsEmailParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.documents.previewEmail(
        ctx.coopId,
        params.meetingId,
        params.shareholderId,
      );
      if (ctx.canViewPII) return result;
      const masked = maskShareholderPII({
        id: params.shareholderId,
        firstName: result.shareholderName,
      });
      return {
        ...result,
        shareholderName: masked.firstName,
        recipientEmail: result.recipientEmail ? '***' : result.recipientEmail,
      };
    });
  }

  // Mirrors POST admin/coops/:coopId/meetings/:id/documents-email/send
  @Tool({
    name: 'email_meeting_documents',
    description:
      'Email the meeting documents to every eligible shareholder. This cannot be undone.',
    parameters: emailMeetingDocumentsParameters,
  })
  async emailMeetingDocuments(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings', write: true }, params, async (ctx) =>
      this.documents.sendEmail(ctx.coopId, params.meetingId, ctx.userId),
    );
  }

  // Mirrors GET admin/coops/:coopId/meetings/:id/rsvp/attendance-statuses
  @Tool({
    name: 'list_rsvp_statuses',
    description: 'List RSVP and meeting-documents email statuses for a meeting.',
    parameters: listRsvpStatusesParameters,
  })
  async listRsvpStatuses(params: GetMeetingParams) {
    return this.toolkit.run({ permission: 'canManageMeetings' }, params, async (ctx) => {
      const result = await this.documents.listAttendanceStatuses(ctx.coopId, params.meetingId);
      if (ctx.canViewPII) return result;
      return result.map((row, index) => ({
        ...row,
        shareholderName: `Aandeelhouder #${index + 1}`,
      }));
    });
  }
}
