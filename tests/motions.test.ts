import { test } from "node:test";
import assert from "node:assert/strict";
import { findWordEnd, firstNonBlankCol, findCharOnLine, reverseFind } from "../src/motions.ts";

test("findWordEnd: start/middle of a word finds that word's last char", () => {
  assert.equal(findWordEnd("foo bar", 0), 2);
  assert.equal(findWordEnd("foo bar", 1), 2);
});

test("findWordEnd: from the word's last char, finds the NEXT word's end", () => {
  assert.equal(findWordEnd("foo bar", 4), 6);
});

test("findWordEnd: a word end at fromCol itself counts", () => {
  assert.equal(findWordEnd("foo", 2), 2);
  assert.equal(findWordEnd("foo   ", 2), 2);
});

test("findWordEnd: returns -1 when there is no word end after fromCol", () => {
  assert.equal(findWordEnd("foo", 3), -1);      // past the word's end, nothing ahead
  assert.equal(findWordEnd("foo   ", 3), -1);   // only whitespace after
  assert.equal(findWordEnd("", 0), -1);
});

test("firstNonBlankCol: first non-whitespace, 0 for blank lines", () => {
  assert.equal(firstNonBlankCol("  hi"), 2);
  assert.equal(firstNonBlankCol("hi"), 0);
  assert.equal(firstNonBlankCol("   "), 0);
});

test("findCharOnLine: f/F include the target, t/T land adjacent", () => {
  const line = "a(b)c(d)";
  assert.equal(findCharOnLine(line, 0, "(", "f"), 1);
  assert.equal(findCharOnLine(line, 8, ")", "F"), 7);
  assert.equal(findCharOnLine(line, 0, "(", "t"), 0);   // just before the paren
  assert.equal(findCharOnLine(line, 4, "(", "T"), 2);   // just after the prev paren (col 1)
});

test("findCharOnLine: -1 when the char is not found on the line", () => {
  assert.equal(findCharOnLine("ab", 0, "c", "f"), -1);
  assert.equal(findCharOnLine("ab", 1, "a", "f"), -1);  // nothing ahead
  assert.equal(findCharOnLine("ab", 0, "b", "F"), -1);  // nothing behind
});

test("findCharOnLine: adjacent t/T target yields a zero-motion result", () => {
  // t with target at cursor+1 -> target === cursor: callers must treat as failure
  assert.equal(findCharOnLine("a,b", 0, ",", "t"), 0);
  assert.equal(findCharOnLine("a,b", 2, ",", "T"), 2);
});

test("reverseFind flips f/F and t/T", () => {
  assert.equal(reverseFind("f"), "F");
  assert.equal(reverseFind("F"), "f");
  assert.equal(reverseFind("t"), "T");
  assert.equal(reverseFind("T"), "t");
});
