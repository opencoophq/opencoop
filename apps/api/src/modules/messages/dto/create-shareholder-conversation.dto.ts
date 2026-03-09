import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShareholderConversationDto {
  @ApiProperty({ example: 'Vraag over mijn aandelen' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ example: 'Beste, ik heb een vraag...' })
  @IsString()
  @MinLength(1)
  body: string;
}
