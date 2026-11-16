/** Configuration from the environment (see .env.example). Parsing is pure so tests can pass their own object. */

export interface Config {
  host: string;
  port: number;
  jellyfinUrl: string;
  seerrUrl: string;
  sonarrUrl: string;
  radarrUrl: string;
  qbtUrl: string;
  sonarrKey: string;
  radarrKey: string;
  seerrKey: string;
  qbtUser: string;
  qbtPass: string;
  /** container path -> host path, longest container path first */
  pathMaps: Array<{ container: string; host: string }>;
  allowDelete: boolean;
  cli: 'claude' | 'codex';
  cliPath: string;
  cliModel: string;
  cliConfigDir: string;
  cliTimeoutMs: number;
  chatPerMin: number;
  maxPromptChars: number;
  digestMax: number;
}

type Env = Record<string, string | undefined>;

const str = (e: Env, k: string, d = ''): string => (e[k] ?? d).trim();
const url = (e: Env, k: string, d: string): string => str(e, k, d).replace(/\/+$/, '');
const int = (e: Env, k: string, d: number, min: number, max: number): number => {
  const n = Number(str(e, k));
  return Number.isFinite(n) && str(e, k) !== '' ? Math.min(max, Math.max(min, Math.round(n))) : d;
};

export function parsePathMaps(v: string): Config['pathMaps'] {
  return v.split(',').map(p => p.trim()).filter(Boolean).map(p => {
    const i = p.indexOf('=');
    return i > 0 ? { container: p.slice(0, i).replace(/\/+$/, ''), host: p.slice(i + 1).replace(/\/+$/, '') } : null;
  }).filter((x): x is { container: string; host: string } => !!x && !!x.container && !!x.host)
    .sort((a, b) => b.container.length - a.container.length);
}

export function loadConfig(e: Env): Config {
  const cli = str(e, 'NUTFIN_CLI', 'claude');
  return {
    host: str(e, 'NUTFIN_HELPER_HOST', '127.0.0.1'),
    port: int(e, 'NUTFIN_HELPER_PORT', 8120, 1, 65535),
    jellyfinUrl: url(e, 'NUTFIN_JELLYFIN_URL', 'http://127.0.0.1:8096'),
    seerrUrl: url(e, 'NUTFIN_SEERR_URL', 'http://127.0.0.1:5055'),
    sonarrUrl: url(e, 'NUTFIN_SONARR_URL', 'http://127.0.0.1:8989'),
    radarrUrl: url(e, 'NUTFIN_RADARR_URL', 'http://127.0.0.1:7878'),
    qbtUrl: url(e, 'NUTFIN_QBT_URL', 'http://127.0.0.1:8080'),
    sonarrKey: str(e, 'NUTFIN_SONARR_KEY'),
    radarrKey: str(e, 'NUTFIN_RADARR_KEY'),
    seerrKey: str(e, 'NUTFIN_SEERR_KEY'),
    qbtUser: str(e, 'NUTFIN_QBT_USER'),
    qbtPass: str(e, 'NUTFIN_QBT_PASS'),
    pathMaps: parsePathMaps(str(e, 'NUTFIN_PATH_MAPS')),
    allowDelete: str(e, 'NUTFIN_ALLOW_DELETE') === '1',
    cli: cli === 'codex' ? 'codex' : 'claude',
    cliPath: str(e, 'NUTFIN_CLI_PATH'),
    cliModel: str(e, 'NUTFIN_CLI_MODEL'),
    cliConfigDir: str(e, 'NUTFIN_CLI_CONFIG_DIR'),
    cliTimeoutMs: int(e, 'NUTFIN_CLI_TIMEOUT_MS', 30_000, 1000, 120_000),
    chatPerMin: int(e, 'NUTFIN_CHAT_PER_MIN', 6, 1, 120),
    maxPromptChars: int(e, 'NUTFIN_MAX_PROMPT_CHARS', 14_000, 2000, 100_000),
    digestMax: int(e, 'NUTFIN_DIGEST_MAX', 400, 20, 2000),
  };
}

/** Container path -> host path (the helper runs on the host, the download apps in containers). Unmapped paths pass through. */
export function toHostPath(cfg: Pick<Config, 'pathMaps'>, p: string): string {
  for (const m of cfg.pathMaps) {
    if (p === m.container) return m.host;
    if (p.startsWith(`${m.container}/`)) return m.host + p.slice(m.container.length);
  }
  return p;
}
