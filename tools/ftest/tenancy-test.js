/* TENANCY — the seam that has to be right before anything multi-tenant is built on it.
 *
 * The failure this suite exists to prevent is one clinic reading another's data. That is not a bug
 * you fix in a patch release; it is the kind that ends the business. So the id rules are tested for
 * what they REJECT as much as what they accept, and containment is asserted independently of them.
 */
const path = require("path");
const __FCROOT = path.resolve(__dirname, "../..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL: " + m); } };

/* solo mode — his node, unchanged */
{
  delete process.env.FC_TENANCY;
  process.env.DATA_DIR = "/tmp/fc-test-data";
  const T = requireFresh("../../server/tenancy.js");
  ok(T.MODE === "solo", "solo is the default — a node with no configuration keeps working");
  const P = T.pathsFor("anything");
  ok(P.DATA_DIR === "/tmp/fc-test-data", "solo data sits at the root, not in a tenants subdirectory");
  ok(P.STATE_FILE === "/tmp/fc-test-data/state.json", "and state.json is exactly where it has always been");
  ok(P.PHOTO_DIR === "/tmp/fc-test-data/photos", "photos too");
  ok(P.BK_DIR === "/tmp/fc-test-data/state-backups", "and the backups");
  ok(P.tenantId === "solo", "the tenant is named solo regardless of what was asked for");
  /* a solo node must not be persuadable into multi-tenancy by a header */
  ok(T.tenantOf({ headers: { "x-fc-tenant": "someone-else" } }) === "solo",
     "a header cannot make a solo node serve another tenant");
}

/* multi mode — the clinic case */
{
  process.env.FC_TENANCY = "multi";
  process.env.DATA_DIR = "/tmp/fc-test-data";
  const T = requireFresh("../../server/tenancy.js");
  ok(T.MODE === "multi", "multi mode is opt-in through the environment");
  const P = T.pathsFor("harbor-clinic");
  ok(P.DATA_DIR === "/tmp/fc-test-data/tenants/harbor-clinic", "each tenant gets its own directory");
  ok(P.STATE_FILE.endsWith("/tenants/harbor-clinic/state.json"), "with its own state");
  ok(P.PHOTO_DIR.endsWith("/tenants/harbor-clinic/photos"), "its own photos");

  /* two tenants must not share anything */
  const A = T.pathsFor("clinic-a"), B = T.pathsFor("clinic-b");
  for (const k of ["DATA_DIR", "STATE_FILE", "PHOTO_DIR", "BK_DIR"])
    ok(A[k] !== B[k], "two tenants do not share " + k);

  /* ids that must be REFUSED — each of these is a way to read someone else's data */
  const evil = ["..", "../..", "a/../b", "clinic/../other", "/etc", "C:\\data", "clinic a",
                ".hidden", "clinic.", "a", "", null, undefined, 12, "CLINIC", "clinic--a",
                "ténant", "clinic\u0000", "clinic\n", "../tenants/other"];
  for (const id of evil)
    ok(!T.validId(id), "rejects id " + JSON.stringify(id));
  for (const id of evil) {
    let threw = false;
    try { T.pathsFor(id); } catch (e) { threw = true; }
    ok(threw, "and refuses to build a path for " + JSON.stringify(id));
  }

  /* ids that must be accepted — real clinic names */
  for (const id of ["harbor-clinic", "westside-weight", "dr-nguyen-md", "clinic1", "a1b2c3"])
    ok(T.validId(id), "accepts id " + id);

  /* containment holds independently of the id rules, so a future loosening cannot open a traversal */
  let escaped = false;
  try { T.assertContained("/tmp/fc-test-data/tenants/x"); } catch (e) { escaped = true; }
  ok(!escaped, "a path inside the root passes containment");
  escaped = false;
  try { T.assertContained("/tmp/elsewhere"); } catch (e) { escaped = true; }
  ok(escaped, "and one outside it does not");
  escaped = false;
  try { T.assertContained("/tmp/fc-test-data-other"); } catch (e) { escaped = true; }
  ok(escaped, "a sibling with the root as a string prefix is still outside it");

  /* request resolution */
  ok(T.tenantOf({ headers: { "x-fc-tenant": "harbor-clinic" } }) === "harbor-clinic",
     "a tenant can be resolved from the header");
  ok(T.tenantOf({ fcTenant: "from-session", headers: { "x-fc-tenant": "from-header" } }) === "from-session",
     "and a session beats a header, so a cookie cannot be overridden by one");
  let threw = false;
  try { T.tenantOf({ headers: {} }); } catch (e) { threw = true; }
  ok(threw, "a request with no tenant is refused rather than defaulted");
}

function requireFresh(rel) {
  const p = require.resolve(rel);
  delete require.cache[p];
  return require(p);
}

console.log("\nTENANCY: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
