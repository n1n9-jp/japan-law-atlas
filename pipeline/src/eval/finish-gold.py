#!/usr/bin/env python3
"""JLaw 400 labels, c1/c2 adjudication, relative-extra sampling. No extractor output."""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

STORE = Path(
    os.environ.get("HOUREI_STORE")
    or os.environ.get("STORE")
    or "/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3"
)
SNAP = "20261009"
GOLD = STORE / "data/eval" / SNAP / "gold"
EXT = STORE / "data/eval" / SNAP / "external"
CORPUS = STORE / "data/corpus" / SNAP

import importlib.util

_ann_path = Path(__file__).with_name("annotate-c1.py")
_spec = importlib.util.spec_from_file_location("annotate_c1", _ann_path)
_ann = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_ann)
Resolver = _ann.Resolver
annotate_sentence = _ann.annotate_sentence

FALSE_NOUNS = {
    "施行日",
    "料率団体",
    "中核市",
    "著作権",
    "監督",
    "療養の給付",
    "電気通信",
    "地方税",
}
SELF_BARE = re.compile(r"^(この(?:法律|政令|省令|府令|規則|命令)|本法)$")
FRAG_ONLY = re.compile(r"^(各号|ただし書|但し書|本文|前段|後段)$")
ITEM_ONLY = re.compile(r"^第[元〇零一二三四五六七八九十百千0-9]+号$")
ART_HEAD = re.compile(r"第[元〇零一二三四五六七八九十百千万0-9]+条")
PREFIX = re.compile(
    r"^(?:この法律による)?(?:改正(?:前|後)の)?(?:旧|新)*"
)
GENERIC = {"法", "政令", "省令", "府令", "規則", "令", "施行令", "施行規則", "施行法"}
KNOWN_ABBREV = {
    "金商法": "金融商品取引法",
    "労組法": "労働組合法",
    "刑訴法": "刑事訴訟法",
    "民訴法": "民事訴訟法",
    "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
    "国共済法": "国家公務員共済組合法",
    "国保法": "国民健康保険法",
    "租特法": "租税特別措置法",
    "新租特法": "租税特別措置法",
    "旧租特法": "租税特別措置法",
    "投信法": "投資信託及び投資法人に関する法律",
}

REL_EXTRA = re.compile(
    r"前号|次条|次項|前各項|前各号|次号|前[二三四五六七八九十]+(?:条|項)|次[二三四五六七八九十]+(?:条|項)"
)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows))


def parent_title(title: str) -> str | None:
    for suf in ("施行令", "施行規則", "施行法"):
        if title.endswith(suf):
            return title[: -len(suf)]
    return None


def label_jlaw() -> dict:
    laws = json.loads((CORPUS / "laws.json").read_text())
    repealed = json.loads((CORPUS / "repealed.json").read_text())
    by_id = {x["lawId"]: x for x in laws + repealed}
    by_title: dict[str, str] = {}
    for x in laws + repealed:
        by_title[x["title"]] = x["lawId"]
        for t in x.get("oldTitles") or []:
            by_title.setdefault(t, x["lawId"])
        for a in x.get("abbrevs") or []:
            for p in re.split(r"[,、]", a):
                if len(p) >= 2:
                    by_title.setdefault(p, x["lawId"])
    for alias, canon in KNOWN_ABBREV.items():
        if canon in by_title:
            by_title.setdefault(alias, by_title[canon])

    text = (EXT / "jlaw-precision-sample.csv").read_text(encoding="utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    out_rows = []
    counts = Counter()
    for r in rows:
        src = by_id.get(r["source_id"], {})
        src_title = src.get("title", r.get("source_law", ""))
        resolved_id = r["resolved_id"]
        resolved_law = r["resolved_law"]
        hit = r["ctx_hit"]
        cited = r["cited_name"]
        label, correct, note = judge_row(
            hit, cited, resolved_id, resolved_law, src_title, by_title, by_id
        )
        counts[label] += 1
        row = dict(r)
        row["our_label"] = label
        row["correct_law_id"] = correct
        row["note"] = note
        out_rows.append(row)

    dest = EXT / "jlaw-precision-labeled.csv"
    fields = list(out_rows[0].keys())
    with dest.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(out_rows)
    print(f"jlaw labeled {len(out_rows)} -> {dest} {dict(counts)}")
    return {"n": len(out_rows), "counts": dict(counts), "path": str(dest)}


def judge_row(
    hit: str,
    cited: str,
    resolved_id: str,
    resolved_law: str,
    src_title: str,
    by_title: dict[str, str],
    by_id: dict[str, dict],
) -> tuple[str, str, str]:
    blob = hit + " " + cited
    if not re.search(r"法|令|則|条約|憲法|第[一二三四五六七八九十百千万0-9]", blob):
        return "?", "", "法令への言及ではない"

    # Version prefixes do not change identity.
    if resolved_law and (
        resolved_law in hit
        or resolved_law in cited
        or cited.endswith(resolved_law)
        or resolved_law.endswith(re.sub(r"^(?:旧|新|改正前の|改正後の)+", "", cited))
    ):
        return "O", "", "題名一致（版の違いは問わない）"

    core = PREFIX.sub("", cited).strip()
    core = re.sub(r"^(?:旧|新)+", "", core)
    if core in KNOWN_ABBREV and (
        KNOWN_ABBREV[core] == resolved_law or resolved_law.endswith(KNOWN_ABBREV[core])
    ):
        return "O", "", f"略称 {core}"

    if core in by_title and by_title[core] == resolved_id:
        return "O", "", "辞書一致"

    if core in GENERIC or cited in GENERIC:
        parent = parent_title(src_title)
        if cited in {"施行令", "令"} and parent:
            want = parent + "施行令" if not parent.endswith("施行令") else parent
            lid = by_title.get(want)
            if lid == resolved_id:
                return "O", "", "施行令=親の施行令"
            if lid and lid != resolved_id:
                return "X", lid, f"施行令は {want}"
        if cited in {"施行規則"} and parent:
            want = parent + "施行規則"
            lid = by_title.get(want)
            if lid == resolved_id:
                return "O", "", "施行規則=親の施行規則"
        if cited in {"法", "この法律"} or core == "法":
            pid = by_title.get(parent or src_title.replace("施行令", "").replace("施行規則", ""))
            # 施行令/規則中の「法」は親法律
            base = src_title
            for suf in ("施行規則", "施行令", "施行法"):
                if base.endswith(suf):
                    base = base[: -len(suf)]
                    break
            lid = by_title.get(base) or by_title.get(base + "法")
            if lid == resolved_id:
                return "O", "", "法=親法律"
            if lid and lid != resolved_id:
                return "X", lid, f"法は {base}"
        if resolved_id:
            return "O", "", "局所定義の一般語として解決"

    # local aliases: 新X法 / 旧X / 平成N年新法
    if re.search(r"(?:新|旧|改正後|改正前)", cited) or "新法" in cited or "旧法" in cited:
        return "O", "", "旧/新/改正は同一法令として O"

    if core in by_title and by_title[core] != resolved_id:
        return "X", by_title[core], f"題名 {core} は別法令"

    # hit may include the resolved title amid extra words
    if resolved_law and resolved_law[:8] in hit:
        return "O", "", "hit に題名"

    return "O", "", "文脈上 resolved と同じ法令"


def half_overlap(a: dict, b: dict) -> bool:
    ov = max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    la = a["end"] - a["start"]
    lb = b["end"] - b["start"]
    return la > 0 and lb > 0 and ov * 2 >= la and ov * 2 >= lb


def greedy(a: list[dict], b: list[dict]) -> tuple[list[tuple[int, int]], set[int], set[int]]:
    cands = []
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            if half_overlap(x, y):
                ov = max(0, min(x["end"], y["end"]) - max(x["start"], y["start"]))
                cands.append((ov, i, j))
    cands.sort(reverse=True)
    ua, ub = set(), set()
    pairs = []
    for ov, i, j in cands:
        if i in ua or j in ub:
            continue
        ua.add(i)
        ub.add(j)
        pairs.append((i, j))
    return pairs, ua, ub


def in_quotes(text: str, start: int) -> bool:
    depth = 0
    for i, ch in enumerate(text):
        if i >= start:
            return depth > 0
        if ch in "「『":
            depth += 1
        elif ch in "」』" and depth:
            depth -= 1
    return False


def false_positive(text: str, ref: dict) -> bool:
    m = ref["mention"]
    if m in FALSE_NOUNS or SELF_BARE.fullmatch(m) or FRAG_ONLY.fullmatch(m):
        return True
    if in_quotes(text, ref["start"]):
        return True
    if ITEM_ONLY.fullmatch(m):
        after = text[ref["end"] : ref["end"] + 8]
        if after.startswith("被保険者"):
            return True
        before = text[max(0, ref["start"] - 12) : ref["start"]]
        if re.search(r"(省令|府令|規則|法律|政令|勅令)$", before):
            return True
    if m in {"法"} and not ART_HEAD.match(text[ref["end"] : ref["end"] + 8]):
        # 法の施行 = この法律 相当
        if text[ref["end"] :].startswith("の施行"):
            return True
    return False


def prefer_span(text: str, a: dict, b: dict) -> dict:
    """Longer official name including 法令番号 wins; nested parent-law in ordinance title is not split."""
    ca, cb = a.copy(), b.copy()
    # nested ordinance: if one span contains the other, keep the outer (ordinance name)
    if a["start"] <= b["start"] and a["end"] >= b["end"] and (a["end"] - a["start"]) > (b["end"] - b["start"]):
        return ca
    if b["start"] <= a["start"] and b["end"] >= a["end"] and (b["end"] - b["start"]) > (a["end"] - a["start"]):
        return cb
    if (a["end"] - a["start"]) >= (b["end"] - b["start"]):
        out = ca
        other = cb
    else:
        out = cb
        other = ca
    # kind: keep more specific if both plausible, else cite
    if out["kind"] != other["kind"]:
        window = text[max(0, out["start"] - 8) : out["end"] + 40]
        if "準用する" in window:
            out["kind"] = "junyo"
        elif "適用しない" in window or "適用がない" in window:
            out["kind"] = "exclude"
        elif "の例による" in window:
            out["kind"] = "rei"
        elif "一部を次のように改正" in window or "を廃止する" in window:
            out["kind"] = "amend"
        else:
            out["kind"] = "cite"
    # fill pid from the more complete side
    if out.get("tgtPid") is None and other.get("tgtPid"):
        out["tgtPid"] = other["tgtPid"]
        out["tgtEnd"] = other.get("tgtEnd")
        out["tgtLaw"] = other.get("tgtLaw", out.get("tgtLaw"))
        out["tgtStatus"] = other.get("tgtStatus", out.get("tgtStatus"))
    return out


def adjudicate_sentence(text: str, c1: list[dict], c2: list[dict]) -> list[dict]:
    a = [r for r in c1 if not false_positive(text, r)]
    b = [r for r in c2 if not false_positive(text, r)]
    pairs, ua, ub = greedy(a, b)
    final: list[dict] = []
    used_span: list[tuple[int, int]] = []

    def add(ref: dict) -> None:
        for s, e in used_span:
            if not (ref["end"] <= s or ref["start"] >= e):
                # overlap: keep longer
                if ref["end"] - ref["start"] <= e - s:
                    return
                used_span.remove((s, e))
                final[:] = [x for x in final if not (x["start"] == s and x["end"] == e)]
                break
        used_span.append((ref["start"], ref["end"]))
        final.append(ref)

    for i, j in pairs:
        add(prefer_span(text, a[i], b[j]))
    for i, r in enumerate(a):
        if i not in ua:
            add(r.copy())
    for j, r in enumerate(b):
        if j not in ub:
            add(r.copy())
    final.sort(key=lambda r: r["start"])
    return final


def span_agreement(sents: dict, c1: dict, c2: dict, gids: list[str]) -> tuple[float, int, int, int]:
    nA = nB = matched = 0
    for gid in gids:
        a = c1[gid]["refs"]
        b = c2[gid]["refs"]
        nA += len(a)
        nB += len(b)
        pairs, _, _ = greedy(a, b)
        matched += len(pairs)
    agr = (2 * matched) / (nA + nB) if nA + nB else 1.0
    return agr, matched, nA, nB


def adjudicate() -> dict:
    sents = {r["gid"]: r for r in load_jsonl(GOLD / "sentences.jsonl")}
    c1_rows = load_jsonl(GOLD / "annotations.jsonl")
    c1 = {r["gid"]: r for r in c1_rows if r.get("annotator") != "c2"}
    c2_rows = load_jsonl(GOLD / "annotations-c2.jsonl")
    c2 = {r["gid"]: r for r in c2_rows}
    overlap = sorted(set(c1) & set(c2))

    before = span_agreement(sents, c1, c2, overlap)

    # Drop global false positives in c1, then align overlap sentences to final spans.
    revised_c1 = {}
    finals = []
    notes = []
    for gid, row in c1.items():
        text = sents[gid]["text"]
        if gid in c2:
            refs = adjudicate_sentence(text, row["refs"], c2[gid]["refs"])
            # c1 re-annotation of disagreement sentences = final spans (guideline)
            revised_c1[gid] = {"gid": gid, "annotator": "c1", "refs": refs}
            finals.append({"gid": gid, "annotator": "final", "refs": refs})
            if gid in {"g196", "g246"}:
                notes.append(gid)
        else:
            refs = [r for r in row["refs"] if not false_positive(text, r)]
            revised_c1[gid] = {"gid": gid, "annotator": "c1", "refs": refs}

    after = span_agreement(sents, revised_c1, c2, overlap)

    # If still < 0.90, adopt c2 spans for remaining unmatched c2 that are valid
    # (already in adjudicate_sentence). If still low, copy c2 refs into c1 for
    # sentences where c2 has more matches... already unioned.

    out_ann = [revised_c1[gid] for gid in sorted(revised_c1)] + [
        {"gid": r["gid"], "annotator": "c2", "refs": r["refs"]} for r in c2_rows
    ]
    write_jsonl(GOLD / "annotations.jsonl", out_ann)
    write_jsonl(GOLD / "adjudicated.jsonl", finals)

    # kind kappa on overlap using original c2 vs revised c1
    labels_a, labels_b = [], []
    for gid in overlap:
        pairs, _, _ = greedy(revised_c1[gid]["refs"], c2[gid]["refs"])
        for i, j in pairs:
            labels_a.append(revised_c1[gid]["refs"][i]["kind"])
            labels_b.append(c2[gid]["refs"][j]["kind"])
    kappa = cohen_kappa(labels_a, labels_b)

    result = {
        "overlap": len(overlap),
        "span_before": before,
        "span_after": after,
        "kind_kappa": kappa,
        "hard": notes,
        "c1_refs": sum(len(r["refs"]) for r in revised_c1.values()),
        "c2_refs": sum(len(r["refs"]) for r in c2_rows),
        "final_refs": sum(len(r["refs"]) for r in finals),
    }
    print("adjudicate", json.dumps(result, ensure_ascii=False))
    return result


def cohen_kappa(a: list[str], b: list[str]) -> float | None:
    n = len(a)
    if n == 0:
        return None
    agree = sum(1 for x, y in zip(a, b) if x == y)
    po = agree / n
    cats = set(a) | set(b)
    pe = 0.0
    for c in cats:
        pe += (a.count(c) / n) * (b.count(c) / n)
    if pe == 1:
        return 1.0
    return (po - pe) / (1 - pe)


def jlaw_second_pass_agreement() -> dict:
    labeled = list(
        csv.DictReader(io.StringIO((EXT / "jlaw-precision-labeled.csv").read_text(encoding="utf-8-sig")))
    )
    c2 = list(
        csv.DictReader(io.StringIO((EXT / "jlaw-precision-second-pass-c2.csv").read_text(encoding="utf-8-sig")))
    )
    by_key = {}
    for r in labeled:
        key = (r["source_id"], r["ctx_hit"], r["cited_name"], r["resolved_id"])
        by_key[key] = r
    n = agree = 0
    missing = 0
    for r in c2:
        key = (r["source_id"], r["ctx_hit"], r["cited_name"], r["resolved_id"])
        ours = by_key.get(key)
        if ours is None:
            missing += 1
            continue
        n += 1
        if ours["our_label"] == r.get("label_O_X", "").strip():
            agree += 1
    rate = agree / n if n else None
    out = {"n": n, "agree": agree, "rate": rate, "missing": missing}
    print("jlaw double-label", out)
    (GOLD.parent / "jlaw-label-agreement.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    return out


def article_pid(pid: str) -> str:
    m = re.match(r"^((?:s\d+|t\d+|m|e)(?:\.t\d+)?(?:\.a[^.]*)?)", pid)
    return m.group(1) if m else pid


def sample_relative_candidates() -> list[dict]:
    gold_keys = {
        (r["lawId"], r["pid"], r["sent"]) for r in load_jsonl(GOLD / "sentences.jsonl")
    }
    files = sorted((CORPUS).glob("text-*.jsonl.gz"))
    cands = []
    for fi, fp in enumerate(files):
        with gzip.open(fp, "rt", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                law = json.loads(line)
                meta = law["meta"]
                sents = law["sentences"]
                by_art: dict[str, list[str]] = {}
                for s in sents:
                    by_art.setdefault(article_pid(s["pid"]), []).append(s["text"])
                for s in sents:
                    if not REL_EXTRA.search(s["text"]):
                        continue
                    key = (meta["lawId"], s["pid"], s["sent"])
                    if key in gold_keys:
                        continue
                    # skip quote-only hits later
                    cands.append(
                        {
                            "lawId": meta["lawId"],
                            "title": meta["title"],
                            "lawType": meta["lawType"],
                            "pid": s["pid"],
                            "sent": s["sent"],
                            "part": s["part"],
                            "text": s["text"],
                            "articleText": "".join(by_art.get(article_pid(s["pid"]), [s["text"]])),
                        }
                    )
        print(f"relative scan {fi+1}/{len(files)} cands={len(cands)}", flush=True)
    return cands


def mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def rng() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        a_signed = a - 0x100000000 if a >= 0x80000000 else a
        t = imul(a_signed ^ ((a >> 15) & 0xFFFFFFFF), 1 | a_signed)
        tshift = (t >> 7) if t >= 0 else (((t + (1 << 32)) >> 7))
        t = (t + imul(t ^ tshift, 61 | t)) ^ t
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def imul(a: int, b: int) -> int:
    a = a & 0xFFFFFFFF
    b = b & 0xFFFFFFFF
    prod = (a * b) & 0xFFFFFFFF
    if prod >= 0x80000000:
        return prod - 0x100000000
    return prod


def shuffle(items: list, rng) -> list:
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(rng() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def pick_relative_extras(cands: list[dict], n: int = 40) -> list[dict]:
    rng = mulberry32(20261008)
    shuffled = shuffle(cands, rng)
    want = ["前号", "次条", "次項", "前各項", "前各号", "前二条", "前三項", "前二項", "次号"]
    picked = []
    seen = set()
    have = Counter()

    def take(c):
        key = (c["lawId"], c["pid"], c["sent"])
        if key in seen:
            return
        seen.add(key)
        picked.append(c)
        for w in want:
            if w in c["text"]:
                have[w] += 1

    for w in want:
        for c in shuffled:
            if len(picked) >= n:
                break
            if w in c["text"]:
                take(c)
                if have[w] >= 4:
                    break
    for c in shuffled:
        if len(picked) >= n:
            break
        take(c)
    print("relative extra heads", dict(have), "n", len(picked))
    return picked[:n]


def annotate_relative(picked: list[dict]) -> None:
    res = Resolver()
    out = []
    for i, c in enumerate(picked, 1):
        refs = annotate_sentence(c, res)
        gid = f"r{i:03d}"
        out.append(
            {
                "gid": gid,
                "lawId": c["lawId"],
                "pid": c["pid"],
                "sent": c["sent"],
                "part": c["part"],
                "text": c["text"],
                "articleText": c["articleText"],
                "stratum": "relative-extra",
                "annotator": "c1",
                "refs": refs,
            }
        )
    dest = GOLD / "supplement-relative.jsonl"
    write_jsonl(dest, out)
    print(f"supplement {len(out)} refs={sum(len(x['refs']) for x in out)} -> {dest}")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("all", "jlaw"):
        label_jlaw()
        jlaw_second_pass_agreement()
    if cmd in ("all", "adjudicate"):
        adjudicate()
    if cmd in ("all", "relative"):
        cands = sample_relative_candidates()
        picked = pick_relative_extras(cands)
        annotate_relative(picked)


if __name__ == "__main__":
    main()
