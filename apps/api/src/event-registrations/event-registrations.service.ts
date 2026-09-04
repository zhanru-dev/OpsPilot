import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessMode, EventStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AttendeeAccessService } from '../attendee-access/attendee-access.service';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRegistrationDto } from './dto/create-registration.dto';
import {
  attendeeEventSelect,
  attendeeEventView,
  isAttendeeEligible,
} from '../attendee-access/attendee-eligibility';

const publicModes = [
  AccessMode.PUBLIC,
  AccessMode.REGISTRATION,
  AccessMode.EMAIL_DOMAIN,
  AccessMode.INVITE_ONLY,
];
const registrationStates: EventStatus[] = [EventStatus.READY, EventStatus.LIVE];
const consentVersion = 'event-registration-v1';
const pageSize = 25;

@Injectable()
export class EventRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domainEvents: DomainEventsService,
    private readonly attendeeAccess: AttendeeAccessService,
  ) {}

  async publicEvent(eventId: string) {
    const event = await this.prisma.streamEvent.findFirst({
      where: {
        id: eventId,
        status: { in: [...registrationStates, EventStatus.COMPLETED] },
        accessPolicy: { mode: { in: publicModes } },
      },
      select: attendeeEventSelect,
    });
    if (!event || !event.accessPolicy)
      throw new NotFoundException('Event registration is unavailable.');
    return attendeeEventView(event);
  }

  async register(eventId: string, dto: CreateRegistrationDto) {
    const email = dto.email.trim().toLowerCase();
    await this.prisma.$transaction(async (transaction) => {
      // Completion and registration must agree on the event lifecycle state.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "StreamEvent" WHERE "id" = ${eventId} FOR UPDATE
      `);
      const event = await transaction.streamEvent.findFirst({
        where: {
          id: eventId,
          status: { in: registrationStates },
          accessPolicy: { mode: { in: publicModes } },
        },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          accessPolicy: true,
        },
      });
      if (!event?.accessPolicy)
        throw new NotFoundException('Event registration is unavailable.');
      const policy = event.accessPolicy;
      if (policy.requiresConsent && dto.consent !== true) {
        throw new BadRequestException(
          'Consent is required to register for this event.',
        );
      }
      if (!policy.collectCompany && dto.company) {
        throw new BadRequestException(
          'This event does not collect company details.',
        );
      }
      if (!policy.collectJobTitle && dto.jobTitle) {
        throw new BadRequestException(
          'This event does not collect job titles.',
        );
      }
      this.attendeeAccess.assertEnabled();
      // A receipt must not disclose whether this address is invited or eligible.
      if (!(await isAttendeeEligible(transaction, event, email))) return;
      const existing = await transaction.eventRegistration.findUnique({
        where: { eventId_email: { eventId, email } },
        select: { id: true },
      });
      // A repeated request neither reveals nor overwrites another registration.
      if (existing) {
        await this.attendeeAccess.enqueue(existing.id, transaction);
        return;
      }
      const registration = await transaction.eventRegistration.create({
        data: {
          eventId,
          email,
          name: dto.name.trim(),
          company: policy.collectCompany ? dto.company?.trim() || null : null,
          jobTitle: policy.collectJobTitle
            ? dto.jobTitle?.trim() || null
            : null,
          consentedAt: dto.consent ? new Date() : null,
          consentVersion: dto.consent ? consentVersion : null,
        },
        select: { id: true },
      });
      await this.attendeeAccess.enqueue(registration.id, transaction);
      await this.audit.record(
        {
          workspaceId: event.workspaceId,
          eventId,
          action: 'event_registration.received',
          entityType: 'EventRegistration',
          entityId: registration.id,
          summary: 'Received an attendee registration.',
        },
        transaction,
      );
      await this.domainEvents.record(
        {
          workspaceId: event.workspaceId,
          type: 'event-registration.received',
          aggregateType: 'StreamEvent',
          aggregateId: eventId,
          payload: { eventId, registrationId: registration.id },
        },
        transaction,
      );
    });
    return { status: 'RECEIVED' as const };
  }

  async list(eventId: string, page: number, user: AuthenticatedUser) {
    const event = await this.prisma.streamEvent.findFirst({
      where: { id: eventId, workspaceId: user.workspaceId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Stream event was not found.');
    const where = { eventId, event: { workspaceId: user.workspaceId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.eventRegistration.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          jobTitle: true,
          emailVerifiedAt: true,
          consentedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.eventRegistration.count({ where }),
    ]);
    return { event, items, total, page, pageSize };
  }
}
