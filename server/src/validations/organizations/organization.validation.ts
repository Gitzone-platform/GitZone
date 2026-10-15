import { z } from 'zod';

export const createOrganizationSchema = z.strictObject({
  slug: z
    .string()
    .min(3)
    .max(39)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const organizationSlugSchema = createOrganizationSchema.shape.slug;

const organizationWebsiteSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);

      return (
        url.protocol === 'https:' &&
        url.hostname.length > 0 &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'Website must be a valid HTTPS URL without credentials')
  .nullable()
  .optional();

export const updateOrganizationProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    avatarUrl: z.string().trim().max(2048).url().nullable().optional(),
    website: organizationWebsiteSchema,
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one organization profile field is required',
  );

export type UpdateOrganizationProfileInput = z.infer<typeof updateOrganizationProfileSchema>;

export const inviteOrganizationMemberSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

export type InviteOrganizationMemberInput = z.infer<typeof inviteOrganizationMemberSchema>;
