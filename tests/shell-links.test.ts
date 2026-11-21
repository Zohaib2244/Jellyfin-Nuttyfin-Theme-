import { describe, expect, it } from 'vitest';
import { seerrSiteUrl } from '../src/ui/shell/accountmenu';

describe('Seerr link from the page origin', () => {
  it('uses the sibling host with the same scheme', () => {
    expect(seerrSiteUrl({ protocol: 'http:', hostname: 'nuttyfin.avns.nut' })).toBe('http://jellyseerr.avns.nut');
    expect(seerrSiteUrl({ protocol: 'https:', hostname: 'nuttyfin.avns.site' })).toBe('https://jellyseerr.avns.site');
  });
  it('leaves the link out when the host cannot say (dev, IPs, one-word hosts)', () => {
    expect(seerrSiteUrl({ protocol: 'http:', hostname: 'localhost' })).toBeNull();
    expect(seerrSiteUrl({ protocol: 'http:', hostname: '192.168.1.24' })).toBeNull();
    expect(seerrSiteUrl({ protocol: 'http:', hostname: '100.115.191.107' })).toBeNull();
    expect(seerrSiteUrl({ protocol: 'http:', hostname: 'avns2' })).toBeNull();
    expect(seerrSiteUrl({ protocol: 'http:', hostname: 'a.b' })).toBeNull();
  });
});
