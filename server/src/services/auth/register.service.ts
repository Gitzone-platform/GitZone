import bcrypt from 'bcrypt';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { AuthResponse, RegisterInput, SessionMetadata } from '../../types/auth.types.js';
import { issueAuthSession } from './session-issuer.service.js';

const SALT_ROUNDS = 12;

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export const registerUser = async (
  input: RegisterInput,
  metadata: SessionMetadata,
): Promise<AuthResponse> => {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        {
          username: {
            equals: input.username,
            mode: 'insensitive',
          },
        },
        { email: input.email },
      ],
    },
  });

  if (existingUser) {
    if (existingUser.username.toLowerCase() === input.username.toLowerCase()) {
      throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
    }

    throw new AppError('Email is already registered', 409, 'EMAIL_ALREADY_REGISTERED');
  }

  const reservedName = await prisma.namespaceEntry.findUnique({
    where: { name: input.username.toLowerCase() },
    select: { name: true },
  });

  if (reservedName) {
    throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);

  let user;

  try {
    user = await prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        password: hashedPassword,
        name: input.name ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError('Username or email is already registered', 409, 'REGISTRATION_CONFLICT');
    }

    throw error;
  }

  return issueAuthSession(user, metadata);
};
