import { z } from 'zod';

const teamSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(39)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);

export const createTeamSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  slug: teamSlugSchema,
  description: z.string().trim().max(500).optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    slug: teamSlugSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;