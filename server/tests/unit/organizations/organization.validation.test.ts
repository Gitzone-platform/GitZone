import { describe, expect, it } from 'vitest';

import { createOrganizationSchema } from '../../../src/validations/organizations/organization.validation.js';

describe('Create organization validation', () => {
  it('accepts valid organization data', () => {
    const result = createOrganizationSchema.safeParse({
      slug: 'gitzone-platform',
      name: 'GitZone Platform',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.visibility).toBe('PUBLIC');
    }
  });

  it('rejects invalid slugs', () => {
    for (const slug of ['ABCD', 'a', '-invalid', 'bad--slug!', 'bad_slug']) {
      expect(
        createOrganizationSchema.safeParse({
          slug,
          name: 'Test',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects unexpected fields', () => {
    expect(
      createOrganizationSchema.safeParse({
        slug: 'test-org',
        name: 'Test',
        role: 'OWNER',
      }).success,
    ).toBe(false);
  });
});
