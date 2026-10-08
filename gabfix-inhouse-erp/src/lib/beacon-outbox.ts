const OUTBOX_KEY = "gabfix:field-ping-outbox";

type ShiftPing = { recordedAt: string; state: "active" };

export function queueShiftPing(): number {
  const next: ShiftPing = { recordedAt: new Date().toISOString(), state: "active" };
  const current = readOutbox();
  current.push(next);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(current.slice(-20)));
  return current.length;
}

export function readOutbox(): ShiftPing[] {
  try {
    const stored = localStorage.getItem(OUTBOX_KEY);
    return stored ? (JSON.parse(stored) as ShiftPing[]) : [];
  } catch {
    return [];
  }
}
