import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { FX_SNOW, FX_SPARKLE, fxSnow, fxSparkle } from "../theme.js";

/** A calm band of snow drifting down the LEFT and RIGHT gutters of the live
 *  area. Deliberately not inside <Static> (that would spam scrollback with one
 *  frame per tick). Renders nothing on small terminals so it never pushes the
 *  chat around, and nothing when the effect is off. */

interface Flake {
  x: number;
  y: number;
  g: string;
}

const BAND_H = 3; // rows of snow shown above the live area
const GUTTER = 12; // how far in from each edge flakes may fall

function spawn(width: number, atTop: boolean): Flake {
  const leftSide = Math.random() < 0.5;
  const g = Math.random() < 0.12 ? FX_SPARKLE[Math.floor(Math.random() * FX_SPARKLE.length)]! : FX_SNOW[Math.floor(Math.random() * FX_SNOW.length)]!;
  const x = leftSide ? Math.floor(Math.random() * GUTTER) : width - 1 - Math.floor(Math.random() * GUTTER);
  const y = atTop ? 0 : Math.floor(Math.random() * BAND_H);
  return { x, y, g };
}

function paint(line: string): string {
  // Colour each glyph (leave the spaces plain) — sparkles pop in brand blue.
  return line.replace(/\S/g, (m) => (FX_SPARKLE.includes(m) ? fxSparkle(m) : fxSnow(m)));
}

export function Snow({ width, rows }: { width: number; rows: number }) {
  const on = width >= 90 && rows >= 24;
  const [, setFrame] = useState(0);
  const flakes = useRef<Flake[]>([]);

  useEffect(() => {
    if (!on) return;
    const count = Math.max(4, Math.round(width / 20));
    flakes.current = Array.from({ length: count }, () => spawn(width, false));
    const id = setInterval(() => {
      for (const f of flakes.current) {
        f.y += 1;
        if (f.y >= BAND_H) Object.assign(f, spawn(width, true));
      }
      setFrame((n) => (n + 1) % 1_000_000);
    }, 120);
    return () => clearInterval(id);
  }, [on, width]);

  if (!on) return null;

  const lines: string[] = [];
  for (let y = 0; y < BAND_H; y++) {
    const cells = new Array(width).fill(" ");
    for (const f of flakes.current) {
      if (f.y === y && f.x >= 0 && f.x < width) cells[f.x] = f.g;
    }
    lines.push(cells.join("").replace(/\s+$/, ""));
  }

  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i}>{paint(l)}</Text>
      ))}
    </Box>
  );
}

/** A brief sparkle that twinkles when a reply finishes — a little dopamine hit.
 *  Watches the `streaming` flag for a true→false edge and shows for ~1.1s. */
export function FinishFlourish({ streaming }: { streaming: boolean }) {
  const prev = useRef(streaming);
  const timer = useRef<NodeJS.Timeout | undefined>(undefined);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (prev.current && !streaming) {
      setShow(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(false), 1100);
    }
    prev.current = streaming;
    return () => clearTimeout(timer.current);
  }, [streaming]);

  if (!show) return null;
  return <Text>{fxSparkle("  ✦ ✧ ⋆ ") + fxSnow("done") + fxSparkle(" ⋆ ✧ ✦")}</Text>;
}
