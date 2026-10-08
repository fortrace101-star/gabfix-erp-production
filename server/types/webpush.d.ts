declare module 'web-push' {
  export interface VapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string | Buffer,
    options?: { TTL?: number; urgency?: string; topic?: string; expirationTime?: number; contact?: string; queueName?: string; subject?: string },
  ): Promise<void>;
}
