#!/usr/bin/env python3
"""GoPay String Tracker -> Figma Copy Library migration.

Implements docs/copy-identity-architecture.md (Final Implementation Contract).
Usage: migrate.py --src <dir with CSVs> --out <figma-copy-migration dir>
Deterministic except for first-time Copy ID minting (ledger keeps IDs stable on rerun).
"""
import argparse, csv, glob, hashlib, json, os, re, secrets, sys, time, unicodedata, collections

csv.field_size_limit(10 ** 9)
MAX_VARS = 4000
HOLD_ALIAS_HAZARD = True  # whole-value "{x}" strings look like DTCG alias refs to importers

# ----------------------------------------------------------------------------------------
# Per-file column maps (0-based). Explicit; no header autodetect.
# ----------------------------------------------------------------------------------------
TABS = {
    "INVESTMENT": dict(match="GOPAY - INVESTMENT", sec=0, screen=2, ctx=3, keys=[1], en=4, id=5,
                       notes=[6, 7, 8, 9, 12, 18], expl=[], vn=None, alts=[(6, 7)], default_domain="investment"),
    "LENDING": dict(match="3rd Party Lending", sec=0, screen=1, ctx=2, keys=[3], en=4, id=5,
                    notes=[6, 10], expl=[], vn=None, alts=[], default_domain="lending"),
    "INSURANCE": dict(match="GOPAY APP - INSURANCE", sec=0, screen=1, ctx=2, keys=[3], en=4, id=5,
                      notes=[6, 7], expl=[], vn=None, alts=[(8, 9)], default_domain="insurance"),
    "PAYMENT": dict(match="PAYMENT EXPERIENCE", sec=0, screen=1, ctx=2, keys=[3, 6, 7], en=4, id=5,
                    notes=[6, 7, 8, 9], expl=[], vn=6, alts=[(6, 7)], default_domain="payment"),
    "USER-SPEND": dict(match="USER SPEND", sec=0, screen=2, ctx=3, keys=[6], en=4, id=5,
                       notes=[6, 8, 10], expl=[], vn=7, alts=[], default_domain="promo"),
    "TABUNGAN": dict(match="GoPay Tabungan", sec=0, screen=2, ctx=3, keys=[1], en=4, id=5,
                     notes=[6], expl=[], vn=None, alts=[(7, 8), (9, 10)], default_domain="savings"),
    "CONSUMER": dict(match="CONSUMER EXPERIENCE", sec=0, screen=1, ctx=2, keys=[3], en=4, id=5,
                     notes=[8], expl=[7], vn=6, alts=[], default_domain="home"),
    "MONEY": dict(match="MONEY MANAGEMENT.csv", sec=0, screen=1, ctx=2, keys=[3], en=4, id=5,
                  notes=[7, 8], expl=[6], vn=None, alts=[], default_domain="transfer"),
}
TAB_ORDER = list(TABS)

KEY_RE = re.compile(r"^[a-z][a-zA-Z0-9_]*$")
LINK_RE = re.compile(r"(?i)^(figma( link)?|prd( research)?|design( link)?|link|ref|prd|figma:?)$|https?://")
ZW = re.compile("[​‌‍⁠﻿­]")
EXPL_RE = re.compile(r"(?i)(^|\W)((alt(ernative)?|opt(ion)?|var(iant)?)\.?\s*[-:]?\s*(\d+|[ivx]{1,3})\b|"
                     r"\((var|alt|opt|option)\s*\d+\)|exploration|alternative\s+[ivx0-9]+\b)")
OBS_RE = re.compile(r"(?i)\b(obsolete|outdated|deprecated|depricat\w*|not used|unused|old design|old version|"
                    r"old carousels|to be deleted|to delete)\b")
HINT_RE = re.compile(r"(?i)^\s*(same (as|with)\b.*|see above|as above)\s*$")
STUB_RE = re.compile(r"(?i)^\s*(etc\.*|\.\.\.+|…)\s*$")
INVALID_RE = re.compile(r"^\s*([-–—_.•*=]+|tbd|tbc|n/?a|todo|\?+)\s*$", re.I)

# ----------------------------------------------------------------------------------------
# Domain registry
# ----------------------------------------------------------------------------------------
DOMAINS = ["shared", "home", "payment", "transfer", "split-bill", "promo", "insurance", "investment",
           "savings", "lending", "finance", "account-safety", "transport", "group"]
KEY_DOMAIN = {
    "splitbill": "split-bill", "promotion": "promo", "coins": "promo", "voucher": "promo", "vouchers": "promo",
    "unifiedtransfer": "transfer", "request": "transfer", "requesttuntas": "transfer", "withdrawal": "transfer",
    "topup": "transfer", "topupandpay": "transfer", "customtopup": "transfer", "internationaltransfer": "transfer",
    "transfer": "transfer", "transactionhistory": "transfer", "refund": "transfer",
    "group": "group", "groupdetailspage": "group", "socialpage": "group", "sharedwallet": "group",
    "insurance": "insurance", "investment": "investment", "finance": "finance",
    "accountsafety": "account-safety", "screenblock": "account-safety", "block": "account-safety",
    "krlbooking": "transport", "parking": "transport", "skyparking": "transport", "secureparking": "transport",
    "transport": "transport", "emergencysaving": "savings", "tabungan": "savings", "pocket": "savings",
    "lending": "lending", "accountlinking": "payment", "paymentwidget": "payment", "mergedpayments": "payment",
    "crossborder": "payment", "nfc": "payment", "mpmscreen": "payment", "cpm": "payment",
    "universalscanner": "payment", "cardlinking": "payment", "oneklik": "payment", "qrisunlimited": "payment",
    "pendingpayment": "payment", "home": "home", "regionallaunch": "home", "gopaynext": "home",
    "miniapp": "home", "globalsearch": "home", "notifpreference": "home", "help": "home",
}
SECTION_RULES = {  # ordered regex -> domain, applied per tab before tab default
    "USER-SPEND": [(r"split bill|patungan|lender|borrower|creator different|ocr flow", "split-bill"),
                   (r"parking|krl|ticket|transport|redbus|one-way|round-trip|price comparison|gonearby", "transport"),
                   (r"top up|custom top|merged payments|qris unlimited|pending payment|payment options|netflix|imali", "payment"),
                   (r"group", "group"), (r"gopay next|mini app|miniverse|genie|global search|invite|widget \(ios|shortcut", "home")],
    "CONSUMER": [(r"sanction|blocked|security|call shield|3pd|pin\b|otp|login|account recovery|screen blocking|"
                  r"fraud|aman|account activity|strengthen pin", "account-safety"),
                 (r"group|social|mission", "group"),
                 (r"coins|scratch|ruby|gems|voucher|cashback|rewards|leaderboard|spin the wheel|judol|birthday|daily check", "promo"),
                 (r"jago|saldo|tabungan", "savings"), (r"credit card|debit card|cc/dc|wallet type|payment", "payment"),
                 (r"transfer|tagihan|history", "transfer"), (r"insurance", "insurance")],
    "MONEY": [(r"split bill", "split-bill"), (r"crypto|gold", "investment"),
              (r"expense|budget|pfm|financial report|diary|finance", "finance"),
              (r"term deposit|simpanan|panen|goal based|stecu|auto ?sweep|grow|piggy|tabungan|saving", "savings"),
              (r"insurance", "insurance")],
    "PAYMENT": [(r"pocket|tabungan", "savings"), (r"group|shared wallet|1:1", "group")],
    "INVESTMENT": [(r"simpanan|tabungan", "savings"), (r"loan application|credit application|repayment", "lending")],
    "INSURANCE": [], "LENDING": [], "TABUNGAN": [(r"transfer to va|umt", "transfer"), (r"cross-?sell|campaign|reward|coins", "promo")],
}
# concatenated-token aliases used when reading legacy keys (no camelCase splitting per architecture)
TOKEN_ALIAS = {"servererror": "server-error", "dialoguecard": "dialog", "dialogue": "dialog", "emptystate": "empty",
               "emptystat": "empty", "bottomsheet": "bottom-sheet", "apifailed": "api-failed", "errorstate": "error",
               "popup": "popup", "desc": "description"}
ROLE_TOKENS = {"title": "title", "header": "title", "heading": "title", "subtitle": "subtitle", "subheader": "subtitle",
               "description": "description", "desc": "description", "body": "description", "message": "description",
               "msg": "description", "cta": "cta", "button": "cta", "btn": "cta", "primarycta": "cta-primary",
               "secondarycta": "cta-secondary", "maincta": "cta-primary", "placeholder": "placeholder", "toast": "toast",
               "tooltip": "tooltip", "banner": "banner", "badge": "badge", "tab": "tab", "link": "link", "label": "label",
               "value": "value", "count": "value", "amount": "value", "name": "value", "helper": "helper", "hint": "helper",
               "info": "helper", "error": "error", "disclaimer": "disclaimer", "caption": "caption", "text": "text",
               "option": "option", "answer": "option", "pushtitle": "push-title", "pushbody": "push-body",
               "sms": "sms", "a11y": "a11y", "validation": "error"}
ROLE_VOCAB = {"title", "subtitle", "description", "cta", "link", "label", "value", "placeholder", "helper", "error",
              "toast", "tooltip", "banner", "badge", "tab", "option", "disclaimer", "caption", "push-title",
              "push-body", "sms", "email-subject", "email-body", "a11y", "text"}
CTX_ROLE_RULES = [  # ordered (regex on lowercased ctx, role)
    (r"push.*title|pn.*title|notif.*title", "push-title"), (r"push.*(body|desc)|pn.*(body|desc)|notif.*(body|desc)", "push-body"),
    (r"placeholder", "placeholder"), (r"\btoast\b", "toast"), (r"tooltip", "tooltip"),
    (r"\b(cta|button|btn)\b|primary|secondary", "cta"), (r"sub-?title|sub-?header|sub-?heading", "subtitle"),
    (r"\b(desc|description|body|content|paragraph|subtext|message|sub-?copy)\b", "description"),
    (r"\b(title|header|heading|headline)\b", "title"), (r"\b(error|validation|warning)\b", "error"),
    (r"\b(label|field|fields|name)\b", "label"), (r"\b(answer|option|radio|checkbox|choice)\b", "option"),
    (r"\b(helper|hint|info|note|tips?)\b", "helper"), (r"disclaimer|t&c|terms", "disclaimer"),
    (r"caption", "caption"), (r"badge|pill|tag\b", "badge"), (r"banner", "banner"), (r"\btab\b", "tab"),
    (r"\blink\b", "link"), (r"\b(value|amount|count|number)\b", "value"), (r"\bsms\b", "sms"),
]
ROLE_WORDS_RE = re.compile(r"(?i)\b(cta|button|btn|title|header|heading|headline|desc|description|body|placeholder|"
                           r"toast|tooltip|error state|error|label|field|fields|answer|option|primary|secondary|"
                           r"tertiary|text|copy|state|push|pn|notification|sub-?title)\b\s*\d*")
STOP_EN = set("the a an is are to of and for you your with this that it in on be we our will can not from or have has "
              "please your by at as if".split())
STOP_ID = set("yang dan di ke untuk kamu kami dengan ini itu akan bisa tidak gak ga dari atau ada sudah udah "
              "aja nih ya saya kita yuk mau lagi karena".split())

# ----------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------
CLEAN_STATS = collections.Counter()


def clean(s):
    if s is None:
        return ""
    o = s
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    if s != o:
        CLEAN_STATS["line_endings_normalized"] += 1
    t = ZW.sub("", s)
    if t != s:
        CLEAN_STATS["zero_width_removed"] += 1
    s = t.replace(" ", " ")
    if s != t:
        CLEAN_STATS["nbsp_to_space"] += 1
    t = s.strip()
    if t != s:
        CLEAN_STATS["outer_whitespace_trimmed"] += 1
    return t


def ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


EMOJI_RE = re.compile("[\U0001F000-\U0001FFFF☀-➿️‍⬀-⯿]")


def seg(s, drop_noise=False, maxlen=32):
    s = unicodedata.normalize("NFKD", s or "")
    s = EMOJI_RE.sub("", s)
    s = s.encode("ascii", "ignore").decode()
    s = re.sub(r"['’`]", "", s)
    s = s.replace("&", " and ").replace("+", " plus ").replace("%", " percent ").replace("#", " no ")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).lower().strip("-")
    if drop_noise:
        parts = [p for p in s.split("-") if p and p not in ("screen", "page", "new", "v2", "revamp", "revamped", "figma", "link")
                 and not re.fullmatch(r"20\d\d", p)]
        s = "-".join(parts)
    s = re.sub(r"-+", "-", s).strip("-")
    if len(s) > maxlen:
        cut = s[:maxlen]
        if "-" in cut and s[maxlen] != "-":
            cut = cut[:cut.rfind("-")]
        s = cut.strip("-")
    return s


def snake_ph(x):
    x = re.sub(r"[^A-Za-z0-9]+", "_", x.strip()).strip("_").lower()
    return x or "value"


def norm_en(s):
    return re.sub(r"[\s\W_]+", " ", (s or "").lower()).strip()


def crockford(n, length=26):
    A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    out = []
    for _ in range(length):
        out.append(A[n & 31])
        n >>= 5
    return "".join(reversed(out))


def uuid7_id():
    ms = int(time.time() * 1000) & ((1 << 48) - 1)
    r = int.from_bytes(secrets.token_bytes(10), "big")
    rand_a = (r >> 62) & 0xFFF  # 12 bits
    rand_b = r & ((1 << 62) - 1)  # 62 bits
    n = (ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return "cp_" + crockford(n)


ID_RE = re.compile(r"^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$")
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){3}$")

# ---- placeholders ----------------------------------------------------------------------
PH_DOUBLE = re.compile(r"\{\{\s*([^{}\n]+?)\s*\}\}")
PH_CURLY = re.compile(r"\{\s*([^{}\n]+?)\s*\}")
PH_ANGLE = re.compile(r"<\s*([A-Za-z][A-Za-z0-9_ ]{0,40}?)\s*>")
PH_SQUARE = re.compile(r"\[\s*([A-Za-z][A-Za-z0-9_ ]{0,40}?)\s*\]")
PH_POS = re.compile(r"%(?:\d+\$)?(?:\.\d+)?[sdf]")
PH_X = re.compile(r"(?<![A-Za-z])X{3,}(?![A-Za-z])")
HTML_TAGS = {"b", "i", "u", "br", "a", "p", "strong", "em", "span", "br/"}
MALFORMED = [re.compile(r"<[A-Za-z_][\w ]*[)\]}]"), re.compile(r"\{[^{}\n]*$"), re.compile(r"(?<![{\w])[A-Za-z_][\w]*\}(?!\})"),
             re.compile(r"\[[A-Za-z_][\w ]*[)>}]"), re.compile(r"\([A-Za-z_][\w]*>")]
LEGACY_LEFT = [re.compile(r"<[A-Za-z][A-Za-z0-9_ ]{0,40}?>"), PH_POS, PH_X, re.compile(r"\{\{"), re.compile(r"\[[A-Za-z][A-Za-z0-9_ ]*\]")]


def find_malformed(s):
    return [m.group(0) for r in MALFORMED for m in r.finditer(s)]


def normalize_ph(s):
    """returns (normalized, positional_count, notes). Positional -> '\x00POS\x00' markers."""
    notes = []
    s = PH_DOUBLE.sub(lambda m: "{" + snake_ph(m.group(1)) + "}", s)

    def cur(m):
        return "{" + snake_ph(m.group(1)) + "}"
    s = PH_CURLY.sub(cur, s)

    def ang(m):
        if m.group(1).strip().lower() in HTML_TAGS:
            return m.group(0)
        return "{" + snake_ph(m.group(1)) + "}"
    s = PH_ANGLE.sub(ang, s)
    s = PH_SQUARE.sub(lambda m: "{" + snake_ph(m.group(1)) + "}", s)
    s = PH_X.sub("\x00POS\x00", s)
    s = PH_POS.sub("\x00POS\x00", s)
    return s


POS_RULES = [(re.compile(r"Rp\s*\x00POS\x00|\x00POS\x00\s*(k|rb|K|jt|M)\b"), "amount"),
             (re.compile(r"\x00POS\x00\s*%"), "percentage"),
             (re.compile(r"(?i)\x00POS\x00\s*(menit|minutes?|mins?|jam|hours?|hari|days?|detik|seconds?|bulan|months?|"
                         r"tahun|years?|x\b|kali|times?|dependents?|tanggungan|items?|orang|people|vouchers?|kartu|cards?|"
                         r"kode|codes?|hasil|results?)"), "count")]


def resolve_positional(s):
    """Replace \x00POS\x00 by named placeholders only if every one is high-confidence. Returns (text, unresolved)."""
    n = s.count("\x00POS\x00")
    if n == 0:
        return s, 0
    out, last, used, unresolved = [], 0, collections.Counter(), 0
    for m in re.finditer("\x00POS\x00", s):
        win = s[max(0, m.start() - 4): m.end() + 14]
        name = None
        for rx, nm in POS_RULES:
            mm = rx.search(win.replace(s[m.start():m.end()], "\x00POS\x00"))
            if mm and mm.start() <= 4 + 4:
                name = nm
                break
        out.append(s[last:m.start()])
        if name is None:
            out.append("\x00POS\x00")
            unresolved += 1
        else:
            used[name] += 1
            out.append("{" + name + ("" if used[name] == 1 else "_%d" % used[name]) + "}")
        last = m.end()
    out.append(s[last:])
    return "".join(out), unresolved


def ph_set(s):
    return set(re.findall(r"\{([a-z0-9_]+)\}", s or ""))


def lang_score(s):
    w = re.findall(r"[a-z']+", (s or "").lower())
    return sum(x in STOP_EN for x in w), sum(x in STOP_ID for x in w)


ID_SHORT = set("ulangi simpan batal lanjut lanjutkan tutup selesai kembali hapus ubah bayar tarik oke nanti ajukan pilih "
               "konfirmasi perbarui kirim cari lihat mulai".split())


def looks_swapped(en, idv):
    ew = re.findall(r"[a-zà-ÿ']+", en.lower())
    iw = re.findall(r"[a-zà-ÿ']+", idv.lower())
    if ew and iw and len(ew) <= 2 and all(w in ID_SHORT for w in ew) and not any(w in ID_SHORT for w in iw) and en.lower() != idv.lower():
        return True
    a1, a2 = lang_score(en)
    b1, b2 = lang_score(idv)
    return len(en) > 12 and len(idv) > 12 and a2 >= 2 and a2 > a1 and b1 >= 2 and b1 > b2


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------------------
# Stage 1: parse + classify
# ----------------------------------------------------------------------------------------
def find_file(src, cfg):
    hits = [f for f in sorted(glob.glob(os.path.join(src, "GoPay Strings Tracker - *.csv"))) if cfg["match"] in f]
    if len(hits) != 1:
        raise SystemExit("cannot resolve source for %s: %s" % (cfg["match"], hits))
    return hits[0]


def cell(r, i):
    return clean(r[i]) if i is not None and i < len(r) else ""


def parse_tab(tab, path, out):
    cfg = TABS[tab]
    rows = list(csv.reader(open(path, encoding="utf-8", newline="")))
    stats = dict(records=len(rows) - 1, empty=0, section=0, link=0, stub_ctx=0)
    section, screen = "", ""
    sec_obs = sec_expl = False
    block_field = ""
    for rec, r in enumerate(rows[1:], start=2):
        r = list(r) + [""] * 30
        if not any(clean(c) for c in r):
            stats["empty"] += 1
            continue
        s0 = ws(cell(r, cfg["sec"]))
        en, idv = cell(r, cfg["en"]), cell(r, cfg["id"])
        scr, ctx = ws(cell(r, cfg["screen"])), ws(cell(r, cfg["ctx"]))
        # keys / notes / label-in-key-column
        key, notes, keylabel = "", [], ""
        for ci in cfg["keys"]:
            v = cell(r, ci)
            if not v:
                continue
            if KEY_RE.match(v) and "_" in v:
                if not key:
                    key = v
                elif key != v:
                    notes.append("extra_key:" + v)
            elif tab in ("PAYMENT", "USER-SPEND") and ci != cfg["keys"][0] or ci == 6 and tab == "USER-SPEND":
                notes.append(v)
            else:
                keylabel = ws(v)
        nonkey_text_cols = {}
        for ci in cfg["notes"] + ([cfg["vn"]] if cfg["vn"] is not None else []) + cfg["expl"]:
            v = cell(r, ci)
            if v and not (KEY_RE.match(v) and "_" in v):
                nonkey_text_cols[ci] = v
        expl_txt = " ".join(nonkey_text_cols.get(ci, "") for ci in cfg["expl"])
        note_txt = " ".join(v for ci, v in nonkey_text_cols.items() if ci not in cfg["expl"]) + " " + " ".join(notes)
        vn_val = nonkey_text_cols.get(cfg["vn"], "") if cfg["vn"] is not None else ""
        # alternate side-by-side pairs
        alts = []
        for a, b in cfg["alts"]:
            va, vb = cell(r, a), cell(r, b)
            if va and vb and not (KEY_RE.match(va) and "_" in va) and not (KEY_RE.match(vb) and "_" in vb) \
                    and not va.startswith("http") and len(va) > 1:
                alts.append((a, va, vb))
        ne = [i for i, c in enumerate(r) if clean(c)]
        # section header / link label handling
        if s0:
            if LINK_RE.search(s0) and len(s0) < 200:
                stats["link"] += 1
                if ne == [cfg["sec"]]:
                    out.append(dict(tab=tab, rec=rec, cls="LINK_LABEL", raw=s0))
                    continue
            else:
                section, screen, block_field = s0, "", ""
                sec_obs = bool(OBS_RE.search(section))
                sec_expl = bool(EXPL_RE.search(section))
                if ne == [cfg["sec"]]:
                    stats["section"] += 1
                    out.append(dict(tab=tab, rec=rec, cls="SECTION_HEADER", raw=s0, section=section))
                    continue
        if not en and not idv and not alts:
            # screen/context-only stub rows carry state forward but are not copy
            if scr:
                screen = scr
            out.append(dict(tab=tab, rec=rec, cls="INSTRUCTION_OR_REUSE_HINT" if (HINT_RE.search(ctx) or HINT_RE.search(scr)
                                                                                  or STUB_RE.search(ctx)) else "CONTEXT_STUB",
                            raw=" | ".join(x for x in (scr, ctx, keylabel) if x), section=section, screen=screen))
            continue
        if scr:
            screen = scr
        # context helpers
        hint = None
        if HINT_RE.search(ctx):
            hint, ctx = ctx, ""
        if HINT_RE.search(scr):
            hint = hint or scr
        if not ctx and keylabel:
            ctx = keylabel
        if re.fullmatch(r"(?i)fields?", ctx) and en:
            block_field = seg(en)
        elif re.fullmatch(r"(?i)page title", ctx):
            block_field = ""
        base = dict(tab=tab, rec=rec, section=section, screen=screen, ctx=ctx, key=key, hint=hint or "",
                    notes=ws(note_txt), vn=vn_val, block_field=block_field)
        flags_text = " ".join((section, screen, ctx, note_txt, expl_txt))
        is_obs = sec_obs or bool(OBS_RE.search(" ".join((screen, ctx, note_txt))))
        is_expl = sec_expl or bool(EXPL_RE.search(" ".join((screen, ctx, expl_txt, keylabel)))) \
            or bool(re.search(r"(?i)exploration", note_txt))
        if en or idv:
            if STUB_RE.search(en) and not idv or HINT_RE.search(en) and not idv:
                out.append(dict(base, cls="INSTRUCTION_OR_REUSE_HINT", raw=en))
            elif INVALID_RE.match(en or idv) and INVALID_RE.match(idv or en):
                out.append(dict(base, cls="INVALID", raw=en or idv, en=en, id=idv))
            else:
                cls = "OBSOLETE" if is_obs else ("EXPLORATION" if is_expl else "COPY")
                out.append(dict(base, cls=cls, en=en, id=idv, part=""))
        for (a, va, vb) in alts:
            out.append(dict(base, cls="OBSOLETE" if is_obs else "EXPLORATION", en=va, id=vb, part="alt%d" % a,
                            alt_note="side-by-side pair in cols %d/%d: alternate or extra field; unclear" % (a, a + 1)))
    return stats


# ----------------------------------------------------------------------------------------
# Stage 2: enrich copy records (placeholders, key parse, role, domain, names)
# ----------------------------------------------------------------------------------------
PUSH_CTX = re.compile(r"(?i)push|\bpn\b|notif(?!ication preference|ication permission)|whatsapp|\bwa\b")


def domain_from(tab, sec, key, screen):
    if key:
        toks = key.split("_")
        i = 0
        while i < len(toks) and toks[i] in ("gopay", "go", "pay", "opay", "vui", "descgopay"):
            i += 1
        if i < len(toks) and toks[i] in KEY_DOMAIN:
            return KEY_DOMAIN[toks[i]]
    low = (sec + " " + screen).lower()
    for rx, d in SECTION_RULES.get(tab, []):
        if re.search(rx, low):
            return d
    return TABS[tab]["default_domain"]


def parse_key(key):
    """returns (domain_token, feature, screen, context, role, qualifier) parts; any may be ''."""
    toks = key.split("_")
    i = 0
    while i < len(toks) and toks[i] in ("gopay", "go", "pay", "opay", "vui", "descgopay"):
        i += 1
    if i >= len(toks):
        return "", "", "", "", "", ""
    dom = toks[i]
    rest = toks[i + 1:]
    role, qual = "", ""
    if rest:
        last = rest[-1]
        if last in ROLE_TOKENS:
            role = ROLE_TOKENS[last]
            rest = rest[:-1]
        elif len(rest) >= 2 and rest[-2] in ("cta", "button") and rest[-1] not in ROLE_TOKENS:
            role, qual = "cta", seg(rest[-1])
            rest = rest[:-2]
        elif last.endswith("cta") and last[:-3] in ("primary", "secondary", "tertiary", "main"):
            role = "cta-" + ("primary" if last.startswith("main") else last[:-3])
            rest = rest[:-1]
    rest = [TOKEN_ALIAS.get(t, t) for t in rest]
    # collapse repeated adjacent tokens (typos like splitbill_gopay_splitbill)
    if len(rest) >= 3:
        f, s, c = rest[0], rest[1], "-".join(rest[2:])
    elif len(rest) == 2:
        f, s, c = rest[0], rest[1], ""
    elif len(rest) == 1:
        f, s, c = rest[0], "", ""
    else:
        f = s = c = ""
    return dom, seg(f), seg(s), seg(c), role, qual


def infer_role(rec, key_role, multi_push=None):
    if key_role:
        return key_role, "key"
    ctx = (rec["ctx"] or "").lower()
    if ctx:
        for rx, role in CTX_ROLE_RULES:
            if re.search(rx, ctx):
                if role == "cta":
                    if re.search(r"primary|cta\s*1\b|option 1|button 1", ctx):
                        return "cta-primary", "ctx"
                    if re.search(r"secondary|cta\s*2\b|option 2|button 2", ctx):
                        return "cta-secondary", "ctx"
                    if re.search(r"tertiary|cta\s*3\b", ctx):
                        return "cta-tertiary", "ctx"
                return role, "ctx"
    return "text", "unresolved"


def enrich(recs, ledger_names):
    """adds derived fields to copy-like records"""
    out = []
    for r in recs:
        if r["cls"] not in ("COPY", "EXPLORATION", "OBSOLETE"):
            continue
        en0, id0 = r.get("en", ""), r.get("id", "")
        r["en0"], r["id0"] = en0, id0
        out.append(r)
    return out


def split_push(r):
    """returns list of (part, en, id) or None. Splits title/body only when both locales have same >=2-line shape"""
    en, idv = r["en"], r["id"]
    if not (PUSH_CTX.search(r["section"] + " " + r["screen"] + " " + r["ctx"])):
        return None, None
    el = [x for x in en.split("\n")]
    il = [x for x in idv.split("\n")]
    if len(el) >= 2 and len(il) >= 2 and "---" not in en:
        def sp(lines):
            t = lines[0].strip()
            b = "\n".join(lines[1:]).strip("\n").strip()
            if not b and len(lines) > 2:
                b = "\n".join(l for l in lines[1:] if l.strip())
            return t, b
        et, eb = sp(el)
        it, ib = sp(il)
        if et and eb and it and ib and len(et) <= 90 and len(it) <= 110:
            return [("push-title", et, it), ("push-body", eb, ib)], None
        return None, "uncertain push split (title/body shape mismatch)"
    if len(el) >= 2 or len(il) >= 2:
        return None, "multi-line push cell in one locale only or single-line locale"
    return None, None


# ----------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    OUT = args.out
    for d in ("collections", "collections-draft", "registry", "reports"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)

    # ---- ledger (persistent, append-only) ----
    ledger_path = os.path.join(OUT, "registry", "migration-ledger.jsonl")
    fp2id, id2pk, id2pks, ledger_lines = {}, {}, {}, 0
    hist_pk = set()  # every platformKey ever issued (never reusable)
    rekeyed_from = collections.defaultdict(list)  # copyId -> old keys (kept as legacyKeys aliases)
    merged_logged, shared_rekeyed = set(), set()  # ledger events already written (idempotent reruns)
    if os.path.exists(ledger_path):
        for ln in open(ledger_path, encoding="utf-8"):
            if not ln.strip():
                continue
            e = json.loads(ln)
            ledger_lines += 1
            if e.get("legacyFingerprint"):
                fp2id.setdefault(e["legacyFingerprint"], e["copyId"])
            if e.get("event") == "merge":
                merged_logged.add(e["copyId"])
                continue
            if e.get("event") == "rekey" and e.get("reason") == "shared-merge":
                shared_rekeyed.add(e["copyId"])
            if e.get("event") == "rekey":
                id2pk[e["copyId"]] = e["to"]
                id2pks[e["copyId"]] = "generated-rev2"
                rekeyed_from[e["copyId"]].append(e["from"])
                hist_pk.update((e["from"], e["to"]))
                continue
            if e.get("platformKey"):
                id2pk[e["copyId"]] = e["platformKey"]
                id2pks[e["copyId"]] = e.get("platformKeySource", "generated")
                hist_pk.add(e["platformKey"])
    new_ledger = []

    # ---- parse ----
    recs, tabstats, srcfiles = [], {}, {}
    for tab in TAB_ORDER:
        p = find_file(args.src, TABS[tab])
        srcfiles[tab] = os.path.basename(p)
        tabstats[tab] = parse_tab(tab, p, recs)
    total_records = sum(s["records"] for s in tabstats.values())
    nonempty_copy_rows = sum(1 for r in recs if r["cls"] in ("COPY", "EXPLORATION", "OBSOLETE", "INVALID") and r.get("part", "") == "")

    # ---- build atomic copy items (split push, plural) ----
    items = []
    for r in recs:
        if r["cls"] not in ("COPY", "EXPLORATION", "OBSOLETE"):
            continue
        r["reviews"] = []
        parts, why = split_push(r)
        if why:
            r["reviews"].append(("UNCERTAIN_MULTILINE_SPLIT", why, False))
        if parts:
            for (role, e, i) in parts:
                items.append(dict(r, en=e, id=i, part=(r.get("part", "") + "#" + role).strip("#"), forced_role=role, split=True))
        else:
            items.append(dict(r, forced_role=None, split=False))
    # ---- placeholders / flags per item ----
    for it in items:
        it["reviews"] = list(it["reviews"])
        raw_en, raw_id = it["en"], it["id"]
        it["raw_en"], it["raw_id"] = raw_en, raw_id
        held = []
        for loc in ("en", "id"):
            v = it[loc]
            if not v:
                continue
            bad = find_malformed(v)
            if bad:
                it["reviews"].append(("MALFORMED_PLACEHOLDER", "%s: %r" % (loc.upper(), bad[0]), True))
                held.append("malformed")
        ne_, ni_ = normalize_ph(it["en"]) if it["en"] else "", normalize_ph(it["id"]) if it["id"] else ""
        # cross-locale positional adoption
        ce, ci = ne_.count("\x00POS\x00"), ni_.count("\x00POS\x00")
        named_e, named_i = re.findall(r"\{[a-z0-9_]+\}", ne_), re.findall(r"\{[a-z0-9_]+\}", ni_)
        if ce == 1 and ci == 0 and len(named_i) == 1 and not named_e:
            ne_ = ne_.replace("\x00POS\x00", named_i[0])
        elif ci == 1 and ce == 0 and len(named_e) == 1 and not named_i:
            ni_ = ni_.replace("\x00POS\x00", named_e[0])
        elif ce == 1 and ci == 1 and len(named_e) == 1 and not named_i:
            ni_ = ni_.replace("\x00POS\x00", named_e[0])
        elif ce == 1 and ci == 1 and len(named_i) == 1 and not named_e:
            ne_ = ne_.replace("\x00POS\x00", named_i[0])
        ne_, ue = resolve_positional(ne_)
        ni_, ui = resolve_positional(ni_)
        if ue or ui:
            it["reviews"].append(("UNRESOLVED_POSITIONAL_PLACEHOLDER", "positional placeholder (%s/%d, XXXXX) without high-confidence name" % ("%s", ue + ui), True))
            ne_ = ne_.replace("\x00POS\x00", "{unresolved}")
            ni_ = ni_.replace("\x00POS\x00", "{unresolved}")
            held.append("positional")
        it["en"], it["id"] = ne_, ni_
        it["ph_changed"] = (ne_ != raw_en) or (ni_ != raw_id)
        if it["en"] and it["id"] and ph_set(it["en"]) != ph_set(it["id"]):
            it["reviews"].append(("PLACEHOLDER_MISMATCH", "EN %s vs ID %s" % (sorted(ph_set(it["en"])), sorted(ph_set(it["id"]))), True))
        for loc in ("en", "id"):
            v = it[loc]
            if v and (re.search(r"\n---+\n|^---+$", v, re.M)):
                it["reviews"].append(("PLURAL_VARIANT", "packed singular/plural variants in %s (needs ICU plural)" % loc.upper(), True))
                break
        if it["en"] and it["id"]:
            if looks_swapped(it["en"], it["id"]):
                it["reviews"].append(("LANGUAGE_SWAP", "EN looks Indonesian and ID looks English", True))
            elif it["en"] == it["id"] and len(it["en"]) > 30 and not ph_set(it["en"]):
                it["reviews"].append(("UNTRANSLATED_LONG_EN_EQ_ID", "EN == ID for %d chars" % len(it["en"]), False))
        if not it["en"]:
            it["reviews"].append(("MISSING_EN", "EN empty", it["cls"] == "COPY"))
        if not it["id"]:
            it["reviews"].append(("MISSING_ID", "ID empty", it["cls"] == "COPY"))
        if it.get("alt_note"):
            it["reviews"].append(("SIDE_BY_SIDE_PAIR", it["alt_note"], False))
        if it["ctx"] == "" and it["forced_role"] is None:
            pass

    # ---- key groups / conflicts ----
    def pair(it):
        return (ws(it["en"]), ws(it["id"]))
    by_key = collections.defaultdict(list)
    for idx, it in enumerate(items):
        it["idx"] = idx
        if it["key"] and not it["split"]:
            by_key[it["key"]].append(it)
    key_variants = {}
    for k, lst in by_key.items():
        c = collections.Counter(pair(x) for x in lst)
        order = []
        for x in lst:
            if pair(x) not in order:
                order.append(pair(x))
        canon = sorted(order, key=lambda p: (-c[p], order.index(p)))[0]
        key_variants[k] = dict(variants=order, canon=canon, counts=c, tabs={x["tab"] for x in lst})
    # fingerprints
    tab_key_pairs = collections.defaultdict(set)
    for it in items:
        if it["key"]:
            tab_key_pairs[(it["tab"], it["key"])].add(pair(it))
    occ = collections.Counter()
    for it in items:
        part = it.get("part", "")
        if it["key"] and len(tab_key_pairs[(it["tab"], it["key"])]) == 1:
            basis = "%s|%s" % (it["tab"], it["key"])
        elif it["key"]:
            t = (it["tab"], it["key"], norm_en(it["en"]), part)
            occ[t] += 1
            basis = "%s|%s|%s|%d" % (it["tab"], it["key"], norm_en(it["en"]), occ[t])
        else:
            t = (it["tab"], it["section"], it["screen"], it["ctx"], norm_en(it["en"] or it["id"]), part)
            occ[t] += 1
            basis = "%s|%s|%s|%s|%s|%d" % (it["tab"], it["section"], it["screen"], it["ctx"], norm_en(it["en"] or it["id"]), occ[t])
        # rows sharing (tab,key,same pair) share fingerprint by design (same entity); split parts distinguished
        it["fp"] = sha(basis + ("|" + part if part else "") + ("|" + it["cls"] if it["cls"] != "COPY" else ""))

    # ---- clustering (union-find) ----
    parent = list(range(len(items)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    # rule 1: same key + same pair (any tab)
    seen = {}
    for it in items:
        if it["key"] and not it["split"] and it["cls"] == "COPY":
            k = (it["key"], pair(it))
            if k in seen:
                union(seen[k], it["idx"])
            else:
                seen[k] = it["idx"]
    # rule 2: same tab+section+screen+ctx+pair, text>20 chars, keys not conflicting
    seen = {}
    for it in items:
        if it["cls"] != "COPY" or len(ws(it["en"])) <= 20:
            continue
        k = (it["tab"], it["section"], it["screen"], it["ctx"], pair(it), it.get("part", ""))
        if k in seen:
            o = items[seen[k]]
            if (not o["key"] or not it["key"] or o["key"] == it["key"]):
                union(seen[k], it["idx"])
        else:
            seen[k] = it["idx"]
    clusters = collections.defaultdict(list)
    for it in items:
        clusters[find(it["idx"])].append(it)
    # ---- key-conflict split: entities keyed by cluster; canonical inherits key ----
    review_rows = []  # (severity, issue, entity_ref, source, detail)

    # ---- entity draft ----
    ents = []
    for root in sorted(clusters):
        lst = sorted(clusters[root], key=lambda x: x["idx"])
        first = lst[0]
        ents.append(dict(members=lst, first=first))

    # confirmed shared detection
    def is_confirmed_shared(e):
        lst = e["members"]
        keys = {x["key"] for x in lst if x["key"]}
        if len(keys) != 1:
            return False
        k = next(iter(keys))
        if k not in key_variants or e["first"]["split"]:
            return False
        kv = key_variants[k]
        if len(kv["variants"]) != 1:
            return False
        tabs = {x["tab"] for x in lst}
        rows = [x for x in items if x["key"] == k]
        tabs_all = {x["tab"] for x in rows}
        if len(tabs_all) >= 2 and e["first"]["cls"] == "COPY":
            return True
        if "_generic_" in k and len(rows) >= 2 and e["first"]["cls"] == "COPY":
            return True
        return False

    # ---- naming ----
    used_pk = set()
    for k in by_key:
        pass
    for e in ents:
        f = e["first"]
        lst = e["members"]
        key = f["key"]
        e["status"] = {"COPY": "active", "EXPLORATION": "draft", "OBSOLETE": "archived"}[f["cls"]]
        e["shared"] = is_confirmed_shared(e)
        dom = "shared" if e["shared"] else domain_from(f["tab"], f["section"], key, f["screen"])
        krole = kq = ""
        kf = ks = kc = ""
        if key:
            dt, kf, ks, kc, krole, kq = parse_key(key)
        role, rsrc = infer_role(f, krole)
        if f["forced_role"]:
            role, rsrc = f["forced_role"], "split"
        if role == "text" and PUSH_CTX.search(f["section"]) and f["ctx"] and re.search(r"(?i)title", f["ctx"]):
            role = "push-title"
        if kq and role == "cta":
            role = "cta-" + kq
        # feature / screen / context
        if key and (kf or ks):
            if e["shared"] and dt == "generic":
                toks = key.split("_")[2:]
                rest = [TOKEN_ALIAS.get(t, t) for t in toks]
                if rest and rest[-1] in ROLE_TOKENS:
                    rest = rest[:-1]
                feat = seg(rest[0]) if rest else "general"
                scr = seg(rest[-1]) if len(rest) >= 3 else "shared"
                ctxs = seg("-".join(rest[1:-1])) if len(rest) >= 3 else (seg(rest[1]) if len(rest) == 2 else "main")
            else:
                feat = kf or "general"
                scr = ks or seg(f["screen"], True) or "shared"
                ctxs = kc or seg(re.sub(ROLE_WORDS_RE, " ", f["ctx"]), True) or "main"
        else:
            feat = seg(re.sub(r"^\s*\d+\.\s*", "", f["section"]), True) or "general"
            scr = seg(f["screen"], True) or "shared"
            ctx_clean = re.sub(ROLE_WORDS_RE, " ", f["ctx"]) if rsrc == "ctx" or rsrc == "split" else f["ctx"]
            ctxs = seg(ctx_clean, True)
            if not ctxs and f["block_field"] and f["ctx"] and rsrc != "unresolved":
                ctxs = f["block_field"]
            ctxs = ctxs or "main"
        # locale codes forbidden as whole segments
        def loc_safe(s):
            return {"id": "identity", "en": "en-text", "vi": "vi-text"}.get(s, s)
        feat, scr, ctxs = loc_safe(feat), loc_safe(scr), loc_safe(ctxs)
        e.update(domain=dom, feature=feat or "general", screen=scr or "shared", context=ctxs or "main", role=role, role_src=rsrc,
                 leaf_base=role, hint=f["hint"], slug=seg(" ".join(w for w in norm_en(f["en"] or f["id"]).split()
                                                                  if w not in STOP_EN)[:60], maxlen=20))
        if rsrc == "unresolved":
            e["reviews"] = [("UNRESOLVED_ROLE", "role could not be inferred from key or context", False)]
        else:
            e["reviews"] = []
        if not f["screen"] and not key:
            e["reviews"].append(("SECTION_ONLY_CONTEXT", "screen unknown; feature taken from section", False)) if not f["ctx"] else None
        if role == "text" and not f["screen"] and not f["ctx"] and not key:
            pass
        for x in lst:
            for rv in x["reviews"]:
                if rv not in e["reviews"]:
                    e["reviews"].append(rv)

    # ---- allocate collections with cap, then unique names ----
    def base_collection_counts():
        c = collections.Counter()
        for e in ents:
            if e["status"] != "archived":
                c[e["domain"]] += 1
        return c
    cnt = base_collection_counts()
    for e in ents:
        e["collection"] = e["domain"]
    for dom, n in list(cnt.items()):
        if n <= MAX_VARS:
            continue
        featcnt = collections.Counter(e["feature"] for e in ents if e["domain"] == dom and e["status"] != "archived")
        remaining = n
        for feat, fn in featcnt.most_common():
            if remaining <= MAX_VARS:
                break
            if fn > MAX_VARS:
                pass
            for e in ents:
                if e["domain"] == dom and e["feature"] == feat and e["status"] != "archived":
                    e["collection"] = "%s-%s" % (dom, feat)
            remaining -= fn
    # archived entities keep base collection (registry only)
    # name uniqueness inside collection
    taken = collections.defaultdict(set)
    qual_notes = {}

    def ok_leaf(x):
        return x[:32].strip("-")
    for e in ents:  # document order; first-created keeps bare name
        coll = e["collection"]
        f_, s_, c_ = e["feature"], e["screen"], e["context"]
        base = e["leaf_base"]
        def nm(leaf):
            return "%s/%s/%s/%s" % (f_, s_, c_, ok_leaf(leaf))
        cand = base
        name = nm(cand)
        if name in taken[coll] and e["role"] == "text" and e["slug"]:
            cand = "%s-%s" % (base, e["slug"])
            name = nm(cand)
            e["qualifier_source"] = "text-slug"
        if name in taken[coll]:
            k = 2
            while nm("%s-%d" % (cand, k)) in taken[coll]:
                k += 1
            name = nm("%s-%d" % (cand, k))
            e["ordinal"] = k
        e["name"] = name
        taken[coll].add(name)
        e["name"] = name
    # ---- platform keys (legacy preserved when canonical & conflict-free) ----
    for cid, pk in id2pk.items():
        used_pk.add(pk)
    canon_owner = {}
    for e in ents:
        k = e["first"]["key"]
        if not k:
            continue
        if e["first"]["split"]:
            continue
        kv = key_variants[k]
        if pair(e["first"]) == kv["canon"] and k not in canon_owner and e["first"]["cls"] == "COPY":
            canon_owner[k] = e
    # ---- IDs from ledger + platform keys ----
    minted = 0
    for e in ents:
        ids = [fp2id[m["fp"]] for m in e["members"] if m["fp"] in fp2id]
        if ids:
            e["id"] = ids[0]
            e["id_reused"] = True
        else:
            while True:
                nid = uuid7_id()
                if nid not in id2pk and nid not in set(fp2id.values()):
                    break
            e["id"] = nid
            e["id_reused"] = False
            minted += 1
        for m in e["members"]:
            if m["fp"] not in fp2id:
                fp2id[m["fp"]] = e["id"]
                new_ledger.append(dict(legacyFingerprint=m["fp"], copyId=e["id"], tabId=m["tab"], sourceRecord=m["rec"],
                                       part=m.get("part", ""), event="ID_ASSIGNED"))
    for e in ents:
        k = e["first"]["key"]
        if e["id"] in id2pk:
            e["platformKey"] = id2pk[e["id"]]
            e["pk_source"] = id2pks.get(e["id"], "generated")
            continue
        if k and canon_owner.get(k) is e and k not in used_pk:
            e["platformKey"] = k
            e["pk_source"] = "legacy"
            used_pk.add(k)
    for e in ents:
        if "platformKey" in e:
            continue
        base = "gopay_" + re.sub(r"[/-]", "_", e["name"])
        pk, n = base, 2
        while pk in used_pk or pk in {x for x in by_key}:
            pk = "%s_%d" % (base, n)
            n += 1
        e["platformKey"] = pk
        e["pk_source"] = "generated"
        used_pk.add(pk)
    # ---- rev2 pre-release rekey (architecture §7 Rev 2) ----
    # Generated keys become gopay_<domain>[_feature][_screen][_context]_<role>[_qualifier][_n].
    # Runs once per entity: the ledger "rekey" event freezes the result (source generated-rev2).
    REV2_FILL = {"", "general", "shared", "main"}
    REV2_QUAL = {"primary", "secondary", "tertiary"}

    def rev2_tok(s):
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())

    def rev2_base(e):
        dom = rev2_tok(e["domain"])
        segs, prev = [], dom
        for s in (e["feature"], e["screen"], e["context"]):
            t = rev2_tok(s)
            if s in REV2_FILL or t in ("", dom, prev):
                continue
            segs.append(t)
            prev = t
        rp = [p for p in (e["leaf_base"] or "text").split("-") if p]
        role = rev2_tok("".join(rp[:-1])) + "_" + rp[-1] if len(rp) > 1 and rp[-1] in REV2_QUAL else rev2_tok("".join(rp))
        role = role or "text"
        # cap 100 chars (room for "_nn"): truncate context, then screen
        while len("_".join(["gopay", dom] + segs + [role])) > 96 and segs:
            i = len(segs) - 1
            over = len("_".join(["gopay", dom] + segs + [role])) - 96
            if len(segs[i]) - over >= 4:
                segs[i] = segs[i][:len(segs[i]) - over]
            else:
                segs.pop(i)
        return "_".join(["gopay", dom] + segs + [role])
    to_rekey = sorted((e for e in ents if e["pk_source"] == "generated"), key=lambda e: e["id"])
    reserved = {e["platformKey"] for e in ents if e["pk_source"] != "generated"} | hist_pk | set(by_key)
    for e in to_rekey:
        base = rev2_base(e)
        pk, n = base, 2
        while pk in reserved:
            pk = "%s_%d" % (base, n)
            n += 1
        reserved.add(pk)
        old = e["platformKey"]
        if e["id"] in id2pk:  # key already issued in an earlier run: log rekey, keep old as alias
            new_ledger.append(dict(event="rekey", copyId=e["id"], **{"from": old}, to=pk, reason="rev2-pre-release"))
            rekeyed_from[e["id"]].append(old)
        e["platformKey"] = pk
        e["pk_source"] = "generated-rev2"
    for e in ents:
        k0 = e["first"]["key"]
        if k0 and not e["first"]["split"] and canon_owner.get(k0) is not e and len(key_variants[k0]["variants"]) > 1:
            e["reviews"].append(("LEGACY_KEY_CONFLICT", "key %s maps to %d different copies; canonical variant kept the key, this entity has platformKey %s"
                                 % (k0, len(key_variants[k0]["variants"]), e["platformKey"]), False))
    # ---- legacy keys / sources on entities ----
    for e in ents:
        e["legacyKeys"] = sorted({m["key"] for m in e["members"] if m["key"]} | set(rekeyed_from.get(e["id"], [])))
        e["sources"] = [dict(tab=m["tab"], rec=m["rec"], part=m.get("part", ""), fp=m["fp"]) for m in e["members"]]
    for k, kv in key_variants.items():
        if len(kv["variants"]) > 1:
            pass

    # ---- import hold decisions ----
    for e in ents:
        e["held_reasons"] = sorted({r[0] for r in e["reviews"] if r[2]})
        f_ = e
        en_v = e["members"][0]["en"]
        id_v = e["members"][0]["id"]
        e["en"], e["id_val"] = en_v, id_v
        if e["status"] == "draft":
            e["held_reasons"] = [r for r in e["held_reasons"] if r not in ("MISSING_EN", "MISSING_ID")]
        if HOLD_ALIAS_HAZARD and e["status"] != "archived":
            if re.fullmatch(r"\{[a-z0-9_]+\}", en_v or "") or re.fullmatch(r"\{[a-z0-9_]+\}", id_v or ""):
                # writer review 2026-09-29: whole-value placeholders are data slots, not copy. Archive (registry
                # tombstone only; key stays reserved), no import, no review item.
                e["status"] = "archived"
                e["removed_reason"] = "WHOLE_VALUE_PLACEHOLDER"
                e["held_reasons"] = []
        if e["status"] == "active" and (not en_v or not id_v):
            for r in ("MISSING_EN" if not en_v else None, "MISSING_ID" if not id_v else None):
                if r and r not in e["held_reasons"]:
                    e["held_reasons"].append(r)
        e["import_held"] = bool(e["held_reasons"])

    # ---- shared classification of strings ----
    groups = collections.defaultdict(list)
    for e in ents:
        if e["status"] == "archived" or not e["en"]:
            continue
        groups[norm_en(e["en"])].append(e)
    CTA_LIST = ["got it", "continue", "cancel", "close", "done", "retry", "try again", "back", "next", "save", "edit",
                "delete", "confirm"]
    grp_info = {}
    for g, lst in groups.items():
        if len(lst) < 2:
            continue
        idc = collections.Counter(ws(x["id_val"]) for x in lst if x["id_val"])
        top, topn = (idc.most_common(1)[0] if idc else ("", 0))
        feats = {(x["domain"], x["feature"]) for x in lst}
        scrs = {(x["domain"], x["feature"], x["screen"]) for x in lst}
        doms = {x["domain"] for x in lst}
        roles = collections.Counter(x["role"] for x in lst)
        words = len(g.split())
        any_shared = any(x["shared"] for x in lst)
        share_top = topn / max(1, sum(idc.values()))
        rstar = roles.most_common(1)[0][0]
        if any_shared:
            cls, conf, reason = "CONFIRMED_SHARED", "high", "at least one entity already in shared via conflict-free multi-file legacy key"
        elif len(lst) >= 5 and len(feats) >= 3 and words <= 6 and share_top >= 0.6 and rstar != "text":
            cls, conf = "SHARED_CANDIDATE", "high" if share_top >= 0.8 else "medium"
            reason = "%d entities across %d features; dominant ID wording %.0f%%; dominant role %s" % (len(lst), len(feats), share_top * 100, rstar)
        elif len(feats) == 1 or words >= 10:
            cls, conf, reason = "CONTEXTUAL", "medium", "confined to one feature or long contextual copy; reuse would need intent confirmation"
        elif len(lst) >= 3 and share_top < 0.6:
            cls, conf, reason = "AMBIGUOUS", "low", "ID wording split across %d variants without dominant translation" % len(idc)
        elif len(lst) >= 5 and len(feats) >= 3 and rstar == "text":
            cls, conf, reason = "AMBIGUOUS", "low", "widely repeated but roles unresolved"
        else:
            cls, conf, reason = "CONTEXTUAL", "low", "few occurrences across features; same wording is not evidence of shared intent"
        grp_info[g] = dict(cls=cls, conf=conf, reason=reason, top=top, rstar=rstar, ents=lst, idc=idc, feats=feats,
                           scrs=scrs, doms=doms)
    for e in ents:
        e["shared_class"] = ""
        g = norm_en(e["en"]) if e["en"] else ""
        gi = grp_info.get(g)
        if e["shared"]:
            e["shared_class"] = "CONFIRMED_SHARED"
        elif gi:
            if gi["cls"] == "SHARED_CANDIDATE":
                if ws(e["id_val"]) == gi["top"] and e["role"] == gi["rstar"]:
                    e["shared_class"] = "SHARED_CANDIDATE"
                elif ws(e["id_val"]) != gi["top"]:
                    e["shared_class"] = "AMBIGUOUS"
                else:
                    e["shared_class"] = "CONTEXTUAL"
            else:
                e["shared_class"] = gi["cls"]

    # ---- shared promotion of ambiguous candidates (writer review 2026-09-29) ----
    # Ambiguous shared candidates are promoted to `shared`. Near-identical wordings (case, trailing ?!.:…,
    # & vs and, okay vs ok, curly quotes) collapse into one canonical entity with the dominant EN/ID;
    # the other entities are archived with mergedInto and their keys become aliases. Values with digits
    # or placeholders (prices, amounts, ranks) stay contextual.
    def share_norm(s):
        s = ws(s).replace("’", "'").replace("‘", "'").replace("&", "and")
        s = re.sub(r"[?!.…:]+$", "", s).strip().lower()
        return re.sub(r"\bokay\b", "ok", s)

    def value_like(s):
        return bool(re.search(r"\d|[{}<>\[\]%]|#x", s or "", re.I))
    sgroups = collections.defaultdict(list)
    for e in ents:
        if e["status"] != "active" or not e["en"] or value_like(e["en"]):
            continue
        if e["shared_class"] in ("AMBIGUOUS", "CONFIRMED_SHARED"):
            sgroups[share_norm(e["en"])].append(e)
    promoted = merged = id_unified = 0
    for g, lst in sorted(sgroups.items()):
        if not g or not any(x["shared_class"] == "AMBIGUOUS" for x in lst):
            continue
        lst = sorted(lst, key=lambda x: (not x["shared"], x["id"]))
        canon = lst[0]
        enc = collections.Counter(ws(x["en"]) for x in lst)
        en_c = sorted(enc.items(), key=lambda kv: (-kv[1], bool(re.search(r"[?!.…:]$", kv[0])), len(kv[0]), kv[0]))[0][0]
        idc = collections.Counter(ws(x["id_val"]) for x in lst if x["id_val"])
        id_c = sorted(idc.items(), key=lambda kv: (-kv[1], len(kv[0]), kv[0]))[0][0] if idc else canon["id_val"]
        rc = collections.Counter(x["role"] for x in lst if x["role"] != "text")
        role = rc.most_common(1)[0][0] if rc else "text"
        slug = rev2_tok(g)[:48] or "text"
        if canon["id"] in shared_rekeyed or canon["pk_source"] == "shared-merge":
            pk = canon["platformKey"]
        else:
            base = "gopay_shared_%s_%s" % (slug, rev2_tok(role.replace("-", "")) or "text")
            pk, n = base, 2
            while pk in reserved:
                pk = "%s_%d" % (base, n)
                n += 1
            reserved.add(pk)
            if canon["id"] in id2pk and pk != canon["platformKey"]:
                new_ledger.append(dict(event="rekey", copyId=canon["id"], **{"from": canon["platformKey"]}, to=pk, reason="shared-merge"))
            if pk != canon["platformKey"]:
                canon["legacyKeys"] = sorted(set(canon["legacyKeys"]) | {canon["platformKey"]})
        id_unified += sum(1 for x in lst if x["id_val"] and ws(x["id_val"]) != id_c)
        canon.update(domain="shared", collection="shared", feature="common", screen=re.sub(r"[^a-z0-9]+", "-", g).strip("-")[:32] or "shared",
                     context="main", role=role, platformKey=pk, pk_source="shared-merge", en=en_c, id_val=id_c,
                     shared=True, shared_class="CONFIRMED_SHARED")
        canon["name"] = "common/%s/main/%s" % (canon["screen"], role)
        promoted += 1
        for x in lst[1:]:
            canon["legacyKeys"] = sorted(set(canon["legacyKeys"]) | set(x["legacyKeys"]) | {x["platformKey"]})
            canon["sources"] = canon["sources"] + x["sources"]
            x.update(status="archived", merged_into=canon["id"], shared_class="MERGED", import_held=False, held_reasons=[])
            if x["id"] not in merged_logged:
                new_ledger.append(dict(event="merge", copyId=x["id"], into=canon["id"], reason="shared-merge"))
            merged += 1
    shared_merge_stats = dict(promoted=promoted, merged=merged, id_values_unified=id_unified)

    # ---- duplicates / review from possible-duplicate groups ----
    dup_rows = []
    ctxgrp = collections.defaultdict(list)
    for e in ents:
        if e["status"] == "archived" or not e["en"]:
            continue
        m0 = e["first"]
        ctxgrp[(m0["tab"], m0["section"], m0["screen"], m0["ctx"], pair(m0))].append(e)
    for k, lst in ctxgrp.items():
        if len(lst) > 1:
            kind = "SAME_CONTEXT_SAME_PAIR_SHORT" if len(ws(lst[0]["en"])) <= 20 else "SAME_CONTEXT_SAME_PAIR_LONG_KEY_DIFF"
            dup_rows.append((kind, lst))
    secgrp = collections.defaultdict(list)
    for e in ents:
        if e["status"] == "archived" or not e["en"] or e["shared"]:
            continue
        m0 = e["first"]
        secgrp[(m0["tab"], m0["section"], pair(m0))].append(e)
    for k, lst in secgrp.items():
        if len(lst) > 1 and len({(x["first"]["screen"], x["first"]["ctx"]) for x in lst}) > 1:
            dup_rows.append(("SAME_SECTION_SAME_PAIR_DIFF_SCREEN_OR_CONTEXT", lst))
    for k, lst in ((kk, v) for kk, v in {}.items()):
        pass
    pair_keys = collections.defaultdict(set)
    for e in ents:
        if e["status"] != "archived" and e["en"]:
            for m in e["members"]:
                if m["key"]:
                    pair_keys[(pair(m), m["tab"])].add(m["key"])
    for (p, tab), ks in pair_keys.items():
        if len(ks) > 1:
            lst = [e for e in ents if e["status"] != "archived" and any(m["key"] in ks and pair(m) == p and m["tab"] == tab for m in e["members"])]
            if len(lst) > 1:
                dup_rows.append(("IDENTICAL_PAIR_DIFFERENT_KEYS", lst))
    dup_flagged = set()
    for kind, lst in dup_rows:
        for e in lst:
            e["reviews"].append(("POSSIBLE_DUPLICATE", "%s (group of %d entities)" % (kind, len(lst)), False))
            dup_flagged.add(e["id"])

    # ambiguous shared review
    for e in ents:
        if e["shared_class"] == "AMBIGUOUS":
            e["reviews"].append(("AMBIGUOUS_SHARED_CANDIDATE", "wording repeated elsewhere; ID variant/role differs from dominant", False))

    # ---------------------------------------------------------------------------------
    # Emit
    # ---------------------------------------------------------------------------------
    def tok(e, loc):
        return e["en"] if loc == "EN" else e["id_val"]
    emit = collections.defaultdict(lambda: dict(active=[], draft=[]))
    for e in ents:
        if e["status"] == "archived" or e["import_held"]:
            continue
        if e["status"] == "draft" and (not e["en"] or not e["id_val"]):
            pass
        emit[e["collection"]][e["status"]].append(e)

    FILLER = {"general", "shared", "main"}
    def label(x):
        return " ".join(w.capitalize() for w in re.split(r"[-_ ]+", x) if w)
    def tok_desc(e):
        segs = [e["domain"], e["feature"], e["screen"], e["context"], e["role"]]
        ctx = " \u203a ".join(label(x) for i, x in enumerate(segs) if x and not (i > 0 and x in FILLER))
        d = "%s\n%s" % (e["id"], ctx)
        note = re.sub(r"\s+", " ", e["first"].get("notes") or "").strip()
        if note:
            d += "\nNote: " + note
        return d

    def nest(tokens, loc, coll):
        root = {}
        grp = root.setdefault(coll, {})
        for e in tokens:
            pk = e["platformKey"]
            assert not re.search(r"[./{}]", pk) and not pk.startswith("$"), "bad platformKey chars: %r" % pk
            assert pk not in grp, "duplicate platformKey in %s: %s" % (coll, pk)
            grp[pk] = {"$type": "string", "$value": tok(e, loc), "$description": tok_desc(e),
                       "$extensions": {"com.gopay.copy": {"id": e["id"], "status": e["status"], "platformKey": pk,
                                                          "semanticPath": e["name"]}}}
        return root

    def dump(path, obj):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
    for d in ("collections", "collections-draft"):
        base = os.path.join(OUT, d)
        for sub in glob.glob(os.path.join(base, "*")):
            for fn in glob.glob(os.path.join(sub, "*.json")):
                os.remove(fn)
    coll_sizes = {}
    for coll, dd in sorted(emit.items()):
        for st, folder in (("active", "collections"), ("draft", "collections-draft")):
            toks = dd[st]
            if not toks:
                continue
            for loc in ("EN", "ID"):
                dump(os.path.join(OUT, folder, coll, loc + ".json"), nest(toks, loc, coll))
        coll_sizes[coll] = (len(dd["active"]), len(dd["draft"]))

    # registry
    def ent_record(e):
        return dict(copyId=e["id"], name="%s/%s" % (e["collection"], e["platformKey"]), semanticPath=e["name"], collection=e["collection"], domain=e["domain"], library="GoPay App Copy",
                    feature=e["feature"], screen=e["screen"], context=e["context"], role=e["role"], roleSource=e["role_src"],
                    status=e["status"], platformKey=e["platformKey"], platformKeySource=e["pk_source"],
                    legacyKeys=e["legacyKeys"], legacySources=e["sources"],
                    localizedValues=dict(en=e["en"], id=e["id_val"]),
                    metadata=dict(shared=e["shared"], sharedClass=e["shared_class"], importHeld=e["import_held"],
                                  heldReasons=e["held_reasons"], reviewIssues=sorted({r[0] for r in e["reviews"]}),
                                  section=e["first"]["section"], screenSource=e["first"]["screen"], contextSource=e["first"]["ctx"],
                                  notes=e["first"]["notes"], reuseHint=e["hint"],
                                  thirdLanguage=e["first"]["vn"] or None,
                                  pushGroup=None, mergedRows=len(e["members"]),
                                  qualifierSource=e.get("qualifier_source"), ordinal=e.get("ordinal"),
                                  mergedInto=e.get("merged_into"), removedReason=e.get("removed_reason")))
    # push groups
    pg = collections.defaultdict(list)
    for e in ents:
        m = e["first"]
        if m["split"]:
            pg[(m["tab"], m["rec"], m.get("part", "").split("#")[0])].append(e)
    for k, lst in pg.items():
        gid = next((x["id"] for x in lst if x["first"]["forced_role"] == "push-title"), lst[0]["id"])
        for x in lst:
            x["push_group"] = gid
    reg_lines = []
    for e in sorted(ents, key=lambda x: x["id"]):
        rr = ent_record(e)
        rr["metadata"]["pushGroup"] = e.get("push_group")
        reg_lines.append(json.dumps(rr, ensure_ascii=False, sort_keys=True))
    open(os.path.join(OUT, "registry", "copy-registry.jsonl"), "w", encoding="utf-8").write("\n".join(reg_lines) + "\n")
    # ledger: append entity snapshot per entity only when new or changed; plus ID assignment lines
    prev_snap = {}
    if os.path.exists(ledger_path):
        for ln in open(ledger_path, encoding="utf-8"):
            if ln.strip():
                x = json.loads(ln)
                if x.get("event") == "ENTITY_SNAPSHOT":
                    prev_snap[x["copyId"]] = x["snapshotHash"]
    snaps = []
    for e in sorted(ents, key=lambda x: x["id"]):
        rr = ent_record(e)
        h = sha(json.dumps({("semanticName" if k == "semanticPath" else k): rr[k] for k in ("semanticPath", "collection", "status", "platformKey", "legacyKeys", "localizedValues")}, sort_keys=True, ensure_ascii=False))
        if prev_snap.get(e["id"]) != h:
            snaps.append(dict(event="ENTITY_SNAPSHOT", copyId=e["id"], snapshotHash=h, semanticName=e["name"], collection=e["collection"],
                              platformKey=e["platformKey"], platformKeySource=e["pk_source"], status=e["status"], legacyKeys=e["legacyKeys"],
                              legacySources=[dict(tab=s["tab"], rec=s["rec"], part=s["part"]) for s in e["sources"]],
                              localizedValues=dict(en=e["en"], id=e["id_val"]), metadata=dict(role=e["role"], feature=e["feature"], held=e["import_held"])))
    if new_ledger or snaps:
        with open(ledger_path, "a", encoding="utf-8") as f:
            for x in new_ledger + snaps:
                f.write(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n")

    # fingerprint map for idempotency test
    fpmap = {m["fp"]: e["id"] for e in ents for m in e["members"]}
    json.dump(fpmap, open(os.path.join(OUT, "reports", ".fingerprint-map.json"), "w"), sort_keys=True)

    # ---- reports ----
    def w_csv(name, header, rows):
        with open(os.path.join(OUT, "reports", name), "w", encoding="utf-8", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(rows)
    ent_of_fp = {m["fp"]: e for e in ents for m in e["members"]}
    # manifest
    man = []
    for r in recs:
        if r["cls"] in ("SECTION_HEADER", "LINK_LABEL", "CONTEXT_STUB", "INSTRUCTION_OR_REUSE_HINT", "INVALID"):
            act = {"SECTION_HEADER": "IGNORED_SECTION_HEADER", "LINK_LABEL": "IGNORED_LINK_LABEL", "CONTEXT_STUB": "IGNORED_CONTEXT_STUB",
                   "INSTRUCTION_OR_REUSE_HINT": "REUSE_HINT_ONLY", "INVALID": "INVALID"}[r["cls"]]
            man.append([srcfiles[r["tab"]], r["rec"], "", "", "", "", "", "", "", "", "", r["cls"], act, "n/a", "", r.get("raw", "")[:120]])
    for it in items:
        e = ent_of_fp[it["fp"]]
        st = e["status"]
        if e["shared"]:
            act = "CONFIRMED_SHARED"
        elif e.get("merged_into"):
            act = "MERGED_INTO_SHARED"
        elif st == "draft":
            act = "DRAFT_EXPLORATION"
        elif st == "archived":
            act = "ARCHIVE"
        elif any(x[2] for x in e["reviews"]):
            act = "REVIEW_REQUIRED"
        elif len(e["members"]) > 1 and it is not e["members"][0]:
            act = "MERGE_EXISTING_ENTITY"
        elif e["shared_class"] in ("SHARED_CANDIDATE", "CONTEXTUAL", "AMBIGUOUS"):
            act = "KEEP_CONTEXTUAL"
        else:
            act = "CREATE_NEW"
        rs = "held" if e["import_held"] else ("review" if e["reviews"] else "ok")
        man.append([srcfiles[it["tab"]], it["rec"] + 0, it["fp"], it["key"], it["raw_en"].replace("\n", "\\n"), it["raw_id"].replace("\n", "\\n"),
                    e["id"], e["collection"], e["name"], e["platformKey"], st, it["cls"], act, rs, it.get("part", ""), e["shared_class"]])
    man.sort(key=lambda x: (TAB_ORDER.index(next(t for t, n in srcfiles.items() if n == x[0])), x[1], str(x[14])))
    w_csv("migration-manifest.csv", ["source_file", "source_record", "legacy_fingerprint", "legacy_key", "EN_original", "ID_original",
                                     "copy_id", "collection", "semantic_name", "platform_key", "status", "row_class", "migration_action",
                                     "review_status", "source_part", "shared_classification"], man)
    # review
    rev = []
    for e in ents:
        seen_i = set()
        for (iss, det, blk) in e["reviews"]:
            if (iss, det) in seen_i:
                continue
            seen_i.add((iss, det))
            rev.append([iss, "BLOCKING" if blk else "REVIEW", e["id"], e["collection"], e["name"], e["status"],
                        ";".join("%s:%d" % (s["tab"], s["rec"]) for s in e["sources"][:6]), det[:240],
                        e["en"].replace("\n", "\\n")[:160], e["id_val"].replace("\n", "\\n")[:160]])
    for r in recs:
        if r["cls"] == "INVALID":
            rev.append(["INVALID_ROW", "REVIEW", "", "", "", "", "%s:%d" % (r["tab"], r["rec"]), "non-copy filler value", r.get("en", ""), r.get("id", "")])
    rev.sort(key=lambda x: (x[0], x[6]))
    w_csv("review-required.csv", ["issue_type", "severity", "copy_id", "collection", "semantic_name", "status", "source_rows", "detail", "EN", "ID"], rev)
    # duplicates
    drows = []
    gid = 0
    for e in ents:
        if len(e["members"]) > 1:
            gid += 1
            drows.append(["HIGH_CONFIDENCE_MERGED", "H%04d" % gid, e["id"], e["name"], len(e["members"]),
                          ";".join("%s:%d" % (s["tab"], s["rec"]) for s in e["sources"][:12]), ws(e["en"])[:100]])
    for kind, lst in dup_rows:
        gid += 1
        for e in lst:
            drows.append([kind, "P%04d" % gid, e["id"], e["name"], len(lst),
                          ";".join("%s:%d" % (s["tab"], s["rec"]) for s in e["sources"][:4]), ws(e["en"])[:100]])
    for k, kv in sorted(key_variants.items()):
        if len(kv["variants"]) > 1:
            for v in kv["variants"]:
                drows.append(["LEGACY_KEY_CONFLICT", k, "", "", kv["counts"][v], "canonical" if v == kv["canon"] else "split", v[0][:60] + " / " + v[1][:60]])
    w_csv("duplicate-analysis.csv", ["class", "group_id", "copy_id", "semantic_name", "group_size", "source_rows", "EN"], drows)
    # shared promotion
    sp = []
    for g, gi in sorted(grp_info.items(), key=lambda kv: (-len(kv[1]["ents"]), kv[0])):
        lst = gi["ents"]
        variants_en = collections.Counter(ws(x["en"]) for x in lst)
        sp.append([g, " | ".join("%s (%d)" % (v[:60], n) for v, n in variants_en.most_common(4)),
                   " | ".join("%s (%d)" % (v[:60], n) for v, n in gi["idc"].most_common(6)),
                   sum(len(x["members"]) for x in lst), len(gi["doms"]), len(gi["feats"]), len(gi["scrs"]),
                   " ".join(sorted({k for x in lst for k in x["legacyKeys"]})[:6]),
                   "shared/" + seg(g)[:24] + "/main/" + (gi["rstar"] if gi["rstar"] != "text" else "cta"),
                   gi["cls"], gi["conf"], gi["reason"],
                   ";".join("%s:%d" % (s["tab"], s["rec"]) for x in lst[:6] for s in x["sources"][:1])])
    w_csv("shared-promotion-candidates.csv", ["normalized_en", "EN_variants", "ID_variants", "occurrence_count", "distinct_domains",
                                             "distinct_features", "distinct_screens", "existing_legacy_keys", "recommended_shared_name",
                                             "classification", "confidence", "reason", "source_rows"], sp)
    # common CTA analysis
    cta_rows = []
    short_top = [g for g, gi in sorted(grp_info.items(), key=lambda kv: -len(kv[1]["ents"])) if len(g.split()) <= 3][:60]
    for g in dict.fromkeys(CTA_LIST + short_top):
        gi = grp_info.get(g)
        if not gi:
            cta_rows.append([g, 0, "", "", "", "", "", ""])
            continue
        cc = collections.Counter(x["shared_class"] for x in gi["ents"])
        cta_rows.append([g, sum(len(x["members"]) for x in gi["ents"]),
                         " | ".join("%s (%d)" % (v[:40], n) for v, n in gi["idc"].most_common(8)),
                         ",".join(sorted(gi["doms"])), len(gi["feats"]),
                         ",".join("%s:%d" % (r, n) for r, n in collections.Counter(x["role"] for x in gi["ents"]).most_common(6)),
                         " ".join(sorted({k for x in gi["ents"] for k in x["legacyKeys"]})[:5]),
                         ",".join("%s:%d" % (c or "NONE", n) for c, n in cc.most_common())])
    w_csv("common-cta-analysis.csv", ["normalized_en", "occurrences", "ID_variants", "domains", "distinct_features", "roles",
                                      "legacy_keys", "per_occurrence_classification"], cta_rows)
    # alias hazards / held list is in review-required. summary json for validator
    summary = dict(
        srcfiles=srcfiles, tabstats=tabstats, total_records=total_records,
        class_counts=dict(collections.Counter(r["cls"] for r in recs)),
        items=len(items), entities=len(ents), minted=minted, ledger_lines_before=ledger_lines,
        status=dict(collections.Counter(e["status"] for e in ents)),
        held=sum(1 for e in ents if e["import_held"]),
        confirmed_shared_entities=sum(1 for e in ents if e["shared"]),
        shared_merge=shared_merge_stats,
        removed_whole_value_placeholder=sum(1 for e in ents if e.get("removed_reason") == "WHOLE_VALUE_PLACEHOLDER"),
        confirmed_shared_rows=sum(len(e["members"]) for e in ents if e["shared"]),
        shared_candidate_groups=sum(1 for g in grp_info.values() if g["cls"] == "SHARED_CANDIDATE"),
        coll_sizes=coll_sizes, clean=dict(CLEAN_STATS),
        reviews=dict(collections.Counter(r[0] for r in rev)),
        review_entities=sum(1 for e in ents if e["reviews"]), blocking_entities=sum(1 for e in ents if e["import_held"]),
        contextual_dup_strings=sum(1 for g in grp_info.values() if g["cls"] in ("CONTEXTUAL", "SHARED_CANDIDATE", "AMBIGUOUS")),
        key_conflicts=sum(1 for kv in key_variants.values() if len(kv["variants"]) > 1),
    )
    json.dump(summary, open(os.path.join(OUT, "reports", ".summary.json"), "w"), indent=1, sort_keys=True, default=list)
    print(json.dumps({k: summary[k] for k in ("total_records", "class_counts", "entities", "minted", "status", "held")}, default=list))


if __name__ == "__main__":
    main()
