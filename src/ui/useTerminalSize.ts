import { useEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/** Current terminal size; re-renders when the window is resized. */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const read = (): TerminalSize => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);
  return size;
}
