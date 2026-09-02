import { LiveSessionUpdateSeverity } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLiveSessionUpdateDto {
  @IsEnum(LiveSessionUpdateSeverity)
  severity!: LiveSessionUpdateSeverity;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  message!: string;
}
