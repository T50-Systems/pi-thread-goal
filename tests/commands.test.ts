import { describe, expect, it } from "vitest";
import { parseGoalCommand } from "../src/commands.js";

describe("parseGoalCommand", () => {
  it("shows when empty", () => {
    expect(parseGoalCommand("")).toEqual({ kind: "show", confirmed: false, replace: false, start: false });
  });

  it("parses create with flags", () => {
    expect(parseGoalCommand("ship onboarding --replace --start")).toEqual({
      kind: "create",
      objective: "ship onboarding",
      confirmed: false,
      replace: true,
      start: true,
    });
  });

  it("parses control commands", () => {
    expect(parseGoalCommand("resume --start")).toEqual({
      kind: "resume",
      confirmed: false,
      replace: false,
      start: true,
    });
  });
});
