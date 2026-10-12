import { z } from 'zod';

export const repositoryWatchPreferenceSchema = z.enum(['ALL', 'PARTICIPATING', 'IGNORE']);

export const updateRepositoryWatchPreferencesSchema = z.strictObject({
  preference: repositoryWatchPreferenceSchema,
});

export type RepositoryWatchPreferenceInput = z.infer<typeof repositoryWatchPreferenceSchema>;

export type UpdateRepositoryWatchPreferencesInput = z.infer<
  typeof updateRepositoryWatchPreferencesSchema
>;
