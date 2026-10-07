import React from "react";
import { Box, Text } from "ink";
import { logoLines } from "../logo.js";
import { VERSION } from "../constants.js";
import { theme } from "../theme.js";

export function Header({ model, loggedIn, keySource }: { model: string; loggedIn: boolean; keySource: string | null }) {
  const logo = logoLines();
  const info = [
    "",
    theme.brandBold("Unjailed AI") + " " + theme.dim(`v${VERSION}`),
    "",
    theme.dim("model  ") + model,
    loggedIn
      ? theme.dim("status ") + theme.ok("Logged in") + (keySource === "env" ? theme.dim(" (UNJAILED_API_KEY)") : "")
      : theme.dim("status ") + theme.warn("Not logged in") + theme.dim(" — type ") + "/login",
    "",
    theme.dim("Type / for commands · Ctrl+C to stop or exit"),
  ];
  return (
    <Box flexDirection="row" marginBottom={1} marginTop={1}>
      <Box flexDirection="column" marginRight={3} marginLeft={1}>
        {logo.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {info.map((l, i) => (
          <Text key={i} wrap="truncate-end">
            {l || " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
