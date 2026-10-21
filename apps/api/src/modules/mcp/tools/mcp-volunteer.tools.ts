import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ListVolunteersQueryDto } from '../../volunteers/dto/list-volunteers.query';
import { UpdateVolunteerDto } from '../../volunteers/dto/update-volunteer.dto';
import { UpdateVolunteerInterestsDto } from '../../volunteers/dto/update-volunteer-interests.dto';
import { VolunteersService } from '../../volunteers/volunteers.service';
import { VOLUNTEER_INTEREST_TAG } from '../../volunteers/volunteer-record';
import { McpToolkit } from '../mcp-toolkit';

const safeVolunteerInterest = z
  .string()
  .max(40)
  .regex(
    VOLUNTEER_INTEREST_TAG,
    'Interest tags may contain letters, numbers, spaces, underscores, slashes and hyphens only',
  );

const volunteerStatus = z.enum(['PENDING_CONFIRMATION', 'ACTIVE', 'WITHDRAWN']);

export const listVolunteersParameters = z
  .object({
    status: volunteerStatus
      .or(z.literal('ALL'))
      .optional()
      .describe(
        'ACTIVE (default) are confirmed volunteers. PENDING_CONFIRMATION are unconfirmed sign-ups. WITHDRAWN opted out. ALL returns every status for this coop.',
      ),
    interest: safeVolunteerInterest.optional().describe('Keep rows that include this interest tag'),
    tag: safeVolunteerInterest.optional().describe('Alias of interest'),
    municipality: z.string().max(100).optional(),
    postalCode: z.string().max(12).optional(),
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

export const getVolunteerParameters = z
  .object({
    volunteerId: z.string().describe('Volunteer or sign-up id in this coop'),
  })
  .strict();

export const updateVolunteerParameters = z
  .object({
    volunteerId: z.string().describe('Volunteer or sign-up id in this coop'),
    status: volunteerStatus
      .optional()
      .describe(
        'WITHDRAWN records a withdrawal. ACTIVE and PENDING_CONFIRMATION are accepted only when that is already the status. Confirming a sign-up stays on the email link.',
      ),
    interests: z.array(safeVolunteerInterest).max(20).optional(),
    tags: z
      .array(safeVolunteerInterest)
      .max(20)
      .optional()
      .describe('Alias of interests. Must match interests when both are sent.'),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined || value.interests !== undefined || value.tags !== undefined,
    {
      message: 'Send a status, interests, or tags',
    },
  );

const interestOps = {
  interests: z
    .array(safeVolunteerInterest)
    .max(20)
    .optional()
    .describe(
      'Replace the ordered tags. An empty array restores flyers, stands, workshops, technical and admin, and does not add board.',
    ),
  add: z
    .array(safeVolunteerInterest)
    .max(20)
    .optional()
    .describe('Append tags that are not already listed'),
  rename: z
    .array(
      z
        .object({
          from: z.string().max(40),
          to: safeVolunteerInterest,
        })
        .strict(),
    )
    .max(20)
    .optional()
    .describe('Rename a form tag. Does not rewrite tags already stored on sign-ups.'),
  deactivate: z
    .array(z.string().max(40))
    .max(20)
    .optional()
    .describe('Remove tags from the form. Existing sign-ups keep the tag.'),
  reorder: z
    .array(safeVolunteerInterest)
    .max(20)
    .optional()
    .describe('The full current list in the new order'),
};

export const updateVolunteerInterestsParameters = z
  .object(interestOps)
  .strict()
  .refine(
    (value) =>
      value.interests !== undefined ||
      (value.add?.length ?? 0) > 0 ||
      (value.rename?.length ?? 0) > 0 ||
      (value.deactivate?.length ?? 0) > 0 ||
      (value.reorder?.length ?? 0) > 0,
    { message: 'Send a full list or at least one add, rename, deactivate, or reorder' },
  );

type ListVolunteersParams = z.infer<typeof listVolunteersParameters>;
type GetVolunteerParams = z.infer<typeof getVolunteerParameters>;
type UpdateVolunteerParams = z.infer<typeof updateVolunteerParameters>;
type UpdateVolunteerInterestsParams = z.infer<typeof updateVolunteerInterestsParameters>;

@Injectable()
export class McpVolunteerTools {
  constructor(
    private readonly volunteers: VolunteersService,
    private readonly toolkit: McpToolkit,
  ) {}

  // Mirrors GET admin/coops/:coopId/volunteers
  @Tool({
    name: 'list_volunteers',
    description:
      'List volunteers and unconfirmed sign-ups for this coop only. Filter by status, interest/tag, municipality or postcode. Paginated. Requires canViewVolunteers. Never includes the share register.',
    parameters: listVolunteersParameters,
  })
  async listVolunteers(params: ListVolunteersParams) {
    return this.toolkit.run(
      { permission: 'canViewVolunteers', dto: ListVolunteersQueryDto },
      params,
      async (ctx, dto) => this.volunteers.adminList(ctx.coopId, dto),
    );
  }

  // Mirrors GET admin/coops/:coopId/volunteers/:id
  @Tool({
    name: 'get_volunteer',
    description:
      'Get one volunteer or sign-up in this coop. Requires canViewVolunteers. An id from another coop is not found.',
    parameters: getVolunteerParameters,
  })
  async getVolunteer(params: GetVolunteerParams) {
    return this.toolkit.run({ permission: 'canViewVolunteers' }, params, async (ctx) =>
      this.volunteers.adminGet(ctx.coopId, params.volunteerId),
    );
  }

  // Mirrors GET admin/coops/:coopId/volunteers/interests
  @Tool({
    name: 'list_volunteer_interests',
    description:
      'List this coop’s sign-up form interest tags in form order, with nl, fr, de and en labels. Known tags (flyers, stands, workshops, technical, admin, board) are translated. Any other tag is shown as itself in every language. An empty configuration returns the five defaults and does not include board. Requires canViewVolunteers.',
    parameters: z.object({}).strict(),
  })
  async listVolunteerInterests() {
    return this.toolkit.run({ permission: 'canViewVolunteers' }, undefined, async (ctx) =>
      this.volunteers.adminInterestOptions(ctx.coopId),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/volunteers/:id
  @Tool({
    name: 'update_volunteer',
    description:
      'Update one volunteer or sign-up in this coop: replace interest tags with tags from this coop’s form, and/or set status to WITHDRAWN. Requires canViewVolunteers and a READ_WRITE key. Does not activate a sign-up or undo a withdrawal.',
    parameters: updateVolunteerParameters,
  })
  async updateVolunteer(params: UpdateVolunteerParams) {
    const { volunteerId, ...input } = params;
    return this.toolkit.run(
      { permission: 'canViewVolunteers', write: true, dto: UpdateVolunteerDto },
      input,
      async (ctx, dto) => this.volunteers.adminUpdate(ctx.coopId, volunteerId, dto, ctx.audit),
    );
  }

  // Mirrors PATCH admin/coops/:coopId/volunteers/interests
  @Tool({
    name: 'update_volunteer_interests',
    description:
      'Change this coop’s sign-up form tags: add, rename, reorder, deactivate, or replace the list. Labels for known tags are fixed (nl/fr/de/en); board is translated but is not a default. Deactivate removes a tag from the form and does not change tags stored on existing sign-ups. Rename does not rewrite those tags either. Requires both canViewVolunteers and canManageSettings, plus a READ_WRITE key. SYSTEM_ADMIN bypasses the permission check. Tag text cannot contain an apostrophe.',
    parameters: updateVolunteerInterestsParameters,
  })
  async updateVolunteerInterests(params: UpdateVolunteerInterestsParams) {
    return this.toolkit.run(
      {
        permission: ['canViewVolunteers', 'canManageSettings'],
        write: true,
        dto: UpdateVolunteerInterestsDto,
      },
      params,
      async (ctx, dto) => this.volunteers.adminUpdateInterests(ctx.coopId, dto, ctx.audit),
    );
  }
}
