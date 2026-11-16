import { describe, expect, it } from 'vitest';
import { buildAuthHeader, detectDeviceName } from '../src/api/auth';

describe('buildAuthHeader', () => {
  const base = { client: 'Nuttyfin', device: 'Chrome', deviceId: 'abc-123', version: '0.1.0' };

  it('builds the MediaBrowser header without a token (sign-in calls)', () => {
    expect(buildAuthHeader(base)).toBe('MediaBrowser Client="Nuttyfin", Device="Chrome", DeviceId="abc-123", Version="0.1.0"');
  });

  it('appends the token once signed in', () => {
    expect(buildAuthHeader({ ...base, token: 'tok' })).toBe('MediaBrowser Client="Nuttyfin", Device="Chrome", DeviceId="abc-123", Version="0.1.0", Token="tok"');
  });

  it('cannot be broken out of by quotes or newlines in values', () => {
    const h = buildAuthHeader({ ...base, device: 'Ch"rome\r\nX-Evil: 1' });
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/"/g)?.length).toBe(8);
  });
});

describe('detectDeviceName', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Chrome'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', 'Safari'],
    ['', 'Browser'],
  ])('%s', (ua, name) => expect(detectDeviceName(ua)).toBe(name));
});
