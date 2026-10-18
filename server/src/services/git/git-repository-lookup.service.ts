import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { resolveOwnedGitRepositoryPath } from '../../utils/git/repository-path.js';

export type GitRepositoryIdentity =
  | {
      type: 'USER';
      id: string;
      name: string;
    }
  | {
      type: 'ORGANIZATION';
      id: string;
      name: string;
    };

export type GitRepositoryLookupResult = {
  id: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  owner: GitRepositoryIdentity;
};

const notFound = (): AppError => new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');

export const lookupGitRepository = async (
  namespace: string,
  repositoryName: string,
): Promise<GitRepositoryLookupResult> => {
  // Reject unsafe path components before any database lookup.
  resolveOwnedGitRepositoryPath({ type: 'USER', username: namespace }, repositoryName);

  const entry = await prisma.namespaceEntry.findUnique({
    where: { name: namespace },
    select: {
      ownerType: true,
      ownerId: true,
    },
  });

  if (!entry) {
    throw notFound();
  }

  if (entry.ownerType === 'USER') {
    const user = await prisma.user.findUnique({
      where: { id: entry.ownerId },
      select: {
        id: true,
        username: true,
      },
    });

    if (!user || user.username !== namespace) {
      throw notFound();
    }

    const repository = await prisma.repository.findFirst({
      where: {
        name: repositoryName,
        ownerId: user.id,
        organizationId: null,
      },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        defaultBranch: true,
      },
    });

    if (!repository) {
      throw notFound();
    }

    return {
      ...repository,
      owner: {
        type: 'USER',
        id: user.id,
        name: user.username,
      },
    };
  }

  if (entry.ownerType === 'ORGANIZATION') {
    const organization = await prisma.organization.findUnique({
      where: { id: entry.ownerId },
      select: {
        id: true,
        slug: true,
      },
    });

    if (!organization || organization.slug !== namespace) {
      throw notFound();
    }

    const repository = await prisma.repository.findFirst({
      where: {
        name: repositoryName,
        organizationId: organization.id,
      },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        defaultBranch: true,
      },
    });

    if (!repository) {
      throw notFound();
    }

    return {
      ...repository,
      owner: {
        type: 'ORGANIZATION',
        id: organization.id,
        name: organization.slug,
      },
    };
  }

  // Unknown registry owner types must never fall back to a user.
  throw notFound();
};
