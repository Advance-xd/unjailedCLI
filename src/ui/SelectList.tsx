import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export interface SelectItem {
  key: string;
  label: string;
  hint?: string;
  current?: boolean;
  /** Replaces the default "✓ current" marker. */
  mark?: string;
}

/** A windowed list; the parent owns the selected index and key handling. */
export function SelectList({ items, selected, max = 8 }: { items: SelectItem[]; selected: number; max?: number }) {
  const start = Math.max(0, Math.min(selected - Math.floor(max / 2), items.length - max));
  const visible = items.slice(start, start + max);
  const labelWidth = Math.max(...items.map((i) => i.label.length), 0) + 2;
  return (
    <Box flexDirection="column">
      {start > 0 && <Text>{theme.dim("  ↑ more")}</Text>}
      {visible.map((item, idx) => {
        const active = start + idx === selected;
        const pointer = active ? theme.brand("› ") : "  ";
        const label = item.label.padEnd(labelWidth);
        const mark = item.mark ?? (item.current ? theme.ok(" ✓ current") : "");
        return (
          <Text key={item.key} wrap="truncate-end">
            {pointer}
            {active ? theme.brandBold(label) : label}
            {item.hint ? theme.dim(item.hint) : ""}
            {mark}
          </Text>
        );
      })}
      {start + max < items.length && <Text>{theme.dim("  ↓ more")}</Text>}
    </Box>
  );
}
