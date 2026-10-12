import { z } from 'zod';

export const profileStarredQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ProfileStarredQuery = z.infer<typeof profileStarredQuerySchema>;
