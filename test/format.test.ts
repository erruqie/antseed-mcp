import { expect, test } from "bun:test";
import { clean } from "../src/format";

test("clean keeps untrusted text on one line and out of table syntax", () => {
  expect(clean("a|b\nc‮`d`")).toBe("a¦b c 'd'");
  expect(clean("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
});
