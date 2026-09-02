import { isAllowedRequestOrigin } from './request-origin';

describe('isAllowedRequestOrigin', () => {
  const apiOrigin = 'https://api.opspilot.example';
  const webOrigin = 'https://opspilot.example';

  it('allows safe requests regardless of origin', () => {
    expect(
      isAllowedRequestOrigin(
        'GET',
        'https://untrusted.example',
        apiOrigin,
        webOrigin,
      ),
    ).toBe(true);
  });

  it('allows service requests without a browser origin', () => {
    expect(
      isAllowedRequestOrigin('POST', undefined, apiOrigin, webOrigin),
    ).toBe(true);
  });

  it('allows mutations from the web app and API documentation', () => {
    expect(
      isAllowedRequestOrigin('POST', webOrigin, apiOrigin, webOrigin),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin('PATCH', apiOrigin, apiOrigin, webOrigin),
    ).toBe(true);
  });

  it('rejects browser mutations from another origin', () => {
    expect(
      isAllowedRequestOrigin(
        'DELETE',
        'https://untrusted.example',
        apiOrigin,
        webOrigin,
      ),
    ).toBe(false);
  });
});
