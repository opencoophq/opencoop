jest.mock('../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));

import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { VolunteersAdminController } from './volunteers-admin.controller';

describe('VolunteersAdminController permissions', () => {
  it('requires canViewVolunteers on the controller, so a user without it gets nothing', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, VolunteersAdminController)).toEqual([
      'canViewVolunteers',
    ]);
  });

  it('requires canViewVolunteers and canManageSettings to change the form options', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, VolunteersAdminController.prototype.updateInterests),
    ).toEqual(['canViewVolunteers', 'canManageSettings']);
  });
});
