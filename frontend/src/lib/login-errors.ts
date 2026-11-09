export interface LoginFailure {
  status: number | undefined;
  message: string | undefined;
  code?: string | undefined;
  attemptsRemaining: number | undefined;
  lockoutMinutes: number | undefined;
}

/** Normalizes unknown login rejections into structured failure objects. */
export function parseLoginFailure(err: unknown): LoginFailure {
  const empty: LoginFailure = {
    status: undefined,
    message: undefined,
    code: undefined,
    attemptsRemaining: undefined,
    lockoutMinutes: undefined,
  };
  if (!err || typeof err !== 'object') return empty;

  const response = (err as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return empty;

  const r = response as { status?: unknown; data?: unknown };
  const data = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : undefined;

  const attemptsRemaining =
    typeof data?.attemptsRemaining === 'number'
      ? data.attemptsRemaining
      : typeof data?.attempts_remaining === 'number'
        ? data.attempts_remaining
        : undefined;

  const lockoutMinutes =
    typeof data?.lockoutMinutes === 'number'
      ? data.lockoutMinutes
      : typeof data?.waitMinutes === 'number'
        ? data.waitMinutes
        : typeof data?.lockout_minutes === 'number'
          ? data.lockout_minutes
          : undefined;

  const code = typeof data?.code === 'string' ? data.code : undefined;

  return {
    status: typeof r.status === 'number' ? r.status : undefined,
    message: typeof data?.error === 'string' ? data.error : undefined,
    code,
    attemptsRemaining,
    lockoutMinutes,
  };
}
