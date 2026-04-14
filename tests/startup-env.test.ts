/**
 * Tests for startup environment variable validation.
 *
 * SEMANTIUS_API_KEY and SEMANTIUS_ORG are required at startup.
 * The CLI must report each missing variable by name in the error output.
 */

import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

describe('Startup env variable validation', () => {
  const cliPath = join(import.meta.dir, '..', 'src', 'index.ts');

  /**
   * Run the CLI with explicit control over SEMANTIUS_API_KEY and SEMANTIUS_ORG.
   * Omit a variable from the overrides map to simulate it being unset.
   */
  async function runCliWithEnv(
    args: string[],
    envOverrides: Record<string, string | undefined>,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Build env: start from process.env but strip the vars we want to control,
    // then apply the caller's overrides.
    const { SEMANTIUS_API_KEY: _k, SEMANTIUS_ORG: _o, ...baseEnv } = process.env as Record<string, string | undefined>;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...baseEnv, ...envOverrides })) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    const proc = Bun.spawn(['bun', 'run', cliPath, ...args], {
      env: { ...env, MCP_NO_DAEMON: '1' },
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { stdout, stderr, exitCode };
  }

  test('errors when SEMANTIUS_API_KEY is missing', async () => {
    const result = await runCliWithEnv(['grep', '*'], {
      SEMANTIUS_ORG: 'test-org',
      // SEMANTIUS_API_KEY intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('MISSING_ENV_VAR');
    expect(result.stderr).toContain('SEMANTIUS_API_KEY');
  });

  test('errors when SEMANTIUS_ORG is missing', async () => {
    const result = await runCliWithEnv(['grep', '*'], {
      SEMANTIUS_API_KEY: 'test-api-key',
      // SEMANTIUS_ORG intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('MISSING_ENV_VAR');
    expect(result.stderr).toContain('SEMANTIUS_ORG');
  });

  test('errors when both SEMANTIUS_API_KEY and SEMANTIUS_ORG are missing', async () => {
    const result = await runCliWithEnv(['grep', '*'], {
      // Both intentionally omitted
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('MISSING_ENV_VAR');
    expect(result.stderr).toContain('SEMANTIUS_API_KEY');
    expect(result.stderr).toContain('SEMANTIUS_ORG');
  });

  test('succeeds past env check when both variables are set', async () => {
    const result = await runCliWithEnv(['--help'], {
      SEMANTIUS_API_KEY: 'test-api-key',
      SEMANTIUS_ORG: 'test-org',
    });
    // --help bypasses the env check entirely
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('MISSING_ENV_VAR');
  });

  test('--help works without env vars (no startup check for help/version)', async () => {
    const result = await runCliWithEnv(['--help'], {
      // Both omitted
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('MISSING_ENV_VAR');
  });

  test('--version works without env vars (no startup check for help/version)', async () => {
    const result = await runCliWithEnv(['--version'], {
      // Both omitted
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('MISSING_ENV_VAR');
  });
});
