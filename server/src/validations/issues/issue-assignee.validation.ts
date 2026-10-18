import { z } from 'zod';

export const addIssueAssigneeSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
  })
  .strict();

export const issueAssigneeUsernameSchema = z.string().trim().min(1).max(100);

export type AddIssueAssigneeInput = z.infer<typeof addIssueAssigneeSchema>;
