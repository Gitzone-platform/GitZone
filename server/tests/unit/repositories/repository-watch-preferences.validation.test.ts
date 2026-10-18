import { describe, expect, it } from 'vitest';

import {
  repositoryWatchPreferenceSchema,
  updateRepositoryWatchPreferencesSchema,
} from '../../../src/validations/repositories/repository-watch-preferences.validation.js';

describe('repository watch preferences validation', () => {
  it.each(['ALL', 'PARTICIPATING', 'IGNORE'] as const)('accepts %s', (preference) => {
    expect(updateRepositoryWatchPreferencesSchema.parse({ preference })).toEqual({ preference });

    expect(repositoryWatchPreferenceSchema.parse(preference)).toBe(preference);
  });

  it.each([
    {},
    { preference: 'UNKNOWN' },
    { preference: 'all' },
    { preference: '' },
    { preference: null },
    { preference: 1 },
    { preference: true },
    { preference: ['ALL'] },
    { preference: 'ALL', unexpected: true },
  ])('rejects invalid request body %#', (body) => {
    expect(updateRepositoryWatchPreferencesSchema.safeParse(body).success).toBe(false);
  });

  it('rejects undefined and null request bodies', () => {
    expect(updateRepositoryWatchPreferencesSchema.safeParse(undefined).success).toBe(false);

    expect(updateRepositoryWatchPreferencesSchema.safeParse(null).success).toBe(false);
  });
});
