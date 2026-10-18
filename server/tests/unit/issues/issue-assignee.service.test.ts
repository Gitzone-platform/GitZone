import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../../src/generated/prisma/client.js';
import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  addIssueAssignee,
  listIssueAssignees,
  removeIssueAssignee,
} from '../../../src/services/issues/issue-assignee.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findFirst: vi.fn() },
    issue: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    repositoryCollaborator: { findUnique: vi.fn() },
    issueAssignee: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const findIssue = vi.mocked(prisma.issue.findUnique);
const findUser = vi.mocked(prisma.user.findUnique);
const findCollaborator = vi.mocked(prisma.repositoryCollaborator.findUnique);
const createAssignee = vi.mocked(prisma.issueAssignee.create);
const findAssignees = vi.mocked(prisma.issueAssignee.findMany);
const deleteAssignees = vi.mocked(prisma.issueAssignee.deleteMany);
const authorize = vi.mocked(authorizeRepositoryAccess);

describe('Issue assignee service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({
      id: 'repo-1',
      ownerId: 'owner-1',
    } as never);

    findIssue.mockResolvedValue({ id: 'issue-1' } as never);

    authorize.mockResolvedValue(undefined as never);
  });

  it('rejects missing repository', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(addIssueAssignee('owner-1', 'owner', 'demo', 1, 'alice')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(createAssignee).not.toHaveBeenCalled();
  });

  it('rejects missing issue', async () => {
    findIssue.mockResolvedValue(null as never);

    await expect(addIssueAssignee('owner-1', 'owner', 'demo', 999, 'alice')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });

    expect(createAssignee).not.toHaveBeenCalled();
  });

  it('rejects missing assignee user', async () => {
    findUser.mockResolvedValue(null as never);

    await expect(addIssueAssignee('owner-1', 'owner', 'demo', 1, 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_ASSIGNEE_USER_NOT_FOUND',
    });
  });

  it('allows assigning the repository owner', async () => {
    findUser.mockResolvedValue({ id: 'owner-1' } as never);

    createAssignee.mockResolvedValue({
      issueId: 'issue-1',
      userId: 'owner-1',
    } as never);

    const result = await addIssueAssignee('owner-1', 'owner', 'demo', 1, 'owner');

    expect(result.userId).toBe('owner-1');
    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'owner-1');
    expect(findCollaborator).not.toHaveBeenCalled();

    expect(createAssignee).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          issueId: 'issue-1',
          userId: 'owner-1',
        },
      }),
    );
  });

  it('allows assigning a repository collaborator', async () => {
    findUser.mockResolvedValue({ id: 'collab-1' } as never);
    findCollaborator.mockResolvedValue({ id: 'membership-1' } as never);

    createAssignee.mockResolvedValue({
      issueId: 'issue-1',
      userId: 'collab-1',
    } as never);

    await addIssueAssignee('owner-1', 'owner', 'demo', 1, 'alice');

    expect(findCollaborator).toHaveBeenCalledWith({
      where: {
        repositoryId_userId: {
          repositoryId: 'repo-1',
          userId: 'collab-1',
        },
      },
      select: { id: true },
    });

    expect(createAssignee).toHaveBeenCalledOnce();
  });

  it('rejects assigning a non-collaborator', async () => {
    findUser.mockResolvedValue({ id: 'outsider-1' } as never);
    findCollaborator.mockResolvedValue(null as never);

    await expect(addIssueAssignee('owner-1', 'owner', 'demo', 1, 'outsider')).rejects.toMatchObject(
      {
        statusCode: 403,
        code: 'ISSUE_ASSIGNEE_NOT_ELIGIBLE',
      },
    );

    expect(createAssignee).not.toHaveBeenCalled();
  });

  it('rejects duplicate assignment with 409', async () => {
    findUser.mockResolvedValue({ id: 'owner-1' } as never);

    createAssignee.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(addIssueAssignee('owner-1', 'owner', 'demo', 1, 'owner')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ISSUE_ASSIGNEE_ALREADY_EXISTS',
    });
  });

  it('rejects assignment without WRITE access', async () => {
    authorize.mockRejectedValue({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });

    await expect(addIssueAssignee('reader-1', 'owner', 'demo', 1, 'owner')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });

    expect(findUser).not.toHaveBeenCalled();
    expect(createAssignee).not.toHaveBeenCalled();
  });

  it('lists assignees with READ access', async () => {
    findAssignees.mockResolvedValue([{ userId: 'owner-1' }, { userId: 'collab-1' }] as never);

    const result = await listIssueAssignees('owner', 'demo', 1, 'reader-1');

    expect(result).toHaveLength(2);
    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', 'reader-1');

    expect(findAssignees).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: 'issue-1' },
        orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
      }),
    );
  });

  it('removes an existing assignee', async () => {
    findUser.mockResolvedValue({ id: 'collab-1' } as never);
    deleteAssignees.mockResolvedValue({ count: 1 } as never);

    await removeIssueAssignee('owner-1', 'owner', 'demo', 1, 'alice');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'owner-1');

    expect(deleteAssignees).toHaveBeenCalledWith({
      where: {
        issueId: 'issue-1',
        userId: 'collab-1',
      },
    });
  });

  it('rejects removal when username does not exist', async () => {
    findUser.mockResolvedValue(null as never);

    await expect(
      removeIssueAssignee('owner-1', 'owner', 'demo', 1, 'missing'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_ASSIGNEE_NOT_FOUND',
    });

    expect(deleteAssignees).not.toHaveBeenCalled();
  });

  it('rejects removal when user is not assigned', async () => {
    findUser.mockResolvedValue({ id: 'collab-1' } as never);
    deleteAssignees.mockResolvedValue({ count: 0 } as never);

    await expect(removeIssueAssignee('owner-1', 'owner', 'demo', 1, 'alice')).rejects.toMatchObject(
      {
        statusCode: 404,
        code: 'ISSUE_ASSIGNEE_NOT_FOUND',
      },
    );
  });
});
