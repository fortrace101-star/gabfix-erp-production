import type { RequestLog } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";

const APP_COLORS: Record<string, string> = {
  admin: "bg-blue-500/15 text-blue-400",
  portal: "bg-emerald-500/15 text-emerald-400",
  store: "bg-amber-500/15 text-amber-400",
  laundry: "bg-violet-500/15 text-violet-400",
};

function statusTone(status: number): "success" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "success";
}

function shortId(uuid: string): string {
  return uuid.slice(0, 4);
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}

export function LogFeedRow({ log }: { log: RequestLog }) {
  const tone = statusTone(log.status);
  const appClasses = APP_COLORS[log.appId] ?? "bg-secondary text-muted-foreground";
  const statusClass = {
    success: "status-success",
    warn: "status-warning",
    error: "status-danger",
  }[tone];

  return (
    <TableRow className="font-mono text-xs">
      <TableCell className="text-xs text-muted-foreground/50">{shortId(log.id)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(log.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn("text-[10px]", appClasses)}>
          {log.appId}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px] font-mono">
          {log.method}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">{truncate(log.url, 60)}</TableCell>
      <TableCell>
        <Badge className={cn("status-badge", statusClass, "text-[10px]")}>{log.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{log.duration} ms</TableCell>
      <TableCell className="text-xs text-muted-foreground">{truncate(log.ip, 20)}</TableCell>
    </TableRow>
  );
}
