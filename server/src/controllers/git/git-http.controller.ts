import type { Request, Response } from 'express';

import { logger } from '../../config/logger.js';
import { AppError } from '../../errors/app.error.js';

import { verifyPersonalAccessToken } from '../../services/auth/pat.service.js';
import { executeGitHttpBackend } from '../../services/git/git-http-backend.service.js';
import { withGitDistributedLock } from '../../services/git/git-distributed-lock.service.js';
import { assertGitRepositoryIdentity } from '../../services/git/git-repository-identity.service.js';
import { lookupGitRepository } from '../../services/git/git-repository-lookup.service.js';
import { withGitNamespaceReadLock } from '../../services/git/git-user-lock.service.js';
import { authorizeOrganizationRepositoryAccess } from '../../services/repositories/organization-repository-authorization.service.js';
import { authorizeRepositoryAccess } from '../../services/repositories/repository-authorization.service.js';
import { assertRepositoryTransferAllowsGitWrite } from '../../services/repositories/repository-transfer-write-guard.service.js';

import { parseGitBasicAuthorization } from '../../utils/git/basic-auth.js';
import { buildOwnedGitHttpPathInfo } from '../../utils/git/http-path.js';
import { classifyGitHttpRequest } from '../../utils/git/http-request.js';

const authenticateGitRequest = async (
  req: Request,
): Promise<{ userId: string; username: string }> => {
  const credentials = parseGitBasicAuthorization(req.headers.authorization);

  if (!credentials) {
    throw new AppError(
      'Git username and personal access token are required',
      401,
      'GIT_AUTH_REQUIRED',
    );
  }

  return verifyPersonalAccessToken(credentials.username, credentials.password);
};

export const gitHttpController = async (req: Request, res: Response): Promise<void> => {
  const { username, repository } = req.params;

  if (typeof username !== 'string' || typeof repository !== 'string') {
    throw new AppError('Invalid Git repository path', 400, 'INVALID_GIT_REPOSITORY_PATH');
  }

  const requestInfo = classifyGitHttpRequest(req.method, req.path, req.query.service);
  const initialRepository = await lookupGitRepository(username, repository);

  await withGitNamespaceReadLock(
    {
      type: initialRepository.owner.type,
      id: initialRepository.owner.id,
    },
    async () =>
      withGitDistributedLock(
        {
          type: initialRepository.owner.type,
          id: initialRepository.owner.id,
        },
        'read',
        async ({ signal }) => {
          const gitRepository = await lookupGitRepository(username, repository);

          assertGitRepositoryIdentity(initialRepository, gitRepository);

          const repositoryOwner = gitRepository.owner.name;
          const repositoryName = gitRepository.name;

          const pathInfo = buildOwnedGitHttpPathInfo(
            gitRepository.owner.type === 'USER'
              ? { type: 'USER', username: repositoryOwner }
              : { type: 'ORGANIZATION', slug: repositoryOwner },
            repositoryName,
            req.path,
          );

          const authenticationRequired =
            gitRepository.isPrivate || requestInfo.accessType === 'WRITE';

          logger.info(
            {
              method: req.method,
              path: req.path,
              username: repositoryOwner,
              repository: repositoryName,
              service: requestInfo.service,
              accessType: requestInfo.accessType,
              isPrivate: gitRepository.isPrivate,
              authenticationRequired,
              ownerType: gitRepository.owner.type,
            },
            'Git HTTP request received',
          );

          let remoteUser: string | null;

          try {
            const authenticatedUser = authenticationRequired
              ? await authenticateGitRequest(req)
              : null;

            const userId = authenticatedUser?.userId;

            const access =
              gitRepository.owner.type === 'ORGANIZATION'
                ? await authorizeOrganizationRepositoryAccess(
                    gitRepository.id,
                    requestInfo.accessType,
                    userId,
                  )
                : await authorizeRepositoryAccess(gitRepository.id, requestInfo.accessType, userId);

            // Authorization must refer to the repository resolved under the lock.
            if (access.repositoryId !== gitRepository.id) {
              throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
            }

            if (gitRepository.owner.type === 'ORGANIZATION') {
              if (
                !('organizationId' in access) ||
                access.organizationId !== gitRepository.owner.id ||
                access.organizationSlug !== gitRepository.owner.name
              ) {
                throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
              }
            } else if (
              !('repositoryOwnerId' in access) ||
              access.repositoryOwnerId !== gitRepository.owner.id ||
              access.repositoryOwnerUsername !== gitRepository.owner.name
            ) {
              throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
            }

            remoteUser = authenticatedUser?.username ?? null;

            logger.info(
              {
                permission: access.permission,
                repository: repositoryName,
                username: repositoryOwner,
                ownerType: gitRepository.owner.type,
                authenticatedUsername: remoteUser,
              },
              'Git HTTP access authorized',
            );
          } catch (error) {
            if (error instanceof AppError) {
              if (error.statusCode === 401) {
                res.setHeader('WWW-Authenticate', 'Basic realm="GitZone"');
              }

              res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
              });

              return;
            }

            throw error;
          }

          if (requestInfo.accessType === 'WRITE') {
            try {
              await assertRepositoryTransferAllowsGitWrite(gitRepository.id);
            } catch (error) {
              if (error instanceof AppError) {
                res.status(error.statusCode).json({
                  success: false,
                  message: error.message,
                  code: error.code,
                });
                return;
              }

              throw error;
            }
          }

          await executeGitHttpBackend({
            req,
            res,
            pathInfo,
            remoteUser,
            repositoryOwner,
            repositoryName,
            signal,
          });
        },
      ),
  );
};
