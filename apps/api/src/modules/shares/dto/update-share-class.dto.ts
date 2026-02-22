import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateShareClassDto } from './create-share-class.dto';

export class UpdateShareClassDto extends PartialType(CreateShareClassDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
