import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export type AuthUser = { id: string; name: string; role: string; app_scope: string[] };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Missing JWT_SECRET must not block boot (plan section 7: config is validated
// lazily); an ephemeral secret keeps dev working but invalidates tokens on
// restart, so production has to set it.
const configuredSecret = process.env.JWT_SECRET;
if (!configuredSecret) {
  console.warn('[auth] JWT_SECRET is not set — using an ephemeral secret; tokens will not survive a restart');
}
const secret = configuredSecret || randomBytes(32).toString('hex');
const accessTtl = process.env.JWT_TTL || '12h';
const refreshTtl = process.env.REFRESH_TTL || '7d';

/** Staged rollout switch: enforcement turns on with AUTH_ENFORCE=true. */
export const authEnforced = () => process.env.AUTH_ENFORCE === 'true';

export function signTokens(user: AuthUser) {
  const base = { sub: user.id, name: user.name, role: user.role, app_scope: user.app_scope };
  // Env values are plain strings; the types want the narrower StringValue.
  const access = accessTtl as jwt.SignOptions['expiresIn'];
  const refresh = refreshTtl as jwt.SignOptions['expiresIn'];
  return {
    accessToken: jwt.sign({ ...base, typ: 'access' }, secret, { expiresIn: access }),
    refreshToken: jwt.sign({ ...base, typ: 'refresh' }, secret, { expiresIn: refresh }),
  };
}

function readScope(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Verify a token and check its type; returns null for anything invalid. */
export function verifyToken(token: string, typ: 'access' | 'refresh'): AuthUser | null {
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.typ !== typ || typeof payload.sub !== 'string') return null;
    // Legacy shim: tokens minted before Phase 0c carry NO app_scope key at all;
    // treat those as control-plane tokens so pre-existing sessions keep working.
    // Tokens minted since 0c always carry the key — an empty array means the
    // employee's scopes were revoked, and it must stay empty (no implicit grant).
    const legacy = !('app_scope' in payload);
    const app_scope = legacy ? ['admin'] : readScope(payload.app_scope);
    return {
      id: payload.sub,
      name: String(payload.name ?? ''),
      role: String(payload.role ?? ''),
      app_scope,
    };
  } catch {
    return null;
  }
}

/** 401 unless a valid access token is presented; attaches req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verifyToken(token, 'access') : null;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

/** 401 without a user, 403 when the role is not permitted. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }
    next();
  };
}

/**
 * 401 without a user, 403 when the token carries none of the required app
 * scopes (multi-app-plan §10.2). Staged like guard(): pass-through until
 * AUTH_ENFORCE=true, so the current no-login dev posture keeps working.
 */
export function requireScope(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authEnforced()) return next();
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!scopes.some((scope) => req.user!.app_scope.includes(scope))) {
      res.status(403).json({ error: 'App scope not permitted' });
      return;
    }
    next();
  };
}

/**
 * Staged enforcement: passes everything through until AUTH_ENFORCE=true, then
 * requires a valid access token and optionally one of the given roles. Keeps
 * the existing client working until its login screen ships (Phase 0.10).
 * Public paths (health) are exempted by the caller or via isPublicPath.
 */
export function guard(...roles: string[]) {
  const roleCheck = roles.length ? requireRole(...roles) : null;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authEnforced()) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();
    requireAuth(req, res, () => (roleCheck ? roleCheck(req, res, next) : next()));
  };
}

/** Paths that stay reachable without a token even when enforcement is on. */
const PUBLIC_PATHS = new Set(['/health']);