import { BadRequestException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';

export function assertEventNotArchived(status: EventStatus) {
  if (status === EventStatus.ARCHIVED) {
    throw new BadRequestException('Archived events are read-only.');
  }
}
