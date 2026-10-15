import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreate, mockedNamespaceFindUnique } = vi.hoisted(() => ({
  mockedCreate: vi.fn(),
  mockedNamespaceFindUnique: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      create: mockedCreate,
    },
    namespaceEntry: {
      findUnique: mockedNamespaceFindUnique,
    },
  },
}));

const { createOrganization } =
  await import('../../../src/services/organizations/organization.service.js');

describe('Create organization service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedNamespaceFindUnique.mockResolvedValue(null);
  });

  it('creates an organization with its initial OWNER atomically', async () => {
    const organization = {
      id: 'org-1',
      slug: 'gitzone-platform',
      name: 'GitZone Platform',
      description: null,
      visibility: 'PUBLIC',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockedCreate.mockResolvedValue(organization);

    await expect(
      createOrganization('user-1', {
        slug: 'gitzone-platform',
        name: 'GitZone Platform',
        visibility: 'PUBLIC',
      }),
    ).resolves.toEqual(organization);

    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'gitzone-platform',
          members: {
            create: {
              userId: 'user-1',
              role: 'OWNER',
            },
          },
        }),
      }),
    );
  });

  it('rejects a username reserved in the shared namespace', async () => {
    mockedNamespaceFindUnique.mockResolvedValue({
      name: 'gitzone-platform',
    });

    await expect(
      createOrganization('user-1', {
        slug: 'gitzone-platform',
        name: 'GitZone',
        visibility: 'PUBLIC',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_ALREADY_EXISTS',
    });

    expect(mockedNamespaceFindUnique).toHaveBeenCalledWith({
      where: { name: 'gitzone-platform' },
      select: { name: true },
    });

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('does not create an organization when namespace lookup fails', async () => {
    const databaseError = new Error('Namespace lookup failed');

    mockedNamespaceFindUnique.mockRejectedValueOnce(databaseError);

    await expect(
      createOrganization('user-1', {
        slug: 'gitzone-platform',
        name: 'GitZone',
        visibility: 'PUBLIC',
      }),
    ).rejects.toBe(databaseError);

    expect(mockedCreate).not.toHaveBeenCalled();
  });
  it('maps unique constraint errors to HTTP 409', async () => {
    mockedCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
    );

    await expect(
      createOrganization('user-1', {
        slug: 'gitzone-platform',
        name: 'GitZone',
        visibility: 'PUBLIC',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_ALREADY_EXISTS',
    });
  });

  it('does not swallow unexpected database failures', async () => {
    mockedCreate.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      createOrganization('user-1', {
        slug: 'gitzone-platform',
        name: 'GitZone',
        visibility: 'PUBLIC',
      }),
    ).rejects.toThrow('Database unavailable');
  });
});
