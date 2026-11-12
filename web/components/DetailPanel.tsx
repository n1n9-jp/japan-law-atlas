'use client';

import { useEffect, useRef, useState } from 'react';
import { KIND_HEX } from '@/lib/colors';
import { fetchArticleSentences } from '@/lib/article';
import { loadLawRefs } from '@/lib/load-data';
import { findMention } from '@/lib/mention';
import { pidToJa, srcPidToTargetJa } from '@/lib/pid';
import { LAW_STATUSES, LAW_TYPE_LABELS, LAW_TYPES, PARTS, REF_KIND_LABELS, REF_KINDS } from '@/lib/shared/contract';
import type { LawRefsFile, RefRows } from '@/lib/shared/contract';
import { useAtlas } from '@/lib/store';
import styles from './panel.module.css';

function KindBar({ mask, total }: { mask: number; total: number }) {
  const segs = REF_KINDS.map((k, i) => (mask & (1 << i) ? i : -1)).filter((i) => i >= 0);
  const w = segs.length ? 100 / segs.length : 100;
  void total;
  return (
    <div className={styles.bar} aria-hidden>
      {segs.map((i) => (
        <span key={i} className={styles.seg} style={{ width: `${w}%`, background: KIND_HEX[REF_KINDS[i]!] }} />
      ))}
    </div>
  );
}

function RefPlaces({
  rows,
  revisionId,
  lawId,
  total,
}: {
  rows: { srcPid: string; tgtPid: string | null; kind: number; part: number; mention: string; ctx: string | null }[];
  revisionId: string;
  lawId: string;
  total: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState<{ before: string; hit: string; after: string } | 'loading' | 'error' | null>(null);

  useEffect(() => {
    if (open == null) return;
    const row = rows[open];
    if (!row) return;
    const part = PARTS[row.part];
    if (part !== 'main') {
      setText(row.ctx ? { before: '', hit: row.ctx, after: '' } : null);
      return;
    }
    let cancelled = false;
    setText('loading');
    fetchArticleSentences(revisionId, row.srcPid)
      .then((sents) => {
        if (cancelled) return;
        const hit = findMention(sents, row.srcPid, row.mention);
        if (!hit) {
          setText({ before: sents.map((s) => s.text).join(''), hit: '', after: '' });
          return;
        }
        setText({
          before: hit.text.slice(0, hit.start),
          hit: hit.text.slice(hit.start, hit.end),
          after: hit.text.slice(hit.end),
        });
      })
      .catch(() => {
        if (!cancelled) setText('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows, revisionId]);

  return (
    <div className={styles.list}>
      {rows.map((r, i) => (
        <div key={`${r.srcPid}-${i}`}>
          <button className={`${styles.item} pressable`} onClick={() => setOpen(open === i ? null : i)}>
            <span>
              {srcPidToTargetJa(r.srcPid, r.tgtPid)}
              <div className={styles.ghost}>{REF_KIND_LABELS[REF_KINDS[r.kind]!]}</div>
            </span>
          </button>
          {open === i && text === 'loading' && <div className={styles.skel} />}
          {open === i && text === 'error' && (
            <p>
              e-Gov から本文を取れませんでした。
              {' '}
              <a href={`https://laws.e-gov.go.jp/law/${lawId}`} target="_blank" rel="noreferrer">e-Gov で開く</a>
            </p>
          )}
          {open === i && text && text !== 'loading' && text !== 'error' && (
            <div className={styles.article}>
              {PARTS[r.part] !== 'main' ? (
                <>
                  {r.ctx}
                  {' '}
                  <a href={`https://laws.e-gov.go.jp/law/${lawId}`} target="_blank" rel="noreferrer">e-Gov で全文</a>
                </>
              ) : (
                <>
                  {text.before}
                  {text.hit ? <mark className={styles.hit}>{text.hit}</mark> : null}
                  {text.after}
                </>
              )}
            </div>
          )}
        </div>
      ))}
      {total > rows.length && (
        <p className={styles.ghost}>ほか {total - rows.length} 件</p>
      )}
    </div>
  );
}

export function DetailPanel({
  onSelectLaw,
}: {
  onSelectLaw: (index: number) => void;
}) {
  const data = useAtlas((s) => s.data);
  const adj = useAtlas((s) => s.adj);
  const lawIndex = useAtlas((s) => s.selectedLawIndex);
  const edgeIndex = useAtlas((s) => s.selectedEdgeIndex);
  const reduced = useAtlas((s) => s.reducedMotion);
  const sheetExpanded = useAtlas((s) => s.sheetExpanded);
  const setUi = useAtlas((s) => s.setUi);
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [limit, setLimit] = useState(30);
  const [placeOther, setPlaceOther] = useState<number | null>(null);
  const [refs, setRefs] = useState<LawRefsFile | null>(null);
  const [swap, setSwap] = useState(false);
  const prev = useRef<number | null>(null);
  const drag = useRef<{ y: number; t: number } | null>(null);

  const open = lawIndex != null || edgeIndex != null;

  useEffect(() => {
    if (lawIndex == null || !data) {
      setRefs(null);
      prev.current = null;
      return;
    }
    const switched = prev.current != null && prev.current !== lawIndex;
    prev.current = lawIndex;
    let swapTimer: number | undefined;
    if (switched) {
      setSwap(true);
      swapTimer = window.setTimeout(() => setSwap(false), 160);
    }
    loadLawRefs(data.pointer.dataPath, data.laws.id[lawIndex]!).then(setRefs).catch(() => setRefs(null));
    setLimit(30);
    setPlaceOther(null);
    setTab('in');
    return () => {
      if (swapTimer) window.clearTimeout(swapTimer);
    };
  }, [lawIndex, data]);

  if (!data || !adj) return null;
  const laws = data.laws;
  const i = lawIndex;
  const cats = data.manifest.categories;

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, t: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    const dt = Math.max(1, Date.now() - drag.current.t);
    const v = Math.abs(dy) / dt;
    drag.current = null;
    if (dy < -8) setUi({ sheetExpanded: true });
    else if (v > 0.11 || dy > (window.innerHeight * 0.55) * 0.3) {
      useAtlas.getState().selectLaw(null);
      useAtlas.getState().selectEdge(null);
    }
  };

  let heading = '';
  if (i != null) heading = laws.title[i]!;
  else if (edgeIndex != null) {
    const s = data.edges.src[edgeIndex]!;
    const t = data.edges.tgt[edgeIndex]!;
    heading = `${laws.label[s]} → ${laws.label[t]}`;
  }

  return (
    <aside
      className={styles.panel}
      data-open={open}
      data-expanded={sheetExpanded}
      aria-hidden={!open}
    >
      <div
        className={styles.handle}
        data-sheet-handle
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <span className={styles.handleBar} aria-hidden />
      </div>
      <div className={styles.body} data-swap={swap && !reduced}>
        {i != null && (
          <>
            <h2 className={styles.title}>{laws.title[i]}</h2>
            <div className={styles.sub}>
              <span>{laws.num[i]}</span>
              <span>{LAW_TYPE_LABELS[LAW_TYPES[laws.type[i]!]!]}</span>
              <span className={styles.ghost} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 99,
                  background: `rgb(${cats[laws.category[i]!]?.color.join(',')})`,
                }}
                />
                {cats[laws.category[i]!]?.name}
              </span>
              <span>{String(laws.promulgated[i]).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</span>
              {LAW_STATUSES[laws.status[i]!] === 'repealed' && <span>廃止された法令</span>}
            </div>
            <p>
              <a href={`https://laws.e-gov.go.jp/law/${laws.id[i]}`} target="_blank" rel="noreferrer">e-Gov で開く</a>
            </p>
            <div className={styles.stats}>
              <div className={styles.stat}><b>{laws.articles[i]}</b><span>本則の条</span></div>
              <div className={styles.stat}><b>{laws.inLaws[i]}</b><span>参照する法令</span></div>
              <div className={styles.stat}><b>{laws.outLaws[i]}</b><span>参照している法令</span></div>
              <div className={styles.stat}><b>{laws.prRank[i]}</b><span>全体で {laws.prRank[i]} 位</span></div>
              <div className={styles.stat}><b>{laws.delegations[i]}</b><span>委任の言い回し</span></div>
              <div className={styles.stat}><b>{laws.bridge[i]}</b><span>参照してくる分野</span></div>
            </div>
            <div className={styles.family}>
              {laws.parent[i]! >= 0 && (
                <p>
                  親:
                  {' '}
                  <button type="button" onClick={() => onSelectLaw(laws.parent[i]!)}>{laws.title[laws.parent[i]!]}</button>
                </p>
              )}
              {(() => {
                const children: number[] = [];
                for (let j = 0; j < laws.n; j++) if (laws.parent[j] === i) children.push(j);
                if (!children.length) return null;
                return (
                  <p>
                    子:
                    {children.slice(0, 12).map((c) => (
                      <button key={c} type="button" onClick={() => onSelectLaw(c)} style={{ marginLeft: 8 }}>
                        {laws.label[c]}
                      </button>
                    ))}
                  </p>
                );
              })()}
            </div>
            <div className={styles.tabs} role="tablist" aria-label="参照の向き">
              <button role="tab" aria-selected={tab === 'in'} className={`${styles.tab} pressable`} onClick={() => { setTab('in'); setLimit(30); }}>
                この法令を参照している法令
              </button>
              <button role="tab" aria-selected={tab === 'out'} className={`${styles.tab} pressable`} onClick={() => { setTab('out'); setLimit(30); }}>
                この法令が参照している法令
              </button>
            </div>
            <div role="tabpanel">
              {(tab === 'in' ? adj.in[i]! : adj.out[i]!).slice(0, limit).map((n) => (
                <div key={n.other} className={styles.item}>
                  <button type="button" onClick={() => onSelectLaw(n.other)} style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                    {laws.label[n.other]}
                    <div className={styles.ghost}>{n.mainRefs + n.supplRefs} 言及</div>
                    <KindBar mask={n.kindMask} total={n.mainRefs + n.supplRefs} />
                  </button>
                  <button className={`${styles.loc} pressable`} onClick={() => setPlaceOther(n.other)}>箇所</button>
                </div>
              ))}
              {(tab === 'in' ? adj.in[i]! : adj.out[i]!).length > limit && (
                <button className={`${styles.more} pressable`} onClick={() => setLimit((n) => n + 30)}>さらに表示</button>
              )}
            </div>
            {placeOther != null && refs && (
              <div style={{ marginTop: 16 }}>
                <h3 className={styles.ghost}>参照箇所（{pidToJa('m')}{laws.label[placeOther]}）</h3>
                <RefPlaces
                  lawId={laws.id[i]!}
                  revisionId={laws.revisionId[i]!}
                  rows={sliceRows(tab === 'out' ? refs.out : refs.in, placeOther)}
                  total={partnerTotal(tab === 'in' ? adj.in[i]! : adj.out[i]!, placeOther)}
                />
              </div>
            )}
          </>
        )}
        {edgeIndex != null && i == null && (
          <EdgeDetail onSelectLaw={onSelectLaw} />
        )}
      </div>
      <span className="sr-live" aria-live="polite">{heading}</span>
    </aside>
  );
}

function partnerTotal(neighbors: { other: number; mainRefs: number; supplRefs: number }[], other: number): number {
  const hit = neighbors.find((n) => n.other === other);
  return hit ? hit.mainRefs + hit.supplRefs : 0;
}

function sliceRows(rows: RefRows, other: number) {
  const out: { srcPid: string; tgtPid: string | null; kind: number; part: number; mention: string; ctx: string | null }[] = [];
  for (let i = 0; i < rows.other.length; i++) {
    if (rows.other[i] === other) {
      out.push({
        srcPid: rows.srcPid[i]!,
        tgtPid: rows.tgtPid[i]!,
        kind: rows.kind[i]!,
        part: rows.part[i]!,
        mention: rows.mention[i]!,
        ctx: rows.ctx[i]!,
      });
    }
  }
  return out;
}

function EdgeDetail({ onSelectLaw }: { onSelectLaw: (index: number) => void }) {
  const data = useAtlas((s) => s.data)!;
  const edgeIndex = useAtlas((s) => s.selectedEdgeIndex)!;
  const s = data.edges.src[edgeIndex]!;
  const t = data.edges.tgt[edgeIndex]!;
  const [refs, setRefs] = useState<LawRefsFile | null>(null);
  useEffect(() => {
    loadLawRefs(data.pointer.dataPath, data.laws.id[s]!).then(setRefs).catch(() => setRefs(null));
  }, [data, s]);
  return (
    <>
      <h2 className={styles.title}>
        <button type="button" onClick={() => onSelectLaw(s)} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>
          {data.laws.title[s]}
        </button>
        {' → '}
        <button type="button" onClick={() => onSelectLaw(t)} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>
          {data.laws.title[t]}
        </button>
      </h2>
      <p className={styles.sub}>
        本則系 {data.edges.mainRefs[edgeIndex]} · 附則系 {data.edges.supplRefs[edgeIndex]} · {REF_KIND_LABELS[REF_KINDS[data.edges.domKind[edgeIndex]!]!]}
      </p>
      {refs && (
        <RefPlaces
          lawId={data.laws.id[s]!}
          revisionId={data.laws.revisionId[s]!}
          rows={sliceRows(refs.out, t)}
          total={data.edges.mainRefs[edgeIndex]! + data.edges.supplRefs[edgeIndex]!}
        />
      )}
    </>
  );
}
