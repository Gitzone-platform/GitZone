import { z } from 'zod';

import { createRepositorySchema } from './repository.validation.js';

export const forkRepositorySchema = z.strictObject({
  name: createRepositorySchema.shape.name.optional(),
  description: createRepositorySchema.shape.description,
  isPrivate: z.boolean().optional(),
});

export type ForkRepositoryInput = z.infer<typeof forkRepositorySchema>;
