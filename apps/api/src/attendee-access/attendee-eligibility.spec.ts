import { AccessMode, EventStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertAccessPolicyDto } from '../access-policies/dto/upsert-access-policy.dto';
import {
  attendeeEventView,
  canonicalDomain,
  isAttendeeEligible,
  matchesEmailDomain,
} from './attendee-eligibility';

describe('Restricted attendee eligibility', () => {
  it.each([
    'person@sub.example.com',
    'person@notexample.com',
    'person@example.com.evil.test',
    'person@evil.test',
    'person@example.com.',
    'person@%65xample.com',
  ])('rejects non-matching email domain %s', (email) => {
    expect(matchesEmailDomain(email, ['example.com'])).toBe(false);
  });

  it('matches exact normalised domains including internationalised names', () => {
    expect(matchesEmailDomain('PERSON@EXAMPLE.COM', [' EXAMPLE.com '])).toBe(
      true,
    );
    expect(
      matchesEmailDomain('person@b\u00fccher.de', ['xn--bcher-kva.de']),
    ).toBe(true);
    expect(matchesEmailDomain('person@example.com', [])).toBe(false);
  });

  it.each([
    'example.com/path',
    'https://example.com',
    'example.com?x=y',
    'example.com#x',
    '%65xample.com',
    'example.com:443',
    'name@example.com',
  ])('does not silently turn %s into a domain', (domain) => {
    expect(canonicalDomain(domain)).toBe('');
  });

  it('rejects malformed domains in the request DTO', async () => {
    const dto = plainToInstance(UpsertAccessPolicyDto, {
      mode: 'EMAIL_DOMAIN',
      allowedDomains: ['bad..test', '-example.test', 'example.com/path'],
      requiresConsent: true,
      collectCompany: false,
      collectJobTitle: false,
    });
    expect(
      (await validate(dto)).some(
        (error) => error.property === 'allowedDomains',
      ),
    ).toBe(true);
  });

  it('checks the exact event/email invitation and rejects revoked or missing invitations', async () => {
    const lookup = jest.fn().mockResolvedValue({ revokedAt: null });
    const database = {
      eventInvitation: { findUnique: lookup },
    } as unknown as Prisma.TransactionClient;
    const event = {
      id: 'event-1',
      status: EventStatus.READY,
      accessPolicy: { mode: AccessMode.INVITE_ONLY, allowedDomains: [] },
    };
    expect(
      await isAttendeeEligible(database, event, ' Guest@Example.test '),
    ).toBe(true);
    expect(lookup).toHaveBeenCalledWith({
      where: {
        eventId_email: { eventId: 'event-1', email: 'guest@example.test' },
      },
      select: { revokedAt: true },
    });
    lookup.mockResolvedValue({ revokedAt: new Date() });
    expect(
      await isAttendeeEligible(database, event, 'guest@example.test'),
    ).toBe(false);
    lookup.mockResolvedValue(null);
    expect(
      await isAttendeeEligible(database, event, 'guest@example.test'),
    ).toBe(false);
    expect(
      await isAttendeeEligible(
        database,
        { ...event, status: EventStatus.COMPLETED },
        'guest@example.test',
      ),
    ).toBe(false);
  });

  it('redacts restricted event details and never exposes the allowed-domain list', () => {
    const event = {
      id: 'event',
      title: 'Private title',
      description: 'Private description',
      status: EventStatus.READY,
      scheduledStart: new Date(),
      scheduledEnd: new Date(),
      timezone: 'Europe/London',
      workspace: { name: 'Private organiser' },
      accessPolicy: {
        mode: AccessMode.EMAIL_DOMAIN,
        allowedDomains: ['private.test'],
        requiresConsent: true,
        collectCompany: false,
        collectJobTitle: false,
      },
    };
    const anonymous = attendeeEventView(event);
    expect(anonymous).toEqual({
      id: 'event',
      restricted: true,
      registrationOpen: true,
      policy: {
        mode: 'EMAIL_DOMAIN',
        requiresConsent: true,
        collectCompany: false,
        collectJobTitle: false,
      },
    });
    expect(attendeeEventView(event, true)).toMatchObject({
      title: 'Private title',
      organiser: 'Private organiser',
      restricted: false,
    });
    expect(JSON.stringify(attendeeEventView(event, true))).not.toContain(
      'private.test',
    );
  });
});
