#!/usr/bin/env node
"use strict";
// Classification suggestions only; never semantic verification.
const { runCandidates } = require("./lib/review-candidates");

function classifyJv(p) {
  if (!p.startsWith(".jv/")) return null;

  // Ephemeral coordination — not product claims
  if (/\.claude\/workboard\.d\/(active|notes|log)\//.test(p)) {
    return { status: "non-claim", proof: "coordination:workboard-fragment", tier: "L2" };
  }
  if (/\.claude\/workboard\.md$/.test(p)) {
    return { status: "non-claim", proof: "coordination:workboard-root", tier: "L2" };
  }

  // Private CRM / business drafts / research (not customer-facing present claims)
  if (/\.crm\//.test(p)) {
    return { status: "historical-ok", proof: "private:crm", tier: "L2" };
  }
  if (/\/business\/drafts\//.test(p)) {
    return { status: "historical-ok", proof: "private:business-draft", tier: "L2" };
  }
  if (/\/docs\/(outreach|career|llc-formation|research|pipeline|audit-violations)\//.test(p)) {
    return { status: "historical-ok", proof: "private:research-or-ops-folder", tier: "L2" };
  }
  if (/\/docs\/audits\//.test(p)) {
    return { status: "historical-ok", proof: "private:audit-record", tier: "L2" };
  }
  if (/security-posture-remediation|branch-protection\//.test(p)) {
    return { status: "historical-ok", proof: "private:security-posture-record", tier: "L2" };
  }

  // Design / gap specs — full read; not live product UI claims
  if (/\/docs\/gap-specs\//.test(p) || /\/docs\/specs\//.test(p)) {
    return { status: "verified", proof: "design-spec:requires-review", tier: "L2" };
  }

  // Lane plans — full read
  if (/\/docs\/lanes\//.test(p)) {
    return { status: "verified", proof: "lane-plan:requires-review", tier: "L2" };
  }

  // Live policy / coordination rules — L4
  if (/\.claude\/rules\//.test(p) || /\.claude\/(DIRECTION|COORDINATION)\.md$/.test(p)) {
    return { status: "verified", proof: "policy:requires-cross-check", tier: "L4" };
  }
  if (/^\.jv\/CLAUDE\.md$/.test(p)) {
    return { status: "verified", proof: "policy:requires-cross-check", tier: "L4" };
  }

  // Marketing truth corpus (private planning, still load-bearing for copy)
  if (/\/docs\/marketing\//.test(p)) {
    return { status: "verified", proof: "marketing-canon:requires-cross-check", tier: "L4" };
  }

  // Runbooks / security / business canonical
  if (/\/docs\/(runbooks|security|business)\//.test(p) || /\/business\/[^/]+\.md$/.test(p)) {
    return { status: "verified", proof: "ops-or-business:requires-review", tier: "L2" };
  }

  // Scripts markdown / eval fixtures
  if (/\/scripts\//.test(p)) {
    return { status: "verified", proof: "script-doc:requires-review", tier: "L2" };
  }

  // Skills under .jv
  if (/\.claude\/skills\//.test(p)) {
    return { status: "verified", proof: "skill:requires-review", tier: "L2" };
  }

  // Default residual .jv
  return { status: "verified", proof: "jv-residual:requires-review", tier: "L2" };
}

runCandidates("w4", classifyJv, ["--manifest"]);
