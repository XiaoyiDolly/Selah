import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli.js";

const DRAFT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("post CLI boundary", () => {
  function testProgram() {
    const program = createProgram()
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    for (const command of program.commands) {
      command.exitOverride().configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    }
    return program;
  }

  it.each(["--body", "--scripture", "--input"])("rejects private or arbitrary posting option %s", async (option) => {
    const program = testProgram();
    await expect(program.parseAsync(["node", "selah", "post", DRAFT_ID, option, "secret"])).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  it("rejects extra positional posting data", async () => {
    const program = testProgram();
    await expect(program.parseAsync(["node", "selah", "post", DRAFT_ID, "private"])).rejects.toMatchObject({
      code: "commander.excessArguments",
    });
  });
});
