'use strict';

const {
  DisabledGoogleCalendarAdapter, MockGoogleCalendarAdapter,
} = require('../core/integrations/googleCalendar/googleCalendarAdapter');
const {
  DisabledStorageProvider, MockStorageProvider,
} = require('../core/storage/storageProvider');

describe('GoogleCalendarAdapter (unit)', () => {
  test('DisabledGoogleCalendarAdapter reports not_configured rather than throwing or fabricating an event', async () => {
    const result = await new DisabledGoogleCalendarAdapter().createEvent({ summary: 'Anything' });
    expect(result.status).toBe('not_configured');
    expect(result.provider).toBe('none');
    expect(result.eventId).toBeNull();
    expect(result.htmlLink).toBeNull();

    const cancelResult = await new DisabledGoogleCalendarAdapter().cancelEvent('any-id');
    expect(cancelResult.status).toBe('not_configured');
  });

  test('MockGoogleCalendarAdapter clearly labels its output as a mock event', async () => {
    const result = await new MockGoogleCalendarAdapter().createEvent({ summary: 'Kickoff call' });
    expect(result.status).toBe('created');
    expect(result.provider).toBe('mock');
    expect(result.eventId).toMatch(/^mock_gcal_evt_/);
    expect(result.htmlLink).toMatch(/^https:\/\/mock\.calendar\.test\//);

    const cancelResult = await new MockGoogleCalendarAdapter().cancelEvent(result.eventId);
    expect(cancelResult.status).toBe('cancelled');
    expect(cancelResult.provider).toBe('mock');
  });
});

describe('StorageProvider / GCS adapter (unit)', () => {
  test('DisabledStorageProvider rejects every operation instead of silently succeeding', async () => {
    const provider = new DisabledStorageProvider();
    await expect(provider.upload({ key: 'x', buffer: Buffer.from('x'), contentType: 'text/plain' })).rejects.toThrow(/not configured/i);
    await expect(provider.getSignedUrl('x')).rejects.toThrow(/not configured/i);
    await expect(provider.delete('x')).rejects.toThrow(/not configured/i);
  });

  test('MockStorageProvider simulates upload/signed-url/delete without any real network call', async () => {
    const provider = new MockStorageProvider();
    const uploadResult = await provider.upload({ key: 'orgs/123/file.png', buffer: Buffer.from('fake-image-bytes'), contentType: 'image/png' });
    expect(uploadResult.key).toBe('orgs/123/file.png');
    expect(uploadResult.provider).toBe('mock');

    const signed = await provider.getSignedUrl(uploadResult.key, { expiresInSeconds: 60 });
    expect(signed.url).toMatch(/^https:\/\/mock\.storage\.test\/signed\//);
    expect(signed.expiresInSeconds).toBe(60);

    const deleteResult = await provider.delete(uploadResult.key);
    expect(deleteResult.deleted).toBe(true);
  });

  test('MockStorageProvider generates a clearly-labeled key when none is supplied', async () => {
    const provider = new MockStorageProvider();
    const uploadResult = await provider.upload({ buffer: Buffer.from('x'), contentType: 'text/plain' });
    expect(uploadResult.key).toMatch(/^mock_key_/);
  });
});
