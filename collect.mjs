// Collects public job postings in the UAE and the Gulf from open career-site pages and writes them to data/.
// Rules this collector keeps:
//   - public pages and feeds only: no login, no key, no CAPTCHA, and it always says what it is (see UA)
//   - only paths the site's robots.txt allows
//   - facts only (title, company, place, link, date): no job description text is copied
//   - data/latest.json holds postings first seen in the last 48 hours; older rows drop out
// Node 20+, no dependencies. Run: node collect.mjs
import fs from "node:fs";

const UA = "gulf-tech-jobs-feed/1.0 (public job feed collector)";
const KEEP_HOURS = 48;
const started = new Date();
const sources = JSON.parse(fs.readFileSync("sources.json", "utf8"));
const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const COUNTRY = { AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman" };

async function get(url, init = {}) {
  const t0 = Date.now();
  const r = await fetch(url, { ...init, headers: { "user-agent": UA, "accept-language": "en", ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, ms: Date.now() - t0, body: r.ok ? await r.text() : "" };
}

// SAP SuccessFactors classic career site: /search/ is a plain HTML table, 25 rows a page, newest refresh first.
// The date in the table is a refresh date, not the first posting date, so posted_at stays empty and "new" means
// "an id this collector has not seen before".
async function successfactors(s) {
  const rows = [];
  let status = 0;
  for (let start = 0; start < 25 * 20; start += 25) {
    const r = await get(`https://${s.host}/search/?q=&optionsFacetsDD_country=${s.country}&sortColumn=referencedate&sortDirection=desc&startrow=${start}`, { headers: { accept: "text/html" } });
    status = r.status;
    if (r.status !== 200) throw new Error(`HTTP ${r.status} on page ${start / 25 + 1}`);
    const page = [...r.body.matchAll(/<tr class="data-row">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    for (const tr of page) {
      const href = tr.match(/href="(\/job\/[^"]+\/(\d+)\/)"/);
      const title = tr.match(/jobTitle-link[^>]*>([^<]+)</) || tr.match(/href="\/job\/[^"]+"[^>]*>([^<]+)</);
      const place = [...tr.matchAll(/class="jobLocation[^"]*">\s*([^<]*?)\s*</g)].map((m) => text(m[1])).find(Boolean) || "";
      const listed = [...tr.matchAll(/class="jobDate[^"]*">\s*([^<]*?)\s*</g)].map((m) => text(m[1])).find(Boolean) || "";
      if (!href || !title) continue;
      const cc = (place.match(/(?:^|,\s*)([A-Z]{2})$/) || [])[1];
      rows.push({
        id: `successfactors:${s.host}:${href[2]}`,
        source: "successfactors",
        company: s.company,
        title: text(title[1]),
        location: cc && COUNTRY[cc] ? place.replace(/(^|,\s*)[A-Z]{2}$/, `$1${COUNTRY[cc]}`) : place,
        url: `https://${s.host}${href[1]}`,
        posted_at: null,
        posted_precision: "unknown",
        listed_date: listed,
        second_hand: false,
      });
    }
    if (page.length < 25) break;
    await sleep(400);
  }
  return { status, rows };
}

// Workday reachability test: can this runner read a public Workday career-site search? Status codes only.
async function workdayTest(t) {
  const tenant = t.host.split(".")[0];
  try {
    const r = await get(`https://${t.host}/wday/cxs/${tenant}/${t.site}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "United Arab Emirates" }),
    });
    let total = null;
    try { total = JSON.parse(r.body).total ?? null; } catch { /* not JSON */ }
    return { host: t.host, status: r.status, ms: r.ms, total };
  } catch (e) {
    return { host: t.host, status: 0, error: String(e.message || e).slice(0, 120) };
  }
}

const seen = read("data/seen.json", {}); // id -> first seen (ISO)
const firstRun = Object.keys(seen).length === 0;
const meta = { started_at: started.toISOString(), finished_at: null, first_run: firstRun, sources: {}, workday_test: [], rows: 0 };
const listed = [];

for (const s of sources.successfactors || []) {
  const id = `successfactors:${s.host}`;
  try {
    const r = await successfactors(s);
    listed.push(...r.rows);
    meta.sources[id] = { ok: true, status: r.status, listed: r.rows.length, new: r.rows.filter((x) => !seen[x.id]).length };
  } catch (e) {
    meta.sources[id] = { ok: false, error: String(e.message || e).slice(0, 160) };
  }
}
for (const t of sources.workday_test || []) meta.workday_test.push(await workdayTest(t));

// first-seen book: only ids that are still listed are kept, so the file stays small. A source that failed keeps its ids.
const now = started.toISOString();
const failed = Object.entries(meta.sources).filter(([, v]) => !v.ok).map(([k]) => k);
const next = {};
for (const [id, at] of Object.entries(seen)) if (failed.some((f) => id.startsWith(f))) next[id] = at;
for (const r of listed) next[r.id] = seen[r.id] || now;
const cutoff = new Date(started.getTime() - KEEP_HOURS * 36e5).toISOString();
const rows = listed.map((r) => ({ ...r, first_seen: next[r.id] })).filter((r) => r.first_seen >= cutoff).sort((a, b) => (a.first_seen === b.first_seen ? a.id.localeCompare(b.id) : b.first_seen.localeCompare(a.first_seen)));

meta.rows = rows.length;
meta.finished_at = new Date().toISOString();
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/seen.json", JSON.stringify(next, null, 0));
fs.writeFileSync("data/latest.json", JSON.stringify({ generated_at: meta.finished_at, keep_hours: KEEP_HOURS, rows }, null, 1));
fs.writeFileSync("data/meta.json", JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
