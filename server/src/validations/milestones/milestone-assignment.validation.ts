import { z } from 'zod';

import { issueNumberSchema } from '../issues/issue.validation.js';
import { milestoneIdSchema } from './milestone.validation.js';

export const assignMilestoneSchema = z
  .object({
    milestoneId: milestoneIdSchema.nullable(),
  })
  .strict();

export const milestoneAssignmentNumberSchema = issueNumberSchema;

export type AssignMilestoneInput = z.infer<typeof assignMilestoneSchema>;
