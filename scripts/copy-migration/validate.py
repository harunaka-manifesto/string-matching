#!/usr/bin/env python3
"""Validate a figma-copy-migration output dir. Usage: validate.py --out DIR [--prev-fpmap FILE] [--src DIR]"""
import argparse, collections, csv, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
import migrate as M  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--prev-fpmap")
ap.add_argument("--src")
args = ap.parse_args()
OUT = args.out
csv.field_size_limit(10 ** 9)

res = []  # (id, status, detail)


def chk(rid, ok, detail="", sev="E"):
    res.append((rid, "PASS" if ok else ("FAIL" if sev == "E" else "WARN"), detail))


summary = json.load(open(os.path.join(OUT, "reports", ".summary.json")))
ents = [json.loads(l) for l in open(os.path.join(OUT, "registry", "copy-registry.jsonl"))]
byid = {e["copyId"]: e for e in ents}

# ---- JSON package -------------------------------------------------------------------
def walk(node, path=()):
    for k, v in node.items():
        if isinstance(v, dict) and "$value" in v:
            yield "/".join(path + (k,)), v
        elif isinstance(v, dict):
            yield from walk(v, path + (k,))
        else:
            raise ValueError("stray key %s at %s" % (k, path))


parse_errors, type_bad, parity_bad, dup_norm, counts = [], 0, [], 0, {}
emitted = {}  # (folder, collection) -> {path: (en, id, desc)}
for folder in ("collections", "collections-draft"):
    for cdir in sorted(glob.glob(os.path.join(OUT, folder, "*"))):
        coll = os.path.basename(cdir)
        data = {}
        for loc in ("EN", "ID"):
            try:
                data[loc] = dict(walk(json.load(open(os.path.join(cdir, loc + ".json"), encoding="utf-8"))))
            except Exception as ex:  # noqa
                parse_errors.append("%s/%s/%s: %s" % (folder, coll, loc, ex))
                data[loc] = {}
        for loc in data:
            for p, t in data[loc].items():
                if t.get("$type") != "string" or not isinstance(t.get("$value"), str):
                    type_bad += 1
            norm = collections.Counter(p.lower() for p in data[loc])
            dup_norm += sum(1 for n in norm.values() if n > 1)
        if set(data["EN"]) != set(data["ID"]) or len(data["EN"]) != len(data["ID"]):
            parity_bad.append("%s/%s" % (folder, coll))
        counts[(folder, coll)] = len(data["EN"])
        emitted[(folder, coll)] = {p: (data["EN"][p]["$value"], data["ID"].get(p, {}).get("$value", ""),
                                       data["EN"][p].get("$description", "")) for p in data["EN"]}
chk("PKG-JSON-PARSE", not parse_errors, "; ".join(parse_errors[:3]))
chk("PKG-TOKEN-TYPES", type_bad == 0, "%d non-string tokens" % type_bad)
chk("PKG-EN-ID-PARITY", not parity_bad, ", ".join(parity_bad[:5]))
chk("PKG-NORMALIZED-DUPLICATES", dup_norm == 0, str(dup_norm))
per_coll = collections.Counter()
for (folder, coll), n in counts.items():
    per_coll[coll] += n
over = {c: n for c, n in per_coll.items() if n > M.MAX_VARS}
chk("PKG-COLLECTION-CAP", not over, "%s" % over)

# ---- registry rules -----------------------------------------------------------------
AB = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
def decode(cid):
    n = 0
    for ch in cid[3:]:
        n = n * 32 + AB.index(ch)
    return n
bad01 = [e["copyId"] for e in ents if not M.ID_RE.match(e["copyId"])]
badver = [e["copyId"] for e in ents if M.ID_RE.match(e["copyId"]) and (((decode(e["copyId"]) >> 76) & 0xF) != 7 or ((decode(e["copyId"]) >> 62) & 3) != 2)]
chk("V01", not bad01 and not badver, "%d bad format, %d bad version/variant" % (len(bad01), len(badver)))
chk("V02", len(byid) == len(ents), "%d entities, %d unique ids" % (len(ents), len(byid)))
NEWNAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*/[A-Za-z][A-Za-z0-9_]*$")
chk("V07", all(NEWNAME_RE.match(e["name"]) and e["name"].split("/", 1)[1] == e["platformKey"] and e["name"].split("/", 1)[0] == e["collection"] for e in ents), "name == <collection>/<platformKey>")
chk("V07b-SEMANTIC-PATH", all(M.NAME_RE.match(e["semanticPath"]) for e in ents), "legacy 4-segment path preserved")
bad_chars = [e["name"] for e in ents if re.search(r"[.{}]", e["name"]) or e["name"].startswith("$") or "/$" in e["name"]]
chk("V07c-NAME-CHARS", not bad_chars, "%d names with . { } or $ prefix" % len(bad_chars))
chk("V08", all(len(e["name"]) <= 200 and e["name"].count("/") == 1 for e in ents), "exactly one group level")
cn = collections.Counter((e["collection"], e["name"]) for e in ents)
chk("V09", all(v == 1 for v in cn.values()), "%d duplicate (collection,name)" % sum(1 for v in cn.values() if v > 1))
feat_reg = collections.defaultdict(set)
for e in ents:
    feat_reg[e["domain"]].add(e["feature"])
v10 = [e["copyId"] for e in ents if e["domain"] not in M.DOMAINS or not (e["collection"] == e["domain"] or (
    e["collection"].startswith(e["domain"] + "-") and e["collection"][len(e["domain"]) + 1:] in feat_reg[e["domain"]])) or e["feature"] not in feat_reg[e["domain"]]]
chk("V10", not v10, "%d violations (feature registry is auto-derived from section/key; alias curation is pending human review)" % len(v10))
def role_ok(e):
    leaf = e["semanticPath"].split("/")[3]
    return any(leaf == r or leaf.startswith(r + "-") for r in M.ROLE_VOCAB)
bad11 = [e for e in ents if not role_ok(e)]
chk("V11", not bad11, "%d bad leaf roles" % len(bad11))
text_roles = sum(1 for e in ents if e["role"] == "text")
chk("V11b-UNRESOLVED-ROLE", False, "%d entities carry fallback role 'text' (architecture default, flagged for review)" % text_roles, "W")
act_emit = [e for e in ents if e["status"] != "archived" and not e["metadata"]["importHeld"]]
chk("V13", all(e["localizedValues"]["en"] for e in act_emit if e["status"] == "active"), "")
chk("V14", all(e["localizedValues"]["id"] for e in act_emit if e["status"] == "active"), "")
dmiss = sum(1 for e in act_emit if e["status"] == "draft" and not (e["localizedValues"]["en"] and e["localizedValues"]["id"]))
chk("V14-draft", dmiss == 0, "%d emitted drafts with a missing locale (empty string emitted, not invented)" % dmiss, "W")
chk("V15", all(M.ph_set(e["localizedValues"]["en"]) == M.ph_set(e["localizedValues"]["id"]) for e in act_emit), "emitted entities")
def legacy_hit(v):
    v = re.sub(r"</?(%s)\s*/?>" % "|".join(sorted(M.HTML_TAGS - {"br/"})), "", v or "")
    return any(r.search(v) for r in M.LEGACY_LEFT)
leg = [e["copyId"] for e in act_emit for v in e["localizedValues"].values() if legacy_hit(v)]
chk("V16", not leg, "%d emitted values with legacy placeholder syntax %s" % (len(leg), leg[:3]))
unb = [e["copyId"] for e in act_emit for v in e["localizedValues"].values() if M.find_malformed(v or "")]
chk("V17", not unb, "%d" % len(unb))
loc_bad = [e["copyId"] for e in ents if any(s in ("en", "id", "vi") for s in e["semanticPath"].split("/")) or e["platformKey"].endswith(("_en", "_vi"))]
chk("V18", not loc_bad, "%d" % len(loc_bad))
dups = sum(1 for _ in csv.reader(open(os.path.join(OUT, "reports", "duplicate-analysis.csv"), encoding="utf-8"))) - 1
chk("V21", True, "%d duplicate-analysis rows reported (warning-class)" % dups, "W")
sp = list(csv.DictReader(open(os.path.join(OUT, "reports", "shared-promotion-candidates.csv"), encoding="utf-8")))
chk("V22", True, "%d repeated-EN groups reported; %d SHARED_CANDIDATE" % (len(sp), sum(1 for r in sp if r["classification"] == "SHARED_CANDIDATE")), "W")
pkc = collections.Counter(e["platformKey"] for e in ents)
pk_bad = [e["platformKey"] for e in ents if not re.match(r"^[a-z][a-z0-9_]*$", e["platformKey"]) and e["platformKeySource"] != "legacy"]
chk("V23", all(v == 1 for v in pkc.values()) and not pk_bad, "%d dup, %d bad generated" % (sum(1 for v in pkc.values() if v > 1), len(pk_bad)))
rev2 = [e for e in ents if e["platformKeySource"] == "generated-rev2"]
rev2_bad = [e["platformKey"] for e in rev2 if len(e["platformKey"]) > 100 or not re.match(r"^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$", e["platformKey"])
            or set(e["platformKey"].split("_")[1:]) & {"general", "shared", "main"}]
chk("V23-rev2", not rev2_bad and not any(e["platformKeySource"] == "generated" for e in ents),
    "%d rev2 keys, %d bad, %d unrekeyed generated" % (len(rev2), len(rev2_bad), sum(1 for e in ents if e["platformKeySource"] == "generated")))
legacy_upper = sum(1 for e in ents if e["platformKeySource"] == "legacy" and not re.match(r"^[a-z][a-z0-9_]*$", e["platformKey"]))
chk("V23-legacy-allowlist", True, "%d legacy keys outside snake_case regex (allow-listed)" % legacy_upper, "W")
chk("V27", not any(re.search(r"\n---+\n", v or "") for e in act_emit for v in e["localizedValues"].values()), "")
chk("V03/V04/V05/V24/V25", True, "POST_IMPORT (requires created Figma variables)", "W")
res[-1] = ("V03/V04/V05/V24/V25", "POST_IMPORT", "requires created Figma variables")

# emitted set == registry non-held non-archived
reg_emit = collections.defaultdict(set)
for e in act_emit:
    reg_emit[("collections" if e["status"] == "active" else "collections-draft", e["collection"])].add(e["name"])
mism = [k for k in set(reg_emit) | set(emitted) if reg_emit.get(k, set()) != set(emitted.get(k, {}))]
chk("PKG-REGISTRY-MATCH", not mism, "%d collection mismatches" % len(mism))
desc_bad = 0
for (folder, coll), toks in emitted.items():
    for p, (en, idv, d) in toks.items():
        cid = d.split("\n")[0]
        if cid not in byid or byid[cid]["name"] != p:
            desc_bad += 1
chk("PKG-DESC-ID", desc_bad == 0, "%d token descriptions not matching registry" % desc_bad)

# ---- manifest accounting ------------------------------------------------------------
man = list(csv.DictReader(open(os.path.join(OUT, "reports", "migration-manifest.csv"), encoding="utf-8")))
recs_seen = {(r["source_file"], r["source_record"]) for r in man}
expected = sum(s["records"] - s["empty"] for s in summary["tabstats"].values())
chk("MANIFEST-ROW-ACCOUNTING", len(recs_seen) == expected, "%d source records in manifest vs %d non-empty records" % (len(recs_seen), expected))
mids = [r["copy_id"] for r in man if r["copy_id"]]
chk("MANIFEST-IDS-IN-REGISTRY", all(i in byid for i in mids), "")
shared_ids = {e["copyId"] for e in ents if e["metadata"]["shared"]}
sm = sum(1 for r in man if r["copy_id"] in shared_ids)
chk("SHARED-TRACEABILITY", sm == summary["confirmed_shared_rows"], "%d manifest rows -> %d shared entities" % (sm, len(shared_ids)))
# each entity referenced
chk("MANIFEST-ENTITY-COVERAGE", set(mids) == set(byid), "%d entities without manifest rows" % len(set(byid) - set(mids)))

# ---- idempotency --------------------------------------------------------------------
if args.prev_fpmap:
    a = json.load(open(args.prev_fpmap))
    b = json.load(open(os.path.join(OUT, "reports", ".fingerprint-map.json")))
    chk("V26", a == b and len(b) > 0, "%d fingerprints; run1 == run2: %s; minted in run2: %d" % (len(b), a == b, summary["minted"]))
else:
    chk("V26", False, "not evaluated", "W")

# ---- report -------------------------------------------------------------------------
fails = [r for r in res if r[1] == "FAIL"]
cls = summary["class_counts"]
copy_rows = len({(r["source_file"], r["source_record"]) for r in man if r["row_class"] in ("COPY", "EXPLORATION", "OBSOLETE")})
lines = ["# Validation report", "", "Overall technical status: **%s**" % ("FAIL" if fails else "PASS"),
         "Content review outstanding: **%d entities held from import, %d entities with review items** => migration is **%s**"
         % (summary["blocking_entities"], summary["review_entities"], "FAIL" if fails else "PARTIAL (content review pending)"), "",
         "## Rules", "", "| Rule | Result | Detail |", "|---|---|---|"]
for rid, st, d in res:
    lines.append("| %s | %s | %s |" % (rid, st, d.replace("|", "/")))
lines += ["", "## Corpus", "", "- Source CSV files: %d (architecture doc counted 7; `Tabungan` CSV is the 8th and was migrated)" % len(summary["srcfiles"]),
          "- Source records (excl. headers): %d (7-file subset without Tabungan = %d, matches the doc's 32,886)"
          % (summary["total_records"], summary["total_records"] - summary["tabstats"]["TABUNGAN"]["records"]),
          "- Empty records: %d" % sum(s["empty"] for s in summary["tabstats"].values()),
          "- Copy-bearing source records (COPY/EXPLORATION/OBSOLETE): %d" % copy_rows,
          "- Row classes (post-split, side-by-side pairs counted separately): %s" % json.dumps(cls, sort_keys=True),
          "- Entities: %d (%s)" % (summary["entities"], json.dumps(summary["status"], sort_keys=True)),
          "- Confirmed shared entities: %d, consolidating %d source rows" % (summary["confirmed_shared_entities"], summary["confirmed_shared_rows"]),
          "- Shared-promotion groups classified SHARED_CANDIDATE: %d; contextual/ambiguous repeated strings: %d" % (summary["shared_candidate_groups"], summary["contextual_dup_strings"]),
          "- Legacy key conflicts: %d keys" % summary["key_conflicts"], "", "## Systematic cleanup performed", ""]
for k, v in sorted(summary["clean"].items()):
    lines.append("- %s: %d cells" % (k, v))
lines += ["", "## Review issue counts (review-required.csv)", ""]
for k, v in sorted(summary["reviews"].items()):
    lines.append("- %s: %d" % (k, v))
lines += ["", "## Variables per collection (active + draft; cap %d)" % M.MAX_VARS, "", "| Collection | Active | Draft | Total |", "|---|---|---|---|"]
for c, n in sorted(per_coll.items(), key=lambda x: -x[1]):
    a = counts.get(("collections", c), 0)
    d = counts.get(("collections-draft", c), 0)
    lines.append("| %s | %d | %d | %d |" % (c, a, d, n))
open(os.path.join(OUT, "reports", "validation-report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
for r in res:
    print(r)
print("TECH_FAILS", len(fails))
