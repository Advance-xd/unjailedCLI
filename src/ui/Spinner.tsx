import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { theme, fxSparkle, fxSlate } from "../theme.js";

/** A little minecart that rolls up to a rock, mines through it (sparks fly, the
 *  rock crumbles ▓→▒→░), then rolls on — the "digging into it" loader shown
 *  while we wait on the model. Each frame is a pre-coloured fixed-width string. */
function mineFrames(): string[] {
  const W = 11, ROCK = 10, SPARK = 9;
  const CART = ["▐", "█", "▌"];
  // [cart left-x, rock glyph, spark?]
  const steps: [number, string, boolean][] = [
    [0, "█", false], [1, "█", false], [2, "█", false], [3, "█", false], [4, "█", false],
    [5, "█", true], [5, "▓", false], [5, "▓", true], [5, "▒", false], [5, "▒", true],
    [5, "░", false], [5, " ", true], [6, "·", false], [7, "·", false], [8, " ", false],
  ];
  return steps.map(([p, rock, spark]) => {
    const cells = new Array(W).fill(" ");
    for (let k = 0; k < CART.length; k++) if (p + k < W) cells[p + k] = theme.brand(CART[k]!);
    if (rock !== " " && ROCK < W) cells[ROCK] = rock === "·" ? theme.dim(rock) : fxSlate(rock);
    if (spark) cells[SPARK] = fxSparkle("✦");
    return cells.join("");
  });
}
const MINE_FRAMES = mineFrames();

/**
 * The live status line while the model works. Instead of a single opaque
 * "Thinking…", it tells the user WHAT is happening right now — a coding pass,
 * a shell command, reading files — with elapsed time. States:
 *
 *   idle      → pulsing dots (waiting for first token)
 *   reasoning → "Reasoning" with a brain pulse
 *   coding    → writing/editing files (brackets animation)
 *   command   → shell command running (prompt animation)
 *   reading   → reading files / searching
 *   browsing  → fetching a URL
 *   streaming → tokens landing (bytes counter)
 */

export type WorkKind = "idle" | "reasoning" | "streaming" | "coding" | "command" | "reading" | "browsing";

const DOT_FRAMES    = ["   ", ".  ", ".. ", "..."];
const BRAIN_FRAMES  = ["◦◦◦", "•◦◦", "◦•◦", "◦◦•"];
const CODE_FRAMES   = ["[ ]", "{ }", "[_]", "{~}"];
const CMD_FRAMES    = [">", ">>", ">>>", ">>", ">"];
const READ_FRAMES   = ["◂", "◄", "◀", "◄"];
const WEB_FRAMES    = ["⇄", "↻", "⟳", "↻"];
const STREAM_FRAMES = ["▁", "▃", "▅", "▆", "▅", "▃"];

const META: Record<WorkKind, { frames: string[]; verb: string; colored?: boolean }> = {
  idle:      { frames: MINE_FRAMES,   verb: "Thinking",  colored: true },
  reasoning: { frames: MINE_FRAMES,   verb: "Reasoning", colored: true },
  streaming: { frames: STREAM_FRAMES, verb: "Writing" },
  coding:    { frames: CODE_FRAMES,   verb: "Writing code" },
  command:   { frames: CMD_FRAMES,    verb: "Running command" },
  reading:   { frames: READ_FRAMES,   verb: "Reading files" },
  browsing:  { frames: WEB_FRAMES,    verb: "Fetching page" },
};

export function Spinner({ label, kind = "idle", detail }: { label?: string; kind?: WorkKind; detail?: string }) {
  const [i, setI] = useState(0);
  const [start] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setI((n) => n + 1);
      setTick((n) => n + 1);
    }, 110);
    return () => clearInterval(t);
  }, []);
  const meta = META[kind];
  const secs = Math.floor((Date.now() - start) / 1000);
  const timeStr = secs >= 60 ? `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, "0")}` : `${secs}s`;
  // blink the elapsed counter every ~half second so the line feels alive even between frames
  const showTime = tick % 10 !== 9 || secs === 0;
  const frame = meta.frames[i % meta.frames.length]!;
  const frameStr = meta.colored ? frame : theme.brand(frame);
  const verb = label ?? meta.verb;
  const tail = showTime ? `${timeStr} · Ctrl+C to stop` : `${timeStr}  · Ctrl+C to stop`;
  return (
    <Text>
      {frameStr} {theme.bold(verb)}
      {detail ? theme.dim(` · ${detail.length > 48 ? detail.slice(0, 48) + "…" : detail}`) : ""}
      {theme.dim(` · ${tail}`)}
    </Text>
  );
}
