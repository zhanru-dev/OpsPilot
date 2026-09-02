import { EventStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class TransitionEventDto {
  @IsEnum(EventStatus)
  status!: EventStatus;
}
