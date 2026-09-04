import { LivePollStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export type LivePollTargetStatus =
  typeof LivePollStatus.OPEN | typeof LivePollStatus.CLOSED;

export class TransitionLivePollDto {
  @IsIn([LivePollStatus.OPEN, LivePollStatus.CLOSED])
  status!: LivePollTargetStatus;
}
