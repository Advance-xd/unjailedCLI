import React, { useEffect, useState } from "react";
import { Box, Text, render } from "ink";
import { theme, fxSparkle, fxSlate } from "../theme.js";

/** A short animated mascot that winks hello when the CLI starts, then settles.
 *  Rendered as its own tiny Ink app from index.tsx BEFORE the main UI, so it
 *  stays completely isolated from App. ~1.3s, then onDone. */

const EYE_OPEN = "◕";
const EYE_SHUT = "─";

// [leftEye, rightEye, sparkleLevel(0-3), showTagline]
type Frame = [string, string, number, boolean];
const FRAMES: Frame[] = [
  [EYE_SHUT, EYE_SHUT, 0, false],
  [EYE_OPEN, EYE_OPEN, 0, false],
  [EYE_OPEN, EYE_OPEN, 0, false],
  [EYE_OPEN, EYE_SHUT, 0, false], // wink!
  [EYE_OPEN, EYE_SHUT, 1, false],
  [EYE_OPEN, EYE_OPEN, 1, false],
  [EYE_OPEN, EYE_OPEN, 2, true],
  [EYE_OPEN, EYE_OPEN, 3, true],
  [EYE_OPEN, EYE_OPEN, 2, true],
  [EYE_OPEN, EYE_SHUT, 3, true], // cheeky second wink
  [EYE_OPEN, EYE_OPEN, 2, true],
  [EYE_OPEN, EYE_OPEN, 3, true],
  [EYE_OPEN, EYE_OPEN, 1, true],
];

function faceLines([left, right, spk, tag]: Frame): string[] {
  const s = (lvl: number, g: string) => (spk >= lvl ? fxSparkle(g) : " ");
  return [
    `   ${s(2, "✦")}            ${s(1, "✧")}`,
    `   ${theme.brand("╭───────────╮")}`,
    `   ${theme.brand("│")}  ${theme.brandBold(left)}     ${theme.brandBold(right)}  ${theme.brand("│")}`,
    `   ${theme.brand("│")}     ${theme.brand("‿")}     ${theme.brand("│")}`,
    `   ${theme.brand("╰───────────╯")}`,
    `   ${s(1, "⋆")}   ${tag ? theme.brandBold("Unjailed AI") : "           "}   ${s(3, "✦")}`,
    `        ${tag ? fxSlate("in your terminal") : ""}`,
  ];
}

export function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (i >= FRAMES.length - 1) return;
    const t = setTimeout(() => setI(i + 1), 85);
    return () => clearTimeout(t);
  }, [i]);

  useEffect(() => {
    if (i < FRAMES.length - 1) return;
    const t = setTimeout(onDone, 180);
    return () => clearTimeout(t);
  }, [i, onDone]);

  return (
    <Box flexDirection="column" marginY={1}>
      {faceLines(FRAMES[i]!).map((l, k) => (
        <Text key={k}>{l}</Text>
      ))}
    </Box>
  );
}

/** Render the intro as a standalone Ink app and resolve once it finishes.
 *  Unmounts itself so it never fights the main App for stdout. */
export async function playIntro(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    let instance: ReturnType<typeof render> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { instance?.unmount(); } catch { /* already gone */ }
      resolve();
    };
    instance = render(<Intro onDone={finish} />);
    setTimeout(finish, 2500); // safety net
  });
}
