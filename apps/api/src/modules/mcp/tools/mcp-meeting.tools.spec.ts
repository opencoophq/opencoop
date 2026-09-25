jest.mock('../../meetings/agenda.service', () => ({
  AgendaService: class AgendaService {},
}));
jest.mock('../../meetings/attendance.service', () => ({
  AttendanceService: class AttendanceService {},
}));
jest.mock('../../meetings/convocation.service', () => ({
  ConvocationService: class ConvocationService {},
}));
jest.mock('../../meetings/meeting-documents.service', () => ({
  MeetingDocumentsService: class MeetingDocumentsService {},
}));
jest.mock('../../meetings/meetings.service', () => ({
  MeetingsService: class MeetingsService {},
}));
jest.mock('../../meetings/minutes.service', () => ({
  MinutesService: class MinutesService {},
}));
jest.mock('../../meetings/proxies.service', () => ({
  ProxiesService: class ProxiesService {},
}));
jest.mock('../../meetings/votes.service', () => ({
  VotesService: class VotesService {},
}));

import { Test } from '@nestjs/testing';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { AgendaService } from '../../meetings/agenda.service';
import { AttendanceService } from '../../meetings/attendance.service';
import { ConvocationService } from '../../meetings/convocation.service';
import { MeetingDocumentsService } from '../../meetings/meeting-documents.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { MinutesService } from '../../meetings/minutes.service';
import { ProxiesService } from '../../meetings/proxies.service';
import { VotesService } from '../../meetings/votes.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import {
  addAgendaItemParameters,
  createMeetingParameters,
  McpMeetingTools,
  recordVotesParameters,
  sendConvocationParameters,
  updateDocumentsEmailDraftParameters,
  updateMeetingDocumentParameters,
  updateMeetingParameters,
  updateMinutesParameters,
  cancelMeetingParameters,
} from './mcp-meeting.tools';

describe('McpMeetingTools', () => {
  let tools: McpMeetingTools;
  const auth = {
    getUserId: () => 'user-1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'key-1',
    getScope: jest.fn(),
  };
  const permissions = { permissions: jest.fn(), permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const meetings = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    cancel: jest.fn(),
  };
  const agenda = {
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
  };
  const proxies = {
    create: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
  };
  const votes = {
    recordVotes: jest.fn(),
    closeResolution: jest.fn(),
  };
  const convocation = {
    send: jest.fn(),
    listStatus: jest.fn(),
    previewEmail: jest.fn(),
    sendReminderNow: jest.fn(),
  };
  const attendance = {
    checkIn: jest.fn(),
    undo: jest.fn(),
    liveState: jest.fn(),
    list: jest.fn(),
  };
  const minutes = {
    get: jest.fn(),
    generateDraft: jest.fn(),
    update: jest.fn(),
    finalize: jest.fn(),
  };
  const documents = {
    list: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getEmailDraft: jest.fn(),
    updateEmailDraft: jest.fn(),
    previewEmail: jest.fn(),
    sendEmail: jest.fn(),
    listAttendanceStatuses: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpMeetingTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: MeetingsService, useValue: meetings },
        { provide: AgendaService, useValue: agenda },
        { provide: ProxiesService, useValue: proxies },
        { provide: VotesService, useValue: votes },
        { provide: ConvocationService, useValue: convocation },
        { provide: AttendanceService, useValue: attendance },
        { provide: MinutesService, useValue: minutes },
        { provide: MeetingDocumentsService, useValue: documents },
      ],
    }).compile();
    tools = module.get(McpMeetingTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockImplementation(async () => ({
      permissions: await permissions.permissions(),
      role: 'COOP_ADMIN',
    }));
    auth.getScope.mockReturnValue('READ_WRITE');
    permissions.permissions.mockResolvedValue({ canManageMeetings: true });
    billing.isReadOnly.mockResolvedValue(false);
  });

  it('calls every included REST service with the authenticated coop and actor', async () => {
    await tools.createMeeting({
      type: 'ANNUAL',
      title: 'Annual meeting',
      scheduledAt: '2026-10-01T10:00:00+02:00',
      format: 'PHYSICAL',
    });
    await tools.listMeetings({});
    await tools.getMeeting({ meetingId: 'meeting-1' });
    await tools.updateMeeting({ meetingId: 'meeting-1', title: 'Updated meeting' });
    await tools.deleteMeeting({ meetingId: 'meeting-1' });
    await tools.cancelMeeting({ meetingId: 'meeting-1', reason: 'No longer needed' });
    await tools.addAgendaItem({
      meetingId: 'meeting-1',
      order: 1,
      title: 'Resolution',
      type: 'RESOLUTION',
      resolution: { proposedText: 'Approve', majorityType: 'SIMPLE' },
    });
    await tools.updateAgendaItem({ meetingId: 'meeting-1', itemId: 'item-1', title: 'Updated' });
    await tools.deleteAgendaItem({ meetingId: 'meeting-1', itemId: 'item-1' });
    await tools.createProxy({
      meetingId: 'meeting-1',
      grantorShareholderId: 'grantor-1',
      delegateShareholderId: 'delegate-1',
    });
    await tools.listProxies({ meetingId: 'meeting-1' });
    await tools.deleteProxy({ meetingId: 'meeting-1', proxyId: 'proxy-1' });
    await tools.recordVotes({
      resolutionId: 'resolution-1',
      votes: [{ shareholderId: 'shareholder-1', choice: 'FOR' }],
    });
    await tools.closeResolution({ meetingId: 'meeting-1', resolutionId: 'resolution-1' });
    await tools.sendConvocation({ meetingId: 'meeting-1', confirmShortNotice: true });
    await tools.getConvocationStatus({ meetingId: 'meeting-1' });
    await tools.previewConvocation({ meetingId: 'meeting-1', shareholderId: 'shareholder-1' });
    await tools.sendConvocationReminder({ meetingId: 'meeting-1' });
    await tools.checkInAttendee({ meetingId: 'meeting-1', shareholderId: 'shareholder-1' });
    await tools.undoCheckIn({ meetingId: 'meeting-1', shareholderId: 'shareholder-1' });
    await tools.getLiveAttendance({ meetingId: 'meeting-1' });
    await tools.listAttendance({ meetingId: 'meeting-1' });
    await tools.getMinutes({ meetingId: 'meeting-1' });
    await tools.generateMinutes({ meetingId: 'meeting-1' });
    await tools.updateMinutes({ meetingId: 'meeting-1', content: '# Minutes' });
    await tools.finalizeMinutes({ meetingId: 'meeting-1' });
    await tools.listMeetingDocuments({ meetingId: 'meeting-1' });
    await tools.updateMeetingDocument({
      meetingId: 'meeting-1',
      docId: 'doc-1',
      displayName: 'Agenda.pdf',
      order: 2,
    });
    await tools.deleteMeetingDocument({ meetingId: 'meeting-1', docId: 'doc-1' });
    await tools.getDocumentsEmailDraft({ meetingId: 'meeting-1' });
    await tools.updateDocumentsEmailDraft({
      meetingId: 'meeting-1',
      subject: 'Documents',
      intro: 'Please review these documents.',
    });
    await tools.previewDocumentsEmail({ meetingId: 'meeting-1', shareholderId: 'shareholder-1' });
    await tools.emailMeetingDocuments({ meetingId: 'meeting-1' });
    await tools.listRsvpStatuses({ meetingId: 'meeting-1' });

    expect(meetings.create).toHaveBeenCalledWith(
      'coop-from-auth',
      expect.objectContaining({ type: 'ANNUAL', title: 'Annual meeting' }),
    );
    expect(meetings.list).toHaveBeenCalledWith('coop-from-auth');
    expect(meetings.get).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(meetings.update).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', {
      title: 'Updated meeting',
    });
    expect(meetings.delete).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(meetings.cancel).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', 'No longer needed');
    expect(agenda.addItem).toHaveBeenCalledWith(
      'coop-from-auth',
      'meeting-1',
      expect.objectContaining({ order: 1, type: 'RESOLUTION' }),
    );
    expect(agenda.updateItem).toHaveBeenCalledWith('coop-from-auth', 'item-1', {
      title: 'Updated',
    });
    expect(agenda.removeItem).toHaveBeenCalledWith('coop-from-auth', 'item-1');
    expect(proxies.create).toHaveBeenCalledWith(
      'coop-from-auth',
      'meeting-1',
      'grantor-1',
      'delegate-1',
    );
    expect(proxies.list).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(proxies.revoke).toHaveBeenCalledWith('coop-from-auth', 'proxy-1');
    expect(votes.recordVotes).toHaveBeenCalledWith('coop-from-auth', 'resolution-1', [
      { shareholderId: 'shareholder-1', choice: 'FOR' },
    ]);
    expect(votes.closeResolution).toHaveBeenCalledWith('coop-from-auth', 'resolution-1');
    expect(convocation.send).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', {
      confirmShortNotice: true,
    });
    expect(convocation.listStatus).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(convocation.previewEmail).toHaveBeenCalledWith(
      'coop-from-auth',
      'meeting-1',
      'shareholder-1',
    );
    expect(convocation.sendReminderNow).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(attendance.checkIn).toHaveBeenCalledWith(
      'coop-from-auth',
      'meeting-1',
      'shareholder-1',
      'user-1',
    );
    expect(attendance.undo).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', 'shareholder-1');
    expect(attendance.liveState).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(attendance.list).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(minutes.get).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(minutes.generateDraft).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(minutes.update).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', '# Minutes');
    expect(minutes.finalize).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', '');
    expect(documents.list).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(documents.update).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', 'doc-1', {
      displayName: 'Agenda.pdf',
      order: 2,
    });
    expect(documents.remove).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', 'doc-1');
    expect(documents.getEmailDraft).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
    expect(documents.updateEmailDraft).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', {
      subject: 'Documents',
      intro: 'Please review these documents.',
    });
    expect(documents.previewEmail).toHaveBeenCalledWith(
      'coop-from-auth',
      'meeting-1',
      'shareholder-1',
    );
    expect(documents.sendEmail).toHaveBeenCalledWith('coop-from-auth', 'meeting-1', 'user-1');
    expect(documents.listAttendanceStatuses).toHaveBeenCalledWith('coop-from-auth', 'meeting-1');
  });

  it('rejects missing permission and read-only writes before calling services', async () => {
    permissions.permissions.mockResolvedValue({ canManageMeetings: false });
    await expect(tools.listMeetings({})).rejects.toBeInstanceOf(McpError);
    expect(meetings.list).not.toHaveBeenCalled();

    permissions.permissions.mockResolvedValue({ canManageMeetings: true });
    auth.getScope.mockReturnValue('READ_ONLY');
    await expect(
      tools.createMeeting({
        type: 'ANNUAL',
        title: 'Annual meeting',
        scheduledAt: '2026-10-01T10:00:00+02:00',
        format: 'PHYSICAL',
      }),
    ).rejects.toBeInstanceOf(McpError);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  it('masks nested shareholder PII in attendance and convocation outputs', async () => {
    permissions.permissions.mockResolvedValue({ canManageMeetings: true, canViewPII: false });
    attendance.list.mockResolvedValue([
      {
        shareholder: {
          id: 'shareholder-1234',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
        proxiesHeld: [{ id: 'shareholder-5678', firstName: 'Grace', lastName: 'Hopper' }],
      },
    ]);
    convocation.listStatus.mockResolvedValue([
      {
        shareholder: { id: 'shareholder-1234', firstName: 'Ada', email: 'ada@example.com' },
      },
    ]);
    convocation.previewEmail.mockResolvedValue({
      shareholderName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
    });
    documents.previewEmail.mockResolvedValue({
      shareholderName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
    });

    const attendanceResult = await tools.listAttendance({ meetingId: 'meeting-1' });
    const statusResult = await tools.getConvocationStatus({ meetingId: 'meeting-1' });
    const convocationResult = await tools.previewConvocation({
      meetingId: 'meeting-1',
      shareholderId: 'shareholder-1234',
    });
    const documentsResult = await tools.previewDocumentsEmail({
      meetingId: 'meeting-1',
      shareholderId: 'shareholder-1234',
    });

    expect(attendanceResult).toEqual([
      {
        shareholder: expect.objectContaining({
          firstName: 'Aandeelhouder #1234',
          lastName: '',
          email: '***',
        }),
        proxiesHeld: [expect.objectContaining({ firstName: 'Aandeelhouder #5678', lastName: '' })],
      },
    ]);
    expect(statusResult).toEqual([
      { shareholder: expect.objectContaining({ firstName: 'Aandeelhouder #1234', email: '***' }) },
    ]);
    expect(convocationResult).toEqual({
      shareholderName: '***',
      recipientEmail: '***',
    });
    expect(documentsResult).toEqual({
      shareholderName: '***',
      recipientEmail: '***',
    });
  });

  it('masks shareholder names in document attendance statuses when canViewPII is false', async () => {
    permissions.permissions.mockResolvedValue({ canManageMeetings: true, canViewPII: false });
    documents.listAttendanceStatuses.mockResolvedValue([
      { shareholderName: 'Ada Lovelace', documentsEmailSentAt: null },
    ]);

    const result = await tools.listRsvpStatuses({ meetingId: 'meeting-1' });

    expect(result).toEqual([{ shareholderName: '***', documentsEmailSentAt: null }]);
  });

  it('masks reminder failure recipient addresses in the generic pass', async () => {
    permissions.permissions.mockResolvedValue({ canManageMeetings: true, canViewPII: false });
    convocation.sendReminderNow.mockResolvedValue({
      sent: 0,
      failures: [{ to: 'ada@example.com', error: 'Mailbox unavailable' }],
    });

    const result = await tools.sendConvocationReminder({ meetingId: 'meeting-1' });

    expect(result).toEqual({
      sent: 0,
      failures: [{ to: '***', error: 'Mailbox unavailable' }],
    });
  });

  it('validates non-trivial tool input with the zod schemas', () => {
    expect(
      createMeetingParameters.safeParse({
        type: 'ANNUAL',
        title: 'Annual meeting',
        scheduledAt: 'not-a-date',
        format: 'PHYSICAL',
      }).success,
    ).toBe(false);
    expect(
      updateMeetingParameters.safeParse({ meetingId: 'meeting-1', unknown: true }).success,
    ).toBe(false);
    expect(cancelMeetingParameters.safeParse({ meetingId: 'meeting-1' }).success).toBe(false);
    expect(
      addAgendaItemParameters.safeParse({ meetingId: 'meeting-1', title: 'Missing fields' })
        .success,
    ).toBe(false);
    expect(
      recordVotesParameters.safeParse({
        resolutionId: 'resolution-1',
        votes: [{ shareholderId: 'shareholder-1', choice: 'INVALID' }],
      }).success,
    ).toBe(false);
    expect(
      sendConvocationParameters.safeParse({ meetingId: 'meeting-1', extra: true }).success,
    ).toBe(false);
    expect(
      updateMeetingDocumentParameters.safeParse({
        meetingId: 'meeting-1',
        docId: 'doc-1',
        order: -1,
      }).success,
    ).toBe(false);
    expect(
      updateDocumentsEmailDraftParameters.safeParse({
        meetingId: 'meeting-1',
        intro: 'x'.repeat(10_001),
      }).success,
    ).toBe(false);
    expect(updateMinutesParameters.safeParse({ meetingId: 'meeting-1' }).success).toBe(false);
  });
});
