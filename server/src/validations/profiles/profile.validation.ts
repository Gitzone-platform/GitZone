import { z } from 'zod';

export const profileUsernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_-]+$/);

const nullableProfileText = (maxLength: number) =>
  z.string().trim().max(maxLength).nullable().optional();

const websiteSchema = z
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

export const updateProfileSchema = z
  .strictObject({
    username: profileUsernameSchema.optional(),
    name: z.string().trim().min(1).max(100).nullable().optional(),
    bio: nullableProfileText(500),
    location: nullableProfileText(100),
    website: websiteSchema,
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one profile field is required');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
