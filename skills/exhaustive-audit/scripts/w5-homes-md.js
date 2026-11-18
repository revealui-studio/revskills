#!/usr/bin/env node
"use strict";
// Classification suggestions only; never semantic verification.
const { runCandidates } = require("./lib/review-candidates");

function classifyHome(p) {
  if (/\/archive\//.test(p) || /\/commands\/archive\//.test(p)) {
    return { status: "historical-ok", proof: "home:archived-command", tier: "L2" };
  }
  if (/\/cache\//.test(p)) {
    return { status: "generated-ok", proof: "home:cache", tier: "L2" };
  }
  if (
    /claude-home\/CLAUDE\.md$/.test(p) ||
    /grok-home\/AGENTS\.md$/.test(p) ||
    /grok-home\/rules\//.test(p) ||
    /claude-home\/rules\//.test(p)
  ) {
    return { status: "verified", proof: "home:policy-requires-cross-check", tier: "L4" };
  }
  if (/\/agents\//.test(p) || /\/commands\//.test(p)) {
    return { status: "verified", proof: "home:agent-or-command-review", tier: "L2" };
  }
  return { status: "verified", proof: "home:residual-review", tier: "L2" };
}

runCandidates("w5", classifyHome, ["--manifest-claude", "--manifest-grok"]);
