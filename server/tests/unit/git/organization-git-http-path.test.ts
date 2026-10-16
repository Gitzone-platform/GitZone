import { describe, expect, it } from 'vitest';

const {
  buildGitHttpPathInfo,
  buildOwnedGitHttpPathInfo,
} = await import('../../../src/utils/git/http-path.js');

describe('Owned Git HTTP path builder', () => {
  it.each([
    '/info/refs',
    '/git-upload-pack',
    '/git-receive-pack',
  ])('preserves legacy user PATH_INFO for %s', (requestPath) => {
    const expected = buildGitHttpPathInfo(
      'asilbek2706',
      'portfolio',
      requestPath,
    );

    const actual = buildOwnedGitHttpPathInfo(
      { type: 'USER', username: 'asilbek2706' },
      'portfolio',
      requestPath,
    );

    expect(actual).toBe(expected);
  });

  it.each([
    '/info/refs',
    '/git-upload-pack',
    '/git-receive-pack',
  ])('builds organization PATH_INFO for %s', (requestPath) => {
    const actual = buildOwnedGitHttpPathInfo(
      { type: 'ORGANIZATION', slug: 'gitzone-team' },
      'backend',
      requestPath,
    );

    expect(actual).toBe(
      `/.organizations/gitzone-team/backend.git${requestPath}`,
    );
  });

  it.each([
    '/info/refs/extra',
    '/git-upload-pack/extra',
    '/git-receive-pack/extra',
    '/../info/refs',
    '',
  ])('rejects unsupported Git HTTP path "%s"', (requestPath) => {
    expect(() =>
      buildOwnedGitHttpPathInfo(
        { type: 'ORGANIZATION', slug: 'gitzone-team' },
        'backend',
        requestPath,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GIT_HTTP_PATH',
      }),
    );
  });

  it.each([
    '../escape',
    '..',
    '.',
    '/tmp',
    'team/name',
    'team\\name',
    '',
  ])('rejects unsafe organization slug "%s"', (slug) => {
    expect(() =>
      buildOwnedGitHttpPathInfo(
        { type: 'ORGANIZATION', slug },
        'backend',
        '/info/refs',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GIT_REPOSITORY_PATH',
      }),
    );
  });

  it.each([
    '../escape',
    '..',
    '.',
    '/tmp',
    'repo/name',
    'repo\\name',
    '',
  ])('rejects unsafe repository name "%s"', (name) => {
    expect(() =>
      buildOwnedGitHttpPathInfo(
        { type: 'ORGANIZATION', slug: 'gitzone-team' },
        name,
        '/info/refs',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GIT_REPOSITORY_PATH',
      }),
    );
  });
});