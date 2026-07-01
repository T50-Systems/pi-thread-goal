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

  it("parses widget toggle commands", () => {
    expect(parseGoalCommand("toggle")).toEqual({
      kind: "toggle",
      confirmed: false,
      replace: false,
      start: false,
    });
    expect(parseGoalCommand("expand")).toEqual({
      kind: "expand",
      confirmed: false,
      replace: false,
      start: false,
    });
    expect(parseGoalCommand("collapse")).toEqual({
      kind: "collapse",
      confirmed: false,
      replace: false,
      start: false,
    });
  });
});
