export const AUTH_OPERATOR_TASKS = ['migrate', 'smoke', 'preview-smoke', 'create-user'] as const;
export type AuthOperatorTask = typeof AUTH_OPERATOR_TASKS[number];

/** Credentials never belong in argv; old readable-Vercel-variable IDs are no longer supported. */
export function parseAuthOperatorArgs(args: string[]) {
  const [task, ...rest] = args;
  if (!AUTH_OPERATOR_TASKS.includes(task as AuthOperatorTask) || rest.filter(value => value === '--prompt').length > 1)
    throw new Error('Invalid operator arguments');
  const positional = rest.filter(value => value !== '--prompt');
  if (task !== 'preview-smoke' && positional.length !== 0) throw new Error('Invalid operator arguments');
  if (task === 'preview-smoke') {
    if (positional.length !== 1) throw new Error('A selected preview is required');
    let url: URL; try { url = new URL(positional[0]); } catch { throw new Error('Invalid preview destination'); }
    if (url.protocol !== 'https:' || url.origin !== positional[0] || !/^live-traffic-[a-z0-9]+-carbon-bc04\.vercel\.app$/.test(url.hostname))
      throw new Error('Invalid preview destination');
  }
  return { task: task as AuthOperatorTask, prompt: rest.includes('--prompt'), deployment: positional[0] };
}

/** Validate both endpoints as one account/database without returning submitted values in errors. */
export function authOperatorConnections(env: Record<string, string | undefined>) {
  try {
    if (env.VERCEL_ENV === 'production') throw new Error();
    const pooled = env.DATABASE_URL, direct = env.DATABASE_URL_UNPOOLED;
    if (!pooled || !direct || [pooled, direct].some(value => /[\s\x00-\x1f\x7f]/.test(value))) throw new Error();
    const p = new URL(pooled), d = new URL(direct);
    for (const u of [p, d]) if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.username || !u.password || u.hash ||
      !u.hostname.endsWith('.neon.tech') || u.pathname === '/' || (u.port && u.port !== '5432') ||
      ['disable', 'allow', 'prefer'].includes(u.searchParams.get('sslmode') ?? '')) throw new Error();
    if (!p.hostname.includes('-pooler.') || d.hostname.includes('-pooler.') ||
      p.hostname.replace('-pooler.', '.') !== d.hostname || p.pathname !== d.pathname ||
      p.username !== d.username || p.password !== d.password) throw new Error();
    return { pooled, direct };
  } catch { throw new Error('Provide matching pooled/direct Neon credentials through a trusted process or hidden prompt'); }
}
