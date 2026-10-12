import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedFindOrganization, mockedFindMembership, mockedUpdateOrganization } = vi.hoisted(
  () => ({
    mockedFindOrganization: vi.fn(),
    mockedFindMembership: vi.fn(),
    mockedUpdateOrganization: vi.fn(),
  }),
);

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mockedFindOrganization,
      update: mockedUpdateOrganization,
    },
    organizationMember: {
      findUnique: mockedFindMembership,
    },
  },
}));

const { getOrganizationProfile, updateOrganizationProfile } =
  await import('../../../src/services/organizations/organization.service.js');

const publicOrganization = {
  id: 'org-1',
  slug: 'gitzone-platform',
  name: 'GitZone Platform',
  description: null,
  avatarUrl: null,
  website: null,
  visibility: 'PUBLIC',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Organization profile service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('allows anonymous users to read public profiles', async () => {
    mockedFindOrganization.mockResolvedValue(publicOrganization);

    const result = await getOrganizationProfile('gitzone-platform');

    expect(result).toMatchObject({
      id: 'org-1',
      visibility: 'PUBLIC',
    });

    expect(mockedFindMembership).not.toHaveBeenCalled();
  });

  it('hides private organizations from anonymous users', async () => {
    mockedFindOrganization.mockResolvedValue({
      ...publicOrganization,
      visibility: 'PRIVATE',
    });

    await expect(getOrganizationProfile('gitzone-platform')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });
  });

  it('hides private organizations from non-members', async () => {
    mockedFindOrganization.mockResolvedValue({
      ...publicOrganization,
      visibility: 'PRIVATE',
    });

    mockedFindMembership.mockResolvedValue(null);

    await expect(getOrganizationProfile('gitzone-platform', 'outsider-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });
  });

  it('allows members to read private organization profiles', async () => {
    mockedFindOrganization.mockResolvedValue({
      ...publicOrganization,
      visibility: 'PRIVATE',
    });

    mockedFindMembership.mockResolvedValue({ id: 'membership-1' });

    await expect(getOrganizationProfile('gitzone-platform', 'member-1')).resolves.toMatchObject({
      id: 'org-1',
      visibility: 'PRIVATE',
    });
  });

  it('returns 404 for unknown organizations', async () => {
    mockedFindOrganization.mockResolvedValue(null);

    await expect(getOrganizationProfile('missing-org')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });
  });

  it('rejects profile updates from non-owners', async () => {
    mockedFindOrganization.mockResolvedValue({ id: 'org-1' });
    mockedFindMembership.mockResolvedValue({ role: 'MEMBER' });

    await expect(
      updateOrganizationProfile('gitzone-platform', 'member-1', {
        name: 'Changed Name',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it('allows owners to update supplied fields only', async () => {
    mockedFindOrganization.mockResolvedValue({ id: 'org-1' });
    mockedFindMembership.mockResolvedValue({ role: 'OWNER' });
    mockedUpdateOrganization.mockResolvedValue({
      ...publicOrganization,
      name: 'Updated Organization',
    });

    await updateOrganizationProfile('gitzone-platform', 'owner-1', {
      name: 'Updated Organization',
    });

    expect(mockedUpdateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: { name: 'Updated Organization' },
      }),
    );
  });
});
