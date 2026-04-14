import { PartialType } from '@nestjs/swagger';
import { CreateAgendaItemDto } from './create-agenda-item.dto';

export class UpdateAgendaItemDto extends PartialType(CreateAgendaItemDto) {}
