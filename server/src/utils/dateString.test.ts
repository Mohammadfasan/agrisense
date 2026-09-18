import { describe, expect, it } from 'vitest';

import { addDays, diffDays, isBefore, todayInColombo } from './dateString';

/**
 * Unit tests for day arithmetic. No database, no clock beyond the one this
 * file injects.
 *
 * The cases that matter are the ones where an implementation that goes through
 * local time still passes on a developer's machine and fails in a field:
 * month and year rollover, February in a leap year and in the year either side
 * of it, and the 18:30 UTC boundary where Colombo is already on the next day.
 *
 * Written for Vitest rather than Jest — it is what the rest of this workspace
 * runs (`npm test --workspace server`). The API used here is the same.
 */
describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-06-10', 5)).toBe('2026-06-15');
  });

  it('adds zero days', () => {
    expect(addDays('2026-06-10', 0)).toBe('2026-06-10');
  });

  it('subtracts', () => {
    expect(addDays('2026-06-10', -5)).toBe('2026-06-05');
  });

  describe('month rollover', () => {
    it('crosses a 30-day month end', () => {
      expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    });

    it('crosses a 31-day month end', () => {
      expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
    });

    it('rolls backwards into the previous month', () => {
      expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
    });

    it('skips whole months when the offset is long enough', () => {
      // A paddy season: sown 1 May, harvested on day 115.
      expect(addDays('2026-05-01', 115)).toBe('2026-08-24');
    });
  });

  describe('year rollover', () => {
    it('crosses new year', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('rolls backwards across new year', () => {
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('crosses a year end mid-season', () => {
      // Maha season chilli: transplanted in November, last picking day 120.
      expect(addDays('2026-11-15', 120)).toBe('2027-03-15');
    });
  });

  describe('leap years', () => {
    it('lands on 29 February in a leap year', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    });

    it('steps over 29 February into March', () => {
      expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    });

    it('skips 29 February in a common year', () => {
      expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    });

    it('treats 2100 as a common year, which the 4-year rule alone does not', () => {
      expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    });

    it('treats 2000 as a leap year, which the 100-year rule alone does not', () => {
      expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    });

    it('adds a year across a leap day', () => {
      // 366 days, because 2028 is a leap year and the span contains 29 Feb.
      expect(addDays('2028-01-01', 366)).toBe('2029-01-01');
    });
  });

  it('rejects a day that does not exist', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });

  it('rejects a fractional offset', () => {
    expect(() => addDays('2026-06-10', 1.5)).toThrow(RangeError);
  });
});

describe('diffDays', () => {
  it('counts forwards', () => {
    expect(diffDays('2026-06-10', '2026-06-12')).toBe(2);
  });

  it('counts backwards as a negative', () => {
    expect(diffDays('2026-06-12', '2026-06-10')).toBe(-2);
  });

  it('is zero for the same day', () => {
    expect(diffDays('2026-06-10', '2026-06-10')).toBe(0);
  });

  it('counts across a month end', () => {
    expect(diffDays('2026-04-28', '2026-05-03')).toBe(5);
  });

  it('counts across a year end', () => {
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('counts 366 days across a leap year', () => {
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('counts 365 days across a common year', () => {
    expect(diffDays('2029-01-01', '2030-01-01')).toBe(365);
  });

  it('counts the leap day itself', () => {
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('counts a common February as one day shorter', () => {
    expect(diffDays('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('is the exact inverse of addDays over a long span', () => {
    const sown = '2026-11-15';
    const due = addDays(sown, 120);

    expect(diffDays(sown, due)).toBe(120);
  });

  it('returns whole days, never a fraction', () => {
    // The failure this guards is an implementation that parses to local
    // midnight: a half-hour offset would leave a remainder here.
    expect(Number.isInteger(diffDays('2026-01-01', '2026-12-31'))).toBe(true);
  });

  it('rejects a day that does not exist', () => {
    expect(() => diffDays('2026-06-10', '2025-02-29')).toThrow(RangeError);
  });
});

describe('isBefore', () => {
  it('is true for an earlier day', () => {
    expect(isBefore('2026-06-10', '2026-06-11')).toBe(true);
  });

  it('is false for a later day', () => {
    expect(isBefore('2026-06-11', '2026-06-10')).toBe(false);
  });

  it('is false for the same day, so it is strict', () => {
    expect(isBefore('2026-06-10', '2026-06-10')).toBe(false);
  });

  it('compares across a month boundary', () => {
    expect(isBefore('2026-04-30', '2026-05-01')).toBe(true);
  });

  it('compares across a year boundary', () => {
    expect(isBefore('2026-12-31', '2027-01-01')).toBe(true);
  });

  it('orders by day rather than by text length or month digits', () => {
    // '2026-09-01' < '2026-10-01' lexically as well as chronologically, which
    // is the property the MongoDB range queries depend on. A format without
    // the zero padding would fail this.
    expect(isBefore('2026-09-01', '2026-10-01')).toBe(true);
    expect(isBefore('2026-10-01', '2026-09-01')).toBe(false);
  });

  it('rejects a malformed day rather than answering confidently', () => {
    expect(() => isBefore('10-06-2026', '2026-06-11')).toThrow(RangeError);
  });
});

describe('todayInColombo', () => {
  it('is the same day as UTC during the working day', () => {
    expect(todayInColombo(new Date('2026-06-10T09:00:00.000Z'))).toBe('2026-06-10');
  });

  it('is already tomorrow after 18:30 UTC', () => {
    // 00:00 on the 11th in Colombo. This is the case that puts a farmer's
    // task on the wrong day if "today" is read in UTC.
    expect(todayInColombo(new Date('2026-06-10T18:30:00.000Z'))).toBe('2026-06-11');
  });

  it('is still today one minute before the boundary', () => {
    expect(todayInColombo(new Date('2026-06-10T18:29:59.999Z'))).toBe('2026-06-10');
  });

  it('crosses a month end at the boundary, not at UTC midnight', () => {
    expect(todayInColombo(new Date('2026-04-30T18:30:00.000Z'))).toBe('2026-05-01');
  });

  it('crosses a year end at the boundary', () => {
    expect(todayInColombo(new Date('2026-12-31T18:30:00.000Z'))).toBe('2027-01-01');
  });

  it('crosses into a leap day at the boundary', () => {
    expect(todayInColombo(new Date('2028-02-28T18:30:00.000Z'))).toBe('2028-02-29');
  });

  it('returns a day the rest of this module accepts', () => {
    expect(() => addDays(todayInColombo(), 1)).not.toThrow();
  });
});
