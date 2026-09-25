import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScheduleConversationDto {
  @ApiProperty({ example: '2026-09-15T08:00:00.000Z', description: 'UTC instant, at least 60 s in the future' })
  @IsISO8601({ strict: true })
  scheduledAt: string;
}
