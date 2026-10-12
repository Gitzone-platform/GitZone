import { describe, expect, it } from 'vitest';

import {
  organizationSlugSchema,
  updateOrganizationProfileSchema,
} from '../../../src/validations/organizations/organization.validation.js';

describe('Organization profile validation', () => {
  it('accepts a valid profile update', () => {
    const result = updateOrganizationProfileSchema.safeParse({
      name: 'GitZone Platform',
      description: 'Developer collaboration',
      website: 'https://gitzone.example',
    });

    expect(result.success).toBe(true);
  });

  it('rejects empty updates', () => {
    expect(updateOrganizationProfileSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unauthorized fields', () => {
    for (const field of ['slug', 'visibility', 'role']) {
      expect(
        updateOrganizationProfileSchema.safeParse({
          name: 'GitZone',
          [field]: 'PRIVATE',
        }).success,
      ).toBe(false);
    }
  });

  it('requires safe HTTPS website URLs', () => {
    for (const website of [
      'http://example.com',
      'https://user:password@example.com',
      'javascript:alert(1)',
    ]) {
      expect(
        updateOrganizationProfileSchema.safeParse({
          website,
        }).success,
      ).toBe(false);
    }
  });

  it('validates organization slugs', () => {
    expect(organizationSlugSchema.safeParse('gitzone-platform').success).toBe(true);
    expect(organizationSlugSchema.safeParse('INVALID_SLUG').success).toBe(false);
  });
});
