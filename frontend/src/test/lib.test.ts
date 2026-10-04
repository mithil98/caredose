import { describe, expect, it } from 'vitest'
import { suggestPeriod } from '../components/forms'
import { fmtClock, fmtDays, fmtQty, plainTitle, tzOptions } from '../lib/format'
import { base64UrlToBytes } from '../lib/push'
import { backoff } from '../lib/realtime'

describe('formatting', () => {
  it('summarises days of week', () => {
    expect(fmtDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day')
    expect(fmtDays([5, 4, 3, 2, 1])).toBe('Weekdays')
    expect(fmtDays([6, 7])).toBe('Weekends')
    expect(fmtDays([1, 3, 5])).toBe('Mon, Wed, Fri')
  })

  it('pluralises dose units', () => {
    expect(fmtQty('1.00', 'tablet')).toBe('1 tablet')
    expect(fmtQty('2', 'tablet')).toBe('2 tablets')
    expect(fmtQty('0.5', 'ml')).toBe('0.5 ml')
    expect(fmtQty('2', 'drops')).toBe('2 drops')
  })

  it('formats clock times and strips emoji from push titles', () => {
    expect(fmtClock('20:00:00')).toMatch(/8:00\s?PM/i)
    expect(plainTitle('💊 Medicine Due')).toBe('Medicine Due')
    expect(plainTitle('⚠️ Medicine Missed')).toBe('Medicine Missed')
  })

  it('always offers the saved timezone', () => {
    expect(tzOptions('Asia/Kolkata')).toContain('Asia/Kolkata')
    expect(tzOptions('Asia/Calcutta')[0]).toBe('Asia/Calcutta')
  })
})

describe('schedule period suggestion', () => {
  it.each([
    ['08:00', 'morning'],
    ['13:00', 'afternoon'],
    ['18:30', 'evening'],
    ['20:00', 'night'],
    ['02:00', 'night'],
  ])('%s is %s', (time, period) => expect(suggestPeriod(time)).toBe(period))
})

describe('push helpers', () => {
  it('decodes base64url VAPID keys to bytes', () => {
    const bytes = base64UrlToBytes('BAEC_-8')
    expect(Array.from(bytes)).toEqual([4, 1, 2, 255, 239])
  })
})

describe('websocket reconnect backoff', () => {
  it('grows exponentially and is capped at 30s (with jitter)', () => {
    expect(backoff(0)).toBeGreaterThanOrEqual(750)
    expect(backoff(0)).toBeLessThanOrEqual(1250)
    expect(backoff(3)).toBeGreaterThanOrEqual(6000)
    expect(backoff(20)).toBeLessThanOrEqual(37_500)
  })
})
