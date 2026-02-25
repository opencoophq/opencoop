import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CreateMigrationRequestDto } from './dto/create-migration-request.dto';
import { MigrationRequestsService } from './migration-requests.service';

@ApiTags('Migration Requests')
@Controller('migration-requests')
export class MigrationRequestsController {
  constructor(private readonly migrationRequestsService: MigrationRequestsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Submit a migration request' })
  create(@Body() dto: CreateMigrationRequestDto) {
    return this.migrationRequestsService.create(dto);
  }
}
