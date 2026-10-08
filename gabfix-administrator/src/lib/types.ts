/**
 * Types shared between the server and the admin console.
 * Mirrors server/services/log-store.ts#RequestLog.
 */

export interface RequestLog {
  id: string;
  timestamp: string;
  appId: string;
  method: string;
  url: string;
  status: number;
  duration: number; // ms
  ip: string;
  userAgent: string;
  userId?: string;
}

export interface LogFilter {
  appId?: string;
  method?: string;
  statusMin?: number;
  statusMax?: number;
  from?: string;
  to?: string;
  search?: string;
}
