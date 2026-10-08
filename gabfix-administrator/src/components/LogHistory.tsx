/**
 * Request log history page — fetches from GET /api/logs with filter + pagination.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RequestLog, LogFilter } from "@/lib/types";
import { fetchLogs } from "@/lib/api";
import { cn } from "@/lib/utils";
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
import { LogFilters } from "@/components/LogFilters";

const PAGE_SIZE = 50;

export function LogHistory() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<LogFilter>({});
  const [page, setPage] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchLogs({
        appId: filter.appId,
        method: filter.method,
        statusMin: filter.statusMin,
        statusMax: filter.statusMax,
        from: filter.from,
        to: filter.to,
        search: filter.search,
      });
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch whenever filters change (reset page too)
  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    setPage(0);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return (
    <div className="panel flex h-[500px] flex-col">
      {/* Header */}
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Request log history</h2>
          <p className="panel-subtitle">{logs.length} entries loaded</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <LogFilters filter={filter} onChange={setFilter} />

      {/* Body */}
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead className="w-24">Time</TableHead>
              <TableHead className="w-12">App</TableHead>
              <TableHead className="w-12">Method</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-16">Status</TableHead>
              <TableHead className="w-16">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No logs match the current filters.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              logs
                .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                .map((log) => <LogFeedRow key={log.id} log={log} />)}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Pagination */}
      {!loading && logs.length > 0 && (
        <div className="panel-header border-t">
          <span className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, logs.length)} of{" "}
            {logs.length}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => ((p + 1) * PAGE_SIZE < logs.length ? p + 1 : p))}
              disabled={(page + 1) * PAGE_SIZE >= logs.length}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
