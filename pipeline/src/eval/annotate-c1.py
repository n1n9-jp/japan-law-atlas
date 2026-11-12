#!/usr/bin/env python3
"""First-pass gold annotation from guideline.md. Not the extractor."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

STORE = Path(
    os.environ.get("HOUREI_STORE")
    or os.environ.get("STORE")
    or "/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3"
)
SNAP = "20261009"
GOLD = STORE / "data/eval" / SNAP / "gold"
CORPUS = STORE / "data/corpus" / SNAP

DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "元": 1}


def kansuji_to_int(s: str) -> int:
    if re.fullmatch(r"[0-9]+", s):
        return int(s)
    result = 0
    current = 0
    for ch in s:
        if ch == "千":
            result += (current or 1) * 1000
            current = 0
        elif ch == "百":
            result += (current or 1) * 100
            current = 0
        elif ch == "十":
            result += (current or 1) * 10
            current = 0
        elif ch in DIGIT:
            current = DIGIT[ch]
    return result + current


def art_num(kan: str, of: str | None) -> str:
    n = str(kansuji_to_int(kan.replace("-", "").replace("_", "")))
    if of:
        n += "_" + str(kansuji_to_int(of))
    return n


KAN_NUM = r"[元〇零一二三四五六七八九十百千0-9]+"
ART = re.compile(
    rf"第({KAN_NUM})条(?:の({KAN_NUM}))?(?:第({KAN_NUM})項)?(?:第({KAN_NUM})号)?"
)
RANGE = re.compile(
    rf"(第{KAN_NUM}条(?:の{KAN_NUM})?(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?|第{KAN_NUM}項(?:第{KAN_NUM}号)?|第{KAN_NUM}号)(?:から|乃至)(第{KAN_NUM}条(?:の{KAN_NUM})?(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?|第{KAN_NUM}項(?:第{KAN_NUM}号)?|第{KAN_NUM}号|前条)まで?"
)
REL = re.compile(
    rf"(?:前各項|前各号|次各項|次各号|前[二三四五六七八九十]+(?:条|項|号)|次[二三四五六七八九十]+(?:条|項|号)|前条|次条|前項|次項|前号|次号|同条|同項|同号|本条|この条|この項|この号)(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?"
)
FRAG_ONLY = re.compile(r"^(各号|ただし書|但し書|本文|前段|後段)$")
SELF_BARE = re.compile(r"^(この(?:法律|政令|省令|府令|規則|命令)|本法)$")
LAW_NUM = re.compile(
    r"(?:明治|大正|昭和|平成|令和)[元〇零一二三四五六七八九十百千0-9]+年(?:法律|政令|勅令|省令|府令|規則|内閣府令|太政官布告)第[元〇零一二三四五六七八九十百千0-9]+号"
)


def mask_region(out: list[str], a: int, b: int) -> None:
    for k in range(a, min(b, len(out))):
        out[k] = "　"


def mask_quotes(text: str) -> str:
    out = list(text)
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in "「『":
            if depth == 0:
                start = i
            depth += 1
        elif ch in "」』" and depth > 0:
            depth -= 1
            if depth == 0:
                mask_region(out, start, i + 1)
    for m in re.finditer(r"（以下[^）]*という。）", text):
        mask_region(out, m.start(), m.end())
    return "".join(out)


def pid_from_art(match: re.Match[str], prefix: str = "m") -> str:
    a = art_num(match.group(1), match.group(2))
    pid = f"{prefix}.a{a}"
    if match.group(3):
        pid += f".p{kansuji_to_int(match.group(3))}"
    if match.group(4):
        pid += f".i{kansuji_to_int(match.group(4))}"
    return pid


def src_article(pid: str) -> str:
    m = re.match(r"^((?:s\d+|t\d+|m|e)(?:\.t\d+)?(?:\.a[^.]*)?)", pid)
    return m.group(1) if m else pid.split(".")[0]


def prev_article(pid: str) -> str | None:
    m = re.match(r"^(.*\.a)(\d+)(?:_(\d+))?$", src_article(pid))
    if not m:
        return None
    n = int(m.group(2))
    branch = m.group(3)
    if branch:
        b = int(branch)
        if b > 2:
            return f"{m.group(1)}{n}_{b-1}"
        return f"{m.group(1)}{n}"
    if n <= 1:
        return None
    return f"{m.group(1)}{n-1}"


def prev_para(pid: str) -> str | None:
    m = re.match(r"^(.*\.p)(\d+)", pid)
    if not m:
        return None
    n = int(m.group(2))
    if n <= 1:
        return None
    return re.sub(r"\.p\d+.*$", f".p{n-1}", pid)


def item_num(pid: str) -> int | None:
    m = re.search(r"\.i(\d+)", pid)
    return int(m.group(1)) if m else None


def para_num(pid: str) -> int | None:
    m = re.search(r"\.p(\d+)", pid)
    return int(m.group(1)) if m else None


def art_core(pid: str) -> str:
    return src_article(pid)


def article_minus_one(art: str) -> str | None:
    m = re.match(r"^(.*\.a)(\d+)(?:_(\d+))?$", art)
    if not m:
        return None
    num = int(m.group(2))
    branch = m.group(3)
    if branch:
        b = int(branch)
        return f"{m.group(1)}{num}_{b-1}" if b > 2 else f"{m.group(1)}{num}"
    if num <= 1:
        return None
    return f"{m.group(1)}{num-1}"


def prev_n_articles(pid: str, n: int) -> tuple[str | None, str | None]:
    end = prev_article(pid)
    if end is None or n < 1:
        return None, None
    start = end
    for _ in range(n - 1):
        nxt = article_minus_one(start)
        if nxt is None:
            return None, end
        start = nxt
    return start, end


def prev_n_paras(pid: str, n: int) -> tuple[str | None, str | None]:
    p = para_num(pid)
    if p is None or p <= 1 or n < 1:
        return None, None
    end_n = p - 1
    start_n = max(1, p - n)
    prefix = re.sub(r"\.p\d+.*$", "", pid)
    return f"{prefix}.p{start_n}", f"{prefix}.p{end_n}"


def prev_all_paras(pid: str) -> tuple[str | None, str | None]:
    p = para_num(pid)
    if p is None or p <= 1:
        return None, None
    prefix = re.sub(r"\.p\d+.*$", "", pid)
    return f"{prefix}.p1", f"{prefix}.p{p-1}"


def prev_all_items(pid: str) -> tuple[str | None, str | None]:
    i = item_num(pid)
    if i is None or i <= 1:
        return None, None
    prefix = re.sub(r"\.i\d+.*$", "", pid)
    return f"{prefix}.i1", f"{prefix}.i{i-1}"


def next_article(pid: str) -> str | None:
    m = re.match(r"^(.*\.a)(\d+)(?:_(\d+))?$", src_article(pid))
    if not m:
        return None
    n = int(m.group(2))
    branch = m.group(3)
    if branch:
        return f"{m.group(1)}{n}_{int(branch)+1}"
    return f"{m.group(1)}{n+1}"


def next_para(pid: str) -> str | None:
    p = para_num(pid)
    if p is None:
        return None
    prefix = re.sub(r"\.p\d+.*$", "", pid)
    return f"{prefix}.p{p+1}"


def range_pid_from_fragment(frag: str, start_pid: str | None) -> str | None:
    art = ART.search(frag)
    if art:
        prefix = "m"
        if start_pid:
            prefix = src_article(start_pid).split(".a")[0] if ".a" in src_article(start_pid) else "m"
        return pid_from_art(art, prefix)
    if start_pid is None:
        return None
    pm = re.match(rf"第({KAN_NUM})項(?:第({KAN_NUM})号)?$", frag)
    if pm:
        base = re.sub(r"\.p.*$", "", start_pid)
        pid = f"{base}.p{kansuji_to_int(pm.group(1))}"
        if pm.group(2):
            pid += f".i{kansuji_to_int(pm.group(2))}"
        return pid
    gm = re.match(rf"第({KAN_NUM})号$", frag)
    if gm:
        base = re.sub(r"\.i.*$", "", start_pid) if ".i" in start_pid else start_pid
        return f"{base}.i{kansuji_to_int(gm.group(1))}"
    return None


def kind_of(sentence: str, start: int, end: int) -> tuple[str, bool]:
    window = sentence[max(0, start - 12) : end + 48]
    yomikae = "読み替" in sentence[max(0, start - 20) : end + 80]
    if re.search(r"基づき.{0,40}制定する", sentence) and start < 80:
        if "制定する" in sentence:
            return "basis", yomikae
    if re.search(r"一部を次のように改正|を廃止する", window) or re.search(
        r"を改正する", sentence[end : end + 24]
    ):
        return "amend", yomikae
    if "準用する" in window:
        return "junyo", True if yomikae else False
    if "の例による" in window:
        return "rei", yomikae
    if "適用しない" in sentence[end : end + 40]:
        return "exclude", yomikae
    if "政令で定める" in window or "省令で定める" in window or "規則で定める" in window:
        if "法第" in sentence[max(0, start - 2) : end + 20] or sentence[start:end].startswith("法"):
            return "implements", yomikae
    if "に規定する" in sentence[end : end + 24] or "に定める" in sentence[end : end + 24]:
        return "cite", yomikae
    return "cite", yomikae


def looks_like_law_name(name: str) -> bool:
    if len(name) < 2:
        return False
    if re.search(r"(?:法律|政令|勅令|府令|省令|規則|条約|憲法|法|令|則)$", name):
        return True
    if name in {"労災則", "独禁法"}:
        return True
    return False


class Resolver:
    def __init__(self) -> None:
        laws = json.loads((CORPUS / "laws.json").read_text())
        repealed = json.loads((CORPUS / "repealed.json").read_text())
        self.by_id: dict[str, dict] = {}
        self.by_title: dict[str, str] = {}
        self.by_num: dict[str, str] = {}
        self.names: list[tuple[str, str]] = []
        for row in laws + repealed:
            self.by_id[row["lawId"]] = row
            self.by_title[row["title"]] = row["lawId"]
            if row.get("num"):
                self.by_num[row["num"]] = row["lawId"]
            if row.get("numNorm"):
                self.by_num[row["numNorm"]] = row["lawId"]
            self.names.append((row["title"], row["lawId"]))
            inner = re.search(r"（([^）]+)）$", row["title"])
            if inner and len(inner.group(1)) >= 2:
                self.names.append((inner.group(1), row["lawId"]))
            for a in row.get("abbrevs") or []:
                for part in re.split(r"[,、]", a):
                    if len(part) >= 2:
                        self.names.append((part, row["lawId"]))
            for a in row.get("oldTitles") or []:
                for part in re.split(r"[,、]", a):
                    if len(part) >= 2:
                        self.names.append((part, row["lawId"]))
        extra = {
            "私的独占禁止法": "私的独占の禁止及び公正取引の確保に関する法律",
            "労災則": "労働者災害補償保険法施行規則",
            "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
        }
        for alias, canon in extra.items():
            lid = self.by_title.get(canon)
            if not lid:
                lid = next((i for n, i in self.names if n == canon), None)
            if lid:
                self.names.append((alias, lid))
        try:
            aliases = json.loads(Path("/tmp/hourei-cache/eval-external/jlaw/jp_abbrev_kit.json").read_text())
            aliases.update(
                {k: v for k, v in json.loads(Path("/tmp/hourei-cache/eval-external/jlaw/jp_law_aliases.json").read_text()).items() if not k.startswith("_")}
            )
            for alias, canon in aliases.items():
                if not isinstance(alias, str) or not isinstance(canon, str) or len(alias) < 2:
                    continue
                lid = self.by_title.get(canon)
                if lid:
                    self.names.append((alias, lid))
        except OSError:
            pass
        uniq: dict[str, str] = {}
        for n, i in self.names:
            if n not in uniq and looks_like_law_name(n):
                uniq[n] = i
        self.names = sorted(uniq.items(), key=lambda x: len(x[0]), reverse=True)

    def parent_of(self, title: str) -> str | None:
        for suf in ("施行令", "施行規則", "施行法"):
            if title.endswith(suf):
                base = title[: -len(suf)]
                if base in self.by_title:
                    return self.by_title[base]
                if not base.endswith("法") and (base + "法") in self.by_title:
                    return self.by_title[base + "法"]
        return None

    def status(self, law_id: str | None, src: str) -> str:
        if law_id is None:
            return "unknown"
        if law_id == src:
            return "self"
        row = self.by_id.get(law_id)
        if not row:
            return "unknown"
        if row.get("status") == "repealed":
            return "repealed"
        return "current"


def extend_with_range(text: str, end: int, start_pid: str | None, src_pid: str) -> tuple[int, str | None]:
    rest = text[end:]
    m = re.match(
        rf"(?:から|乃至)(第{KAN_NUM}条(?:の{KAN_NUM})?(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?|第{KAN_NUM}項(?:第{KAN_NUM}号)?|第{KAN_NUM}号|前条)まで?",
        rest,
    )
    if not m:
        return end, None
    if m.group(1) == "前条":
        return end + m.end(), prev_article(src_pid)
    return end + m.end(), range_pid_from_fragment(m.group(1), start_pid)


def local_abbrevs(text: str, res: Resolver) -> list[tuple[str, str]]:
    extra: list[tuple[str, str]] = []
    for m in re.finditer(r"以下「([^」]+)」という", text):
        abbr = m.group(1)
        if len(abbr) < 2:
            continue
        window = text[max(0, m.start() - 120) : m.start()]
        for n, lid in res.names:
            if n and n in window:
                extra.append((abbr, lid))
                break
    extra.sort(key=lambda x: len(x[0]), reverse=True)
    return extra


def covered(spans: list[tuple[int, int]], a: int, b: int) -> bool:
    for s, e in spans:
        if not (b <= s or a >= e):
            return True
    return False


def annotate_sentence(row: dict, res: Resolver) -> list[dict]:
    text: str = row["text"]
    if not text.strip():
        return []
    src = row["lawId"]
    title = row["title"]
    masked = mask_quotes(text)
    used: list[tuple[int, int]] = []
    refs: list[dict] = []

    def add(start: int, end: int, tgt: str | None, status: str, pid: str | None, end_pid: str | None) -> None:
        if start < 0 or end > len(text) or start >= end:
            return
        if covered(used, start, end):
            return
        mention = text[start:end]
        if not mention.strip():
            return
        if FRAG_ONLY.fullmatch(mention) or SELF_BARE.fullmatch(mention):
            return
        kind, yomikae = kind_of(text, start, end)
        used.append((start, end))
        refs.append(
            {
                "start": start,
                "end": end,
                "mention": mention,
                "tgtLaw": tgt,
                "tgtStatus": status,
                "tgtPid": pid,
                "tgtEnd": end_pid,
                "kind": kind,
                "yomikae": yomikae,
            }
        )

    last_other: str | None = None
    last_other_end = -1
    last_art: str | None = None
    names = local_abbrevs(row.get("articleText", "") + "。" + text, res) + res.names

    for m in LAW_NUM.finditer(masked):
        lid = res.by_num.get(m.group(0))
        art = ART.match(masked[m.end() :])
        end = m.end()
        pid = None
        end_pid = None
        if art and art.start() == 0:
            end = m.end() + art.end()
            pid = pid_from_art(art)
            end, end_pid = extend_with_range(text, end, pid, row["pid"])
        st = res.status(lid, src)
        if lid is None:
            st = "amendingLaw"
        add(m.start(), end, lid, st, pid, end_pid)
        if lid and lid != src:
            last_other = lid
            last_other_end = end
            last_art = pid_from_art(art).rsplit(".p", 1)[0] if art else last_art

    i = 0
    while i < len(masked):
        hit: tuple[str, str] | None = None
        for n, lid0 in names:
            if masked.startswith(n, i):
                hit = (n, lid0)
                break
        if hit is None:
            i += 1
            continue
        name, lid = hit
        m_start, m_end = i, i + len(name)
        rest = masked[m_end:]
        art = None
        end = m_end
        pid = None
        if rest.startswith("（以下") or rest.startswith("(以下"):
            i = m_end
            add(m_start, m_end, lid, res.status(lid, src), None, None)
            if lid != src:
                last_other = lid
                last_other_end = m_end
            continue
        if rest.startswith("等の一部を改正する法律"):
            end = m_end + len("等の一部を改正する法律")
            raw_after = text[end:]
            pid = None
            tgt_st = "amendingLaw"
            art_m = re.match(rf"(?:（[^）]*）)?附則(第{KAN_NUM}条(?:の{KAN_NUM})?(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?)", raw_after)
            if art_m:
                end = end + art_m.end()
                am = ART.search(art_m.group(1) if art_m.lastindex else art_m.group(0))
                if am:
                    pid = pid_from_art(am, "s1")
            add(m_start, end, None, tgt_st, pid, None)
            i = end
            continue
        if rest.startswith("（") or rest.startswith("("):
            close = rest.find("）") if rest.startswith("（") else rest.find(")")
            if close > 0:
                inner = rest[1:close]
                if LAW_NUM.fullmatch(inner) or LAW_NUM.search(inner):
                    end = m_end + close + 1
                    nm = LAW_NUM.search(inner)
                    if nm:
                        lid = res.by_num.get(nm.group(0), lid)
                after = rest[close + 1 :]
                art = ART.match(after)
                if art:
                    end = m_end + close + 1 + art.end()
                    pid = pid_from_art(art)
        if pid is None:
            art = ART.match(rest)
            if art:
                end = m_end + art.end()
                pid = pid_from_art(art)
        raw_after = text[end:]
        art_m = re.match(rf"附則(第{KAN_NUM}条(?:の{KAN_NUM})?(?:第{KAN_NUM}項)?(?:第{KAN_NUM}号)?)", raw_after)
        if art_m:
            end = end + art_m.end()
            am = ART.match(art_m.group(1))
            if am:
                pid = pid_from_art(am, "s1")
        end_pid = None
        end, end_pid = extend_with_range(text, end, pid, row["pid"])
        add(m_start, end, lid, res.status(lid, src), pid, end_pid)
        if lid != src:
            last_other = lid
            last_other_end = end
            if pid:
                last_art = re.sub(r"\.p.*$", "", pid)
        i = max(end, m_end)

    for m in re.finditer(r"同(?:法|令)", masked):
        art = ART.match(masked[m.end() :])
        end = m.end()
        pid = None
        end_pid = None
        if art:
            end = m.end() + art.end()
            pid = pid_from_art(art)
            end, end_pid = extend_with_range(text, end, pid, row["pid"])
        tgt = last_other
        add(m.start(), end, tgt, res.status(tgt, src) if tgt else "unknown", pid, end_pid)

    parent = res.parent_of(title)
    rei_title = title[: -len("施行規則")] + "施行令" if title.endswith("施行規則") else None
    rei_id = res.by_title.get(rei_title) if rei_title else None
    for m in re.finditer(r"令(?=第)", masked):
        if covered(used, m.start(), m.start() + 1):
            continue
        art = ART.match(masked[m.end() :])
        if not art:
            continue
        tgt = rei_id or parent
        pid = pid_from_art(art)
        end = m.end() + art.end()
        end, end_pid = extend_with_range(text, end, pid, row["pid"])
        add(m.start(), end, tgt, res.status(tgt, src) if tgt else "unknown", pid, end_pid)
    for m in re.finditer(r"法(?=第)", masked):
        if covered(used, m.start(), m.start() + 1):
            continue
        art = ART.match(masked[m.end() :])
        if not art:
            continue
        pid = pid_from_art(art)
        end = m.end() + art.end()
        tgt = parent
        end, end_pid = extend_with_range(text, end, pid, row["pid"])
        add(m.start(), end, tgt, res.status(tgt, src) if tgt else "unknown", pid, end_pid)

    for m in RANGE.finditer(masked):
        if covered(used, m.start(), m.end()):
            continue
        start_pid = range_pid_from_fragment(m.group(1), src_article(row["pid"]))
        if m.group(2) == "前条":
            end_pid = prev_article(row["pid"])
        else:
            end_pid = range_pid_from_fragment(m.group(2), start_pid)
        add(m.start(), m.end(), src, "self", start_pid, end_pid)

    for m in re.finditer(r"この(?:法律|政令|省令|府令|規則|命令)|本法", masked):
        art = ART.match(masked[m.end() :])
        if not art:
            continue
        pid = pid_from_art(art)
        end = m.end() + art.end()
        end, end_pid = extend_with_range(text, end, pid, row["pid"])
        add(m.start(), end, src, "self", pid, end_pid)

    for m in REL.finditer(masked):
        head = re.match(
            r"前各項|前各号|次各項|次各号|前[二三四五六七八九十]+(?:条|項|号)|次[二三四五六七八九十]+(?:条|項|号)|前条|次条|前項|次項|前号|次号|同条|同項|同号|本条|この条|この項|この号",
            m.group(0),
        )
        mention_key = head.group(0) if head else m.group(0)
        pid = None
        end_pid = None
        if mention_key == "前条":
            pid = prev_article(row["pid"])
        elif mention_key == "次条":
            pid = next_article(row["pid"])
        elif mention_key == "前項":
            pid = prev_para(row["pid"])
        elif mention_key == "次項":
            pid = next_para(row["pid"])
        elif mention_key in ("同条", "本条", "この条"):
            pid = src_article(row["pid"])
        elif mention_key in ("同項", "この項"):
            pid = re.sub(r"\.i.*$", "", row["pid"])
        elif mention_key == "前各項":
            pid, end_pid = prev_all_paras(row["pid"])
        elif mention_key == "前各号":
            pid, end_pid = prev_all_items(row["pid"])
        else:
            nm = re.match(r"(前|次)([二三四五六七八九十]+)(条|項|号)", mention_key)
            if nm:
                n = kansuji_to_int(nm.group(2))
                if nm.group(3) == "条":
                    pid, end_pid = prev_n_articles(row["pid"], n)
                elif nm.group(3) == "項":
                    pid, end_pid = prev_n_paras(row["pid"], n)
        art = ART.search(m.group(0))
        if art and mention_key in ("前条", "次条", "同条", "本条", "この条"):
            pid = pid_from_art(art, prefix=src_article(row["pid"]).split(".a")[0] if ".a" in src_article(row["pid"]) else "m")
        add(m.start(), m.end(), src, "self", pid, end_pid)

    for m in ART.finditer(masked):
        start = m.start()
        prefix = "m"
        if start >= 2 and text[start - 2 : start] == "附則":
            start = start - 2
            prefix = "s1"
        if covered(used, start, m.end()):
            continue
        tgt = last_other if m.start() >= last_other_end and last_other else src
        pid = pid_from_art(m, prefix)
        end, end_pid = extend_with_range(text, m.end(), pid, row["pid"])
        add(start, end, tgt, res.status(tgt, src), pid, end_pid)

    para_re = re.compile(rf"第({KAN_NUM})項")
    go_re = re.compile(rf"第({KAN_NUM})号")
    art_prefix = src_article(row["pid"])
    for m in para_re.finditer(masked):
        if covered(used, m.start(), m.end()):
            continue
        use_other = m.start() >= last_other_end and last_other and last_art
        tgt = last_other if use_other else src
        base = last_art if use_other else art_prefix
        pid = f"{base}.p{kansuji_to_int(m.group(1))}"
        add(m.start(), m.end(), tgt, res.status(tgt, src), pid, None)
    for m in go_re.finditer(masked):
        if covered(used, m.start(), m.end()):
            continue
        use_other = m.start() >= last_other_end and last_other and last_art
        tgt = last_other if use_other else src
        base = last_art if use_other else art_prefix
        pid = f"{base}.i{kansuji_to_int(m.group(1))}"
        add(m.start(), m.end(), tgt, res.status(tgt, src), pid, None)

    refs.sort(key=lambda r: r["start"])
    return refs


def main() -> None:
    res = Resolver()
    sentences = [json.loads(l) for l in (GOLD / "sentences.jsonl").read_text().splitlines() if l.strip()]
    meta = {x["lawId"]: x for x in json.loads((CORPUS / "laws.json").read_text())}
    out = []
    nrefs = 0
    empty = 0
    for s in sentences:
        m = meta.get(s["lawId"], {})
        row = {**s, "title": m.get("title", ""), "num": m.get("num", "")}
        refs = annotate_sentence(row, res)
        nrefs += len(refs)
        if not refs:
            empty += 1
        out.append({"gid": s["gid"], "annotator": "c1", "refs": refs})
    (GOLD / "annotations.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out))
    print(f"wrote {len(out)} rows, refs={nrefs}, empty={empty}")


if __name__ == "__main__":
    main()
