import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ProxyResolveDto {
  @ApiProperty({ example: 'Jan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Peeters' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;
}
