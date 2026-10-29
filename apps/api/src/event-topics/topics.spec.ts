import { topicCapabilities } from './topics.service';
import {
  CreateTopicDto,
  TopicQuery,
  TopicSettingsDto,
  parseTopicDto,
} from './topics.dto';
const enabled = {
  audiencePublishing: true,
  audienceReplies: true,
  moderationRequired: true,
};
describe('Event Topics capability and input boundaries', () => {
  it('keeps staff roles separate from attendee settings and moderation', () => {
    expect(topicCapabilities('VIEWER', 'LIVE', enabled)).toMatchObject({
      read: true,
      create: false,
      reply: false,
      moderate: false,
      configure: false,
      viewPending: false,
    });
    expect(
      topicCapabilities('CONTENT_OPERATOR', 'LIVE', enabled),
    ).toMatchObject({
      create: true,
      reply: true,
      publish: false,
      viewPending: false,
    });
    expect(
      topicCapabilities('OPERATIONS_MANAGER', 'LIVE', enabled),
    ).toMatchObject({
      moderate: true,
      configure: true,
      publish: true,
      viewPending: true,
    });
    const closed = {
      ...enabled,
      audiencePublishing: false,
      audienceReplies: false,
    };
    expect(topicCapabilities('ATTENDEE', 'LIVE', closed)).toMatchObject({
      create: false,
      reply: false,
    });
    expect(topicCapabilities('CONTENT_OPERATOR', 'LIVE', closed)).toMatchObject(
      { create: true, reply: true },
    );
  });
  it('retains archived pending visibility while forbidding writes and lifecycle configuration', () => {
    expect(topicCapabilities('ADMIN', 'ARCHIVED', enabled)).toMatchObject({
      read: true,
      viewPending: true,
      create: false,
      reply: false,
      moderate: false,
      configure: false,
    });
    expect(topicCapabilities('ADMIN', 'COMPLETED', enabled)).toMatchObject({
      moderate: true,
      create: false,
      configure: false,
    });
    expect(topicCapabilities('ADMIN', 'DRAFT', enabled)).toMatchObject({
      configure: true,
      create: false,
    });
  });
  it('rejects forged fields and malformed/versionless requests at the service boundary', () => {
    expect(() =>
      parseTopicDto(CreateTopicDto, {
        text: 'valid',
        clientOperationId: 'bad',
      }),
    ).toThrow();
    expect(() => parseTopicDto(TopicQuery, { limit: 51 })).toThrow();
    expect(() =>
      parseTopicDto(TopicSettingsDto, { ...enabled, expectedRevision: '0' }),
    ).toThrow();
    expect(() =>
      parseTopicDto(TopicSettingsDto, {
        ...enabled,
        expectedRevision: 0,
        role: 'ADMIN',
      }),
    ).toThrow();
    expect(parseTopicDto(TopicQuery, { limit: '5' }).limit).toBe(5);
    expect(
      parseTopicDto(CreateTopicDto, {
        text: '  hello  ',
        clientOperationId: '11111111-1111-4111-8111-111111111111',
      }).text,
    ).toBe('hello');
  });
});
