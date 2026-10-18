import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../src/errors/app.error.js';
import { getUserPublicActivity } from '../../../src/services/profiles/profile-activity.service.js';
import { getPublicUserProfile } from '../../../src/services/profiles/profile.service.js';

const activityPrismaMocks = vi.hoisted(() => ({
  repositoryFindMany: vi.fn(),
  issueFindMany: vi.fn(),
  pullRequestFindMany: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findMany: activityPrismaMocks.repositoryFindMany,
    },
    issue: {
      findMany: activityPrismaMocks.issueFindMany,
    },
    pullRequest: {
      findMany: activityPrismaMocks.pullRequestFindMany,
    },
  },
}));

vi.mock('../../../src/services/profiles/profile.service.js', () => ({
  getPublicUserProfile: vi.fn(),
}));

const profileMock = vi.mocked(getPublicUserProfile);
const repositoriesMock = activityPrismaMocks.repositoryFindMany;
const issuesMock = activityPrismaMocks.issueFindMany;
const pullRequestsMock = activityPrismaMocks.pullRequestFindMany;

const date = (day: number): Date =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);

const repository = (id: string, day: number) => ({
  id,
  name: `repository-${id}`,
  createdAt: date(day),
});

const issue = (id: string, day: number) => ({
  id,
  number: 1,
  title: `Issue ${id}`,
  createdAt: date(day),
  repository: {
    id: 'public-repo',
    name: 'public-repository',
  },
});

const pullRequest = (id: string, day: number) => ({
  id,
  number: 2,
  title: `PR ${id}`,
  createdAt: date(day),
  repository: {
    id: 'public-repo',
    name: 'public-repository',
  },
});

describe('getUserPublicActivity', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    profileMock.mockResolvedValue({
      id: 'user-1',
      username: 'asil',
      name: null,
      bio: null,
      avatarUrl: null,
      location: null,
      website: null,
      createdAt: date(1),
    });

    repositoriesMock.mockResolvedValue([]);
    issuesMock.mockResolvedValue([]);
    pullRequestsMock.mockResolvedValue([]);
  });

  it('returns an empty activity list', async () => {
    const result = await getUserPublicActivity('asil');

    expect(result.activities).toEqual([]);
    expect(profileMock).toHaveBeenCalledWith('asil');
  });

  it('combines repositories, issues and pull requests', async () => {
    repositoriesMock.mockResolvedValue([repository('repo-1', 1)]);
    issuesMock.mockResolvedValue([issue('issue-1', 2)]);
    pullRequestsMock.mockResolvedValue([pullRequest('pr-1', 3)]);

    const result = await getUserPublicActivity('asil');

    expect(result.activities.map((activity) => activity.type)).toEqual([
      'PULL_REQUEST_CREATED',
      'ISSUE_CREATED',
      'REPOSITORY_CREATED',
    ]);

    expect(result.activities).toHaveLength(3);
  });

  it('sorts activities by creation date descending', async () => {
    repositoriesMock.mockResolvedValue([repository('repo-old', 1), repository('repo-new', 5)]);
    issuesMock.mockResolvedValue([issue('issue-middle', 3)]);

    const result = await getUserPublicActivity('asil');

    expect(result.activities.map((activity) => activity.id)).toEqual([
      'repo-new',
      'issue-middle',
      'repo-old',
    ]);
  });

  it('limits the combined result to 30 activities', async () => {
    repositoriesMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        id: `repo-${index}`,
        name: `repository-${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
      })),
    );

    issuesMock.mockResolvedValue([issue('issue-1', 8)]);

    const result = await getUserPublicActivity('asil');

    expect(result.activities).toHaveLength(30);
    expect(result.activities[0]?.id).toBe('issue-1');
  });

  it('filters repository queries to public repositories', async () => {
    await getUserPublicActivity('asil');

    expect(repositoriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: 'user-1',
          isPrivate: false,
        },
        take: 30,
      }),
    );

    expect(issuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          creatorId: 'user-1',
          repository: {
            isPrivate: false,
          },
        },
        take: 30,
      }),
    );

    expect(pullRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authorId: 'user-1',
          repository: {
            isPrivate: false,
          },
        },
        take: 30,
      }),
    );
  });

  it('does not query activities when the user does not exist', async () => {
    profileMock.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    await expect(getUserPublicActivity('missinguser')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(repositoriesMock).not.toHaveBeenCalled();
    expect(issuesMock).not.toHaveBeenCalled();
    expect(pullRequestsMock).not.toHaveBeenCalled();
  });

  it('propagates database query errors', async () => {
    issuesMock.mockRejectedValue(new Error('Database unavailable'));

    await expect(getUserPublicActivity('asil')).rejects.toThrow('Database unavailable');
  });
});
