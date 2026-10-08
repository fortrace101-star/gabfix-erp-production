/**
 * Live request-log feed driven by Server-Sent Events.
 *
 * Connects to the /api/events SSE stream, filters for `request-log` events,
 * and renders them in an auto-scrolling table. The browser's native
 * EventSource handles reconnection and heartbeat — zero polling.
 */

import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle, ChevronDown, Clock, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useServerLogs } from "@/lib/useServerLogs";
import type { RequestLog } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogFeedRow } from "@/components/LogFeedRow";
import useAutoScroll from "@/lib/useAutoScroll";

export function LogFeed() {
  const { logs, connected, error } = useServerLogs();
  const containerRef = useRef<HTMLDivElement>(null);
  const { autoScroll, toggleAutoScroll, scrollToBottom } = useAutoScroll(containerRef);

  const prevLen = useRef(logs.length);
  useEffect(() => {
    if (logs.length !== prevLen.current && autoScroll) {
      scrollToBottom();
      prevLen.current = logs.length;
    }
  }, [logs, autoScroll, scrollToBottom]);

  return (
    <div className="panel flex h-[500px] flex-col">
      {/* Header */}
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Live request feed</h2>
          <p className="panel-subtitle">
            {error ? error : connected ? `${logs.length} events streamed` : "Connecting…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connected && <CheckCircle className="size-4 text-success" />}
          {!connected && !error && <Clock className="size-4 animate-pulse text-muted-foreground" />}
          {error && <WifiOff className="size-4 text-destructive" />}
          <Button variant="ghost" size="sm" onClick={toggleAutoScroll} className="text-xs">
            {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
            <ChevronDown className="ml-1 size-3" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <ScrollArea ref={containerRef} className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead className="w-12">App</TableHead>
              <TableHead className="w-12">Method</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-16">Status</TableHead>
              <TableHead className="w-16">Duration</TableHead>
              <TableHead className="w-16">Client IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  <Activity className="mx-auto mb-2 size-6 opacity-50" />
                  Waiting for the first request… (SSE stream active)
                </TableCell>
              </TableRow>
            )}
            {logs.map((log: RequestLog) => (
              <LogFeedRow key={log.id} log={log} />
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
