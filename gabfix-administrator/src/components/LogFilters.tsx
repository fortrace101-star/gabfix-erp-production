/** Filter toolbar for the log history view. */

import { Filter, Search } from "lucide-react";

import type { LogFilter } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface LogFiltersProps {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
}

export function LogFilters({ filter, onChange }: LogFiltersProps) {
  const update = (patch: Partial<LogFilter>) => onChange({ ...filter, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      {/* App */}
      <div className="flex items-center gap-1">
        <Filter className="size-3 text-muted-foreground" />
        <span className="text-xs font-medium">App:</span>
        <Select value={filter.appId ?? ""} onValueChange={(v) => update({ appId: v || undefined })}>
          <SelectTrigger className="h-6 w-[100px] text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="portal">portal</SelectItem>
            <SelectItem value="store">store</SelectItem>
            <SelectItem value="laundry">laundry</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Method */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium">Method:</span>
        <Select
          value={filter.method ?? ""}
          onValueChange={(v) => update({ method: v || undefined })}
        >
          <SelectTrigger className="h-6 w-[90px] text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium">Status:</span>
        <Select
          value={
            filter.statusMin !== undefined ? `${filter.statusMin}-${filter.statusMax ?? 599}` : ""
          }
          onValueChange={(v) => {
            if (v === "all") update({ statusMin: undefined, statusMax: undefined });
            else if (v === "2xx") update({ statusMin: 200, statusMax: 299 });
            else if (v === "4xx") update({ statusMin: 400, statusMax: 499 });
            else if (v === "5xx") update({ statusMin: 500, statusMax: 599 });
          }}
        >
          <SelectTrigger className="h-6 w-[100px] text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="2xx">2xx</SelectItem>
            <SelectItem value="4xx">4xx</SelectItem>
            <SelectItem value="5xx">5xx</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Search */}
      <div className="flex items-center gap-1">
        <Search className="size-3 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search URL…"
          value={filter.search ?? ""}
          onChange={(e) => update({ search: e.target.value || undefined })}
          className="h-6 w-[180px] text-xs"
        />
      </div>
    </div>
  );
}
