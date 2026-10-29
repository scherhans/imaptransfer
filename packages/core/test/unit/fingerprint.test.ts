import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprint, parseHeaders, summarizeHeaders } from '../../src/fingerprint.ts';

const base = [
  'Message-ID: <ABC.123@example.com>',
  'Date: Mon, 03 Jun 2024 10:00:00 +0200',
  'From: "Anna Beispiel" <anna@example.com>',
  'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_Berlin?=',
].join('\r\n');

describe('parseHeaders', () => {
  it('unfolds continuation lines and keeps the first value of a field', () => {
    const headers = parseHeaders('Subject: first\r\n  part\r\nSubject: second\r\n\r\nbody: not a header');
    assert.equal(headers.get('subject'), 'first part');
    assert.equal(headers.has('body'), false);
  });
});

describe('fingerprint', () => {
  it('is stable across folding, encoding and date notation', () => {
    const reencoded = [
      'message-id:   <abc.123@example.com>',
      'Date: Mon, 3 Jun 2024 08:00:00 +0000 (UTC)',
      'From: anna@example.com',
      'Subject: =?ISO-8859-1?B?R3L832UgYXVz?=',
      ' Berlin',
    ].join('\r\n');
    assert.equal(fingerprint({ headers: base }), fingerprint({ headers: reencoded }));
  });

  it('accepts raw UTF-8 headers as equal to encoded words', () => {
    const raw = Buffer.from(base.replace('=?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_Berlin?=', 'Grüße aus Berlin'), 'utf8');
    assert.equal(fingerprint({ headers: base }), fingerprint({ headers: raw }));
  });

  it('separates messages that differ in subject or sender', () => {
    assert.notEqual(fingerprint({ headers: base }), fingerprint({ headers: base.replace('Berlin', 'Hamburg') }));
    assert.notEqual(fingerprint({ headers: base }), fingerprint({ headers: base.replace('anna@', 'bert@') }));
  });

  it('keeps apart messages without Message-ID by their arrival time', () => {
    const headers = 'From: printer@example.com\r\nSubject: Scan';
    const first = fingerprint({ headers, size: 100, internalDate: new Date('2024-01-01T10:00:00.400Z') });
    const sameSecond = fingerprint({ headers, size: 999, internalDate: '2024-01-01T10:00:00.000Z' });
    const later = fingerprint({ headers, size: 100, internalDate: new Date('2025-01-01T10:00:00Z') });
    assert.equal(first, sameSecond);
    assert.notEqual(first, later);
    // With a Message-ID the arrival time does not matter: a restore may differ there.
    assert.equal(fingerprint({ headers: base, internalDate: new Date(0) }), fingerprint({ headers: base, internalDate: new Date() }));
  });

  it('reads dates without time zone the same on every computer', () => {
    const previous = process.env.TZ;
    const headers = 'Date: Mon, 3 Jun 2024 10:00:00\r\nFrom: a@example.com\r\nSubject: x';
    try {
      process.env.TZ = 'America/Los_Angeles';
      const west = fingerprint({ headers, internalDate: new Date(0) });
      process.env.TZ = 'Asia/Tokyo';
      const east = fingerprint({ headers, internalDate: new Date(0) });
      assert.equal(west, east);
      assert.equal(summarizeHeaders('Date: Mon Jun  3 10:00:00 2024').date, '2024-06-03T10:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('falls back to size and internal date for messages without identifying headers', () => {
    const a = fingerprint({ headers: 'X-Other: 1', size: 10, internalDate: new Date('2024-01-01T00:00:00Z') });
    const b = fingerprint({ headers: 'X-Other: 2', size: 10, internalDate: '2024-01-01T00:00:00.000Z' });
    const c = fingerprint({ headers: '', size: 11, internalDate: new Date('2024-01-01T00:00:00Z') });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe('summarizeHeaders', () => {
  it('decodes subject and sender for display', () => {
    const summary = summarizeHeaders(base);
    assert.equal(summary.subject, 'Grüße aus Berlin');
    assert.equal(summary.from, '"Anna Beispiel" <anna@example.com>');
    assert.equal(summary.date, '2024-06-03T08:00:00.000Z');
    assert.equal(summary.messageId, '<ABC.123@example.com>');
  });
});
