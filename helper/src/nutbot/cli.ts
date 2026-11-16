/**
 * Runs the `claude` (or `codex`) CLI the same careful way the owner's AVN Hub NutBot does (chatHarness.ts):
 * prompt on stdin (no ARG_MAX trouble, nothing in the process list), tools switched OFF, its own process group so a timeout
 * kills the whole tree, output size capped. On top of that: a trimmed environment (the CLI never sees the helper's API keys),
 * a neutral working directory, and no settings / MCP servers / slash commands loaded, so a chat turn costs a few hundred tokens.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import { CliError, type CliRun, type RunCli } from '../core.ts';

/** Environment variables the CLI may see. Everything else (all NUTFIN_* keys, tokens) is left out. */
const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|LANG|LC_[A-Z]+|TERM|TMPDIR|XDG_[A-Z_]+|SSL_CERT_[A-Z]+|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY|ANTHROPIC_[A-Z_]+|CLAUDE_[A-Z_]+|CODEX_[A-Z_]+|OPENAI_[A-Z_]+)$/i;
const MAX_OUT = 1_000_000;

export function cliEnv(source: NodeJS.ProcessEnv, cfg: Pick<Config, 'cliConfigDir'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && ENV_ALLOW.test(k) && !/^NUTFIN_/i.test(k)) out[k] = v;
  if (cfg.cliConfigDir) out['CLAUDE_CONFIG_DIR'] = cfg.cliConfigDir;
  return out;
}

export function neutralCwd(): string {
  const dir = join(tmpdir(), 'nuttyfin-helper-cwd');
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* the spawn will report it */ }
  return dir;
}

/** The exact command line for a chat turn. Pure, so it is unit-tested. */
export function buildInvocation(cfg: Config, system: string, prompt: string, source: NodeJS.ProcessEnv = process.env): CliRun {
  const cmd = cfg.cliPath || cfg.cli;
  const env = cliEnv(source, cfg);
  if (cfg.cli === 'codex') {
    // codex has no system-prompt flag: the whole thing goes in on stdin, read-only sandbox
    return {
      cmd, args: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', ...(cfg.cliModel ? ['--model', cfg.cliModel] : []), '-'],
      stdin: `${system}\n\n${prompt}`, env, cwd: neutralCwd(), timeoutMs: cfg.cliTimeoutMs,
    };
  }
  return {
    cmd,
    args: [
      '-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', '',
      '--model', cfg.cliModel || 'haiku', '--system-prompt', system,
    ],
    stdin: prompt, env, cwd: neutralCwd(), timeoutMs: cfg.cliTimeoutMs,
  };
}

/** The text the model wrote, from either CLI's output. */
export function extractReply(cli: 'claude' | 'codex', stdout: string): string {
  if (cli === 'claude') {
    try {
      const o = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
      if (o.is_error === true) throw new CliError('failed', 'The CLI reported an error');
      return typeof o.result === 'string' ? o.result : '';
    } catch (e) {
      if (e instanceof CliError) throw e;
      return stdout.trim(); // plain text fallback
    }
  }
  let text = '';
  for (const line of stdout.split('\n')) {
    try {
      const f = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (f.type === 'item.completed' && f.item?.type === 'agent_message' && typeof f.item.text === 'string') text = f.item.text;
    } catch { /* not a frame */ }
  }
  return text;
}

function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

/** The real runner. Rejects with CliError('missing' | 'timeout' | 'failed'). */
export const runCli: RunCli = run => new Promise<string>((resolve, reject) => {
  let child;
  try {
    child = spawn(run.cmd, run.args, { cwd: run.cwd, env: run.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  } catch (e) {
    reject(new CliError('missing', `Could not start ${run.cmd}: ${(e as Error).message}`));
    return;
  }
  let out = '';
  let err = '';
  let done = false;
  const finish = (fn: () => void): void => { if (done) return; done = true; clearTimeout(timer); fn(); };
  const timer = setTimeout(() => {
    finish(() => reject(new CliError('timeout', 'The CLI took too long')));
    killTree(child.pid, 'SIGTERM');
    setTimeout(() => killTree(child.pid, 'SIGKILL'), 3000).unref();
  }, run.timeoutMs);
  child.stdout.on('data', (d: Buffer) => { if (out.length < MAX_OUT) out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { if (err.length < 8000) err += d.toString(); });
  child.on('error', (e: NodeJS.ErrnoException) => finish(() => reject(new CliError(e.code === 'ENOENT' ? 'missing' : 'failed', e.code === 'ENOENT' ? `${run.cmd} is not installed or not on PATH` : e.message))));
  child.on('close', code => finish(() => {
    if (code === 0) resolve(out);
    else reject(new CliError('failed', `The CLI exited with code ${code ?? 'unknown'}${err.trim() ? `: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 200)}` : ''}`));
  }));
  child.stdin.on('error', () => { /* the child may exit before reading */ });
  child.stdin.end(run.stdin);
});
