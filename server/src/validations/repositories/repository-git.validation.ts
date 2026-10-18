import { z } from 'zod';

import { isSafeGitRefName } from '../../utils/git/ref-name.js';
import { isSafeGitTreePath } from '../../utils/git/tree-path.js';

const safeRef = z.string().min(1).max(255).refine(isSafeGitRefName);
const safePath = z.string().max(4096).refine(isSafeGitTreePath);

export const repositoryReadmeQuerySchema = z
  .object({
    ref: safeRef.optional(),
  })
  .strict();

export const repositoryContentQuerySchema = z
  .object({
    ref: safeRef.optional(),
    path: safePath.optional(),
  })
  .strict();

export const repositoryCommitsQuerySchema = z
  .object({
    ref: safeRef.optional(),
    path: safePath.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).optional(),
    per_page: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()
  .transform((value) => ({
    ref: value.ref,
    path: value.path,
    page: value.page,
    perPage: value.perPage ?? value.per_page ?? 30,
  }));

export type RepositoryCommitsQuery = z.infer<typeof repositoryCommitsQuerySchema>;
export const repositoryCreateBranchSchema = z
  .object({
    name: safeRef,
    from: safeRef.optional(),
  })
  .strict();

export type RepositoryCreateBranchInput = z.infer<typeof repositoryCreateBranchSchema>;

export const repositoryBranchQuerySchema = z
  .object({
    name: safeRef,
  })
  .strict();

export type RepositoryBranchQuery = z.infer<typeof repositoryBranchQuerySchema>;
export const repositoryDeleteBranchQuerySchema = z
  .object({
    name: safeRef,
  })
  .strict();
export const repositoryRenameBranchSchema = z
  .object({
    name: safeRef,
    newName: safeRef,
  })
  .strict();

const commitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i);

const diffLimit = z.coerce
  .number()
  .int()
  .min(1024)
  .max(5 * 1024 * 1024);

export const repositoryCommitDiffQuerySchema = z
  .object({
    maxBytes: diffLimit.optional(),
    max_bytes: diffLimit.optional(),
  })
  .strict()
  .transform((value) => ({
    maxBytes: value.maxBytes ?? value.max_bytes ?? 1024 * 1024,
  }));

export const repositoryCompareCommitsQuerySchema = z
  .object({
    base: commitSha,
    head: commitSha,
    maxBytes: diffLimit.optional(),
    max_bytes: diffLimit.optional(),
  })
  .strict()
  .transform((value) => ({
    base: value.base,
    head: value.head,
    maxBytes: value.maxBytes ?? value.max_bytes ?? 1024 * 1024,
  }));

export const repositoryCompareBranchesQuerySchema = z
  .object({
    base: safeRef,
    head: safeRef,
    maxBytes: diffLimit.optional(),
    max_bytes: diffLimit.optional(),
  })
  .strict()
  .transform((value) => ({
    base: value.base,
    head: value.head,
    maxBytes: value.maxBytes ?? value.max_bytes ?? 1024 * 1024,
  }));
