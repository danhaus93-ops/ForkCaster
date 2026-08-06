"use strict";
/* ForkCaster tenancy — the seam between one household and many clinics.
 *
 * Everything the server stores hangs off DATA_DIR: state.json, photos, backups. That is the whole
 * tenancy surface, which is why this is a small file rather than a rewrite.
 *
 * SOLO mode is the default and is byte-identical to what shipped for two hundred releases: one
 * tenant called "solo", paths exactly where they are today. His Umbrel node keeps working with no
 * migration and no new configuration.
 *
 * MULTI mode resolves a tenant per request and gives each one its own directory. A tenant here is a
 * CLINIC, not a patient — a clinic's patients live inside its state, the same shape the app already
 * reads. That keeps the client unchanged for now: it still sees one state document.
 *
 * The rule this file exists to enforce: no handler may ever build a path from DATA_DIR directly.
 * They ask for the tenant's paths and get them, so a tenant can never read another's data by
 * getting a join wrong somewhere in two thousand lines.
 */
const path = require("path");
const fs = require("fs");

const MODE = process.env.FC_TENANCY === "multi" ? "multi" : "solo";
const ROOT = process.env.DATA_DIR || path.join(__dirname, "..", "data");

/* A tenant id becomes a directory name, so it must never be able to escape ROOT. Lowercase
   alphanumerics and dashes only — no dots, no slashes, no unicode lookalikes. Anything else is
   rejected rather than sanitised, because a silently-rewritten id would map two clinics onto one
   directory. */
const ID_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function validId(id) {
  return typeof id === "string" && ID_OK.test(id) && !id.includes("--");
}

/* Where a tenant's data lives. In solo mode this is ROOT itself — not ROOT/solo — because his
   existing data is already there and moving it would be a migration for no benefit. */
function dirFor(tenantId) {
  if (MODE === "solo") return ROOT;
  if (!validId(tenantId)) throw new Error("invalid tenant id");
  return path.join(ROOT, "tenants", tenantId);
}

/* The four paths every handler needs. Handlers call this instead of joining anything themselves. */
function pathsFor(tenantId) {
  const dir = dirFor(tenantId);
  return {
    tenantId: MODE === "solo" ? "solo" : tenantId,
    DATA_DIR: dir,
    STATE_FILE: path.join(dir, "state.json"),
    PHOTO_DIR: path.join(dir, "photos"),
    BK_DIR: path.join(dir, "state-backups"),
  };
}

/* Belt and braces: even with a validated id, assert the resolved path is genuinely inside ROOT.
   A future change to ID_OK cannot open a traversal without this failing first. */
function assertContained(p) {
  const rootReal = path.resolve(ROOT);
  const target = path.resolve(p);
  if (target !== rootReal && !target.startsWith(rootReal + path.sep))
    throw new Error("tenant path escaped the data root");
  return target;
}

function ensureDirs(tenantId) {
  const P = pathsFor(tenantId);
  assertContained(P.DATA_DIR);
  for (const d of [P.DATA_DIR, P.PHOTO_DIR, P.BK_DIR])
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return P;
}

/* Resolve the tenant for a request. In solo mode this ignores everything and returns solo, so an
   attacker cannot turn a single-tenant node into a multi-tenant one by sending a header. */
function tenantOf(req) {
  if (MODE === "solo") return "solo";
  const h = req && req.headers ? req.headers["x-fc-tenant"] : null;
  const fromSession = req && req.fcTenant ? req.fcTenant : null;
  const id = fromSession || h;
  if (!validId(id)) throw new Error("no tenant on request");
  return id;
}

module.exports = { MODE, ROOT, validId, dirFor, pathsFor, ensureDirs, assertContained, tenantOf };
