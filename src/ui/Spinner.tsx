import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { theme } from "../theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0);
  const [start] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((Date.now() - start) / 1000);
  return (
    <Text>
      {theme.brand(FRAMES[i]!)} {theme.dim(`${label}… ${secs > 0 ? `${secs}s · ` : ""}Ctrl+C to stop`)}
    </Text>
  );
}
