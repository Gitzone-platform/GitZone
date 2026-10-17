import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { env } from '../../../src/config/env.js';
import { executeGitHttpBackend } from '../../../src/services/git/git-http-backend.service.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const mockedSpawn = vi.mocked(spawn);

const createFixture = () => {
  const req = new PassThrough() as PassThrough & {
    method: string;
    originalUrl: string;
    headers: Record<string, string>;
  };

  req.method = 'GET';
  req.originalUrl = '/asil/demo.git/info/refs?service=git-upload-pack';
  req.headers = {};

  const res = {
    writableEnded: false,
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    setHeader: vi.fn(),
    destroy: vi.fn(),
  };

  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });

  mockedSpawn.mockReturnValue(child as never);

  const execute = (signal?: AbortSignal) =>
    executeGitHttpBackend({
      req: req as unknown as Request,
      res: res as unknown as Response,
      pathInfo: '/asil/demo.git/info/refs',
      remoteUser: null,
      repositoryOwner: 'asil',
      repositoryName: 'demo',
      ...(signal ? { signal } : {}),
    });

  return { req, res, child, execute };
};

describe('Git HTTP backend lifecycle', () => {
  it('waits for close after a process error', async () => {
    const { child, execute } = createFixture();

    let settled = false;

    const operation = execute().then(() => {
      settled = true;
    });

    child.emit('error', new Error('spawn failed'));

    await Promise.resolve();

    expect(settled).toBe(false);

    child.emit('close', -2);

    await operation;

    expect(settled).toBe(true);
  });

  it('waits for close after request abort', async () => {
    const { req, child, execute } = createFixture();

    let settled = false;

    const operation = execute().then(() => {
      settled = true;
    });

    req.emit('aborted');

    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);

    child.emit('close', null);

    await operation;

    expect(settled).toBe(true);
  });

  it('waits for close after oversized CGI headers', async () => {
    const { child, execute } = createFixture();

    let settled = false;

    const operation = execute().then(() => {
      settled = true;
    });

    child.stdout.write(Buffer.alloc(env.GIT_HTTP_MAX_HEADER_BYTES + 1, 0x61));

    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);

    child.emit('close', null);

    await operation;

    expect(settled).toBe(true);
  });

  it('kills the child and waits for close after distributed lock loss', async () => {
    const { child, res, execute } = createFixture();
    const controller = new AbortController();

    let settled = false;

    const operation = execute(controller.signal).then(() => {
      settled = true;
    });

    controller.abort();

    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);

    child.emit('close', null);

    await operation;

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'GIT_DISTRIBUTED_LOCK_LOST',
        }),
      }),
    );
  });

  it('does not forward backend output after distributed lock loss', async () => {
    const { child, res, execute } = createFixture();
    const controller = new AbortController();

    const operation = execute(controller.signal);

    controller.abort();

    child.stdout.write(
      Buffer.from('Status: 200 OK\r\nContent-Type: text/plain\r\n\r\nsuccess'),
    );

    child.emit('close', null);

    await operation;

    expect(res.write).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('destroys an already-started response after distributed lock loss', async () => {
    const { child, res, execute } = createFixture();
    const controller = new AbortController();

    res.headersSent = true;

    const operation = execute(controller.signal);

    controller.abort();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null);

    await operation;

    expect(res.destroy).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(503);
  });

  it('settles after normal process close', async () => {
    const { child, execute } = createFixture();

    const operation = execute();

    const headers = [
      'Status: 200 OK',
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n');

    child.stdout.write(Buffer.from(headers));
    child.stdout.end();

    child.emit('close', 0);

    await expect(operation).resolves.toBeUndefined();
  });
});