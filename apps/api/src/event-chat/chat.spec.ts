import { chatCapabilities } from './chat-authorization.service';
import { ChatHistoryQuery, parseChatDto, SendChatDto } from './chat.dto';
import { randomUUID } from 'node:crypto';

describe('Chat boundary contracts', () => {
  it('separates attendee, content, analyst and moderator capabilities across lifecycle states', () => {
    expect(chatCapabilities('ATTENDEE', true)).toEqual({
      read: true,
      send: true,
      moderate: false,
    });
    expect(chatCapabilities('ANALYST', true).send).toBe(false);
    expect(chatCapabilities('CONTENT_OPERATOR', true).moderate).toBe(false);
    expect(chatCapabilities('OPERATIONS_MANAGER', false)).toEqual({
      read: true,
      send: false,
      moderate: true,
    });
    expect(chatCapabilities('OPERATIONS_MANAGER', false, true)).toEqual({
      read: true,
      send: false,
      moderate: false,
    });
  });
  it('normalizes text and rejects role/sender claims, invalid IDs and unbounded input', () => {
    const valid = { clientMessageId: randomUUID(), text: ' hello ' };
    expect(parseChatDto(SendChatDto, valid).text).toBe('hello');
    for (const input of [
      null,
      [],
      { ...valid, role: 'ADMIN' },
      { ...valid, authorId: randomUUID() },
      { ...valid, text: ' ' },
      { ...valid, text: 'x'.repeat(2001) },
      { ...valid, clientMessageId: 'invalid' },
    ])
      expect(() => parseChatDto(SendChatDto, input)).toThrow();
    expect(() => parseChatDto(ChatHistoryQuery, { limit: 51 })).toThrow();
    expect(() => parseChatDto(ChatHistoryQuery, { before: -1 })).toThrow();
  });
});
