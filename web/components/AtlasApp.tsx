'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAdjacency } from '@/lib/adjacency';
import { ensureAtlasGlobal } from '@/lib/atlas-global';
import { screenDeltaToWorld } from '@/lib/camera';
import { countVisibleEdges } from '@/lib/filters';
import { buildGeometry, packGeometryInput, packedTransferList } from '@/lib/geometry';
import { loadAtlasData } from '@/lib/load-data';
import { buildSearchIndex } from '@/lib/search';
import { parseUrlState, serializeUrlState, urlHasUserState } from '@/lib/url-state';
import { useAtlas } from '@/lib/store';
import { DetailPanel } from './DetailPanel';
import { FilterPopover } from './FilterPopover';
import { Legend } from './Legend';
import { SearchBar } from './SearchBar';
import styles from './chrome.module.css';

const AtlasMap = dynamic(() => import('./AtlasMap'), { ssr: false });

export function AtlasApp() {
  const data = useAtlas((s) => s.data);
  const geometry = useAtlas((s) => s.geometry);
  const error = useAtlas((s) => s.error);
  const setData = useAtlas((s) => s.setData);
  const setGeometry = useAtlas((s) => s.setGeometry);
  const setError = useAtlas((s) => s.setError);
  const applyUrl = useAtlas((s) => s.applyUrl);
  const selectLaw = useAtlas((s) => s.selectLaw);
  const selectEdge = useAtlas((s) => s.selectEdge);
  const setFilter = useAtlas((s) => s.setFilter);
  const setUi = useAtlas((s) => s.setUi);
  const setView = useAtlas((s) => s.setView);
  const color = useAtlas((s) => s.color);
  const kinds = useAtlas((s) => s.kinds);
  const parts = useAtlas((s) => s.parts);
  const types = useAtlas((s) => s.types);
  const minRefs = useAtlas((s) => s.minRefs);
  const hideIntraFamily = useAtlas((s) => s.hideIntraFamily);
  const law = useAtlas((s) => s.law);
  const edge = useAtlas((s) => s.edge);
  const focus = useAtlas((s) => s.focus);
  const view = useAtlas((s) => s.view);
  const fitZoom = useAtlas((s) => s.fitZoom);
  const selectedLawIndex = useAtlas((s) => s.selectedLawIndex);
  const selectedEdgeIndex = useAtlas((s) => s.selectedEdgeIndex);
  const searchOpen = useAtlas((s) => s.searchOpen);
  const [flyTo, setFlyTo] = useState<{ x: number; y: number; zoom: number; key: number } | null>(null);
  const [instantView, setInstantView] = useState<{ x: number; y: number; zoom: number; key: number } | null>(null);
  const skipPush = useRef(false);
  const camTimer = useRef<number | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setUi({ reducedMotion: mq.matches });
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [setUi]);

  useEffect(() => {
    let cancelled = false;
    loadAtlasData()
      .then((d) => {
        if (cancelled) return;
        const adj = buildAdjacency(d.laws.n, d.edges);
        buildSearchIndex(d.laws);
        setData(d, adj);
        const url = parseUrlState(window.location.search);
        const seen = localStorage.getItem('hourei-atlas-seen');
        const has = urlHasUserState(window.location.search);
        if (!seen && !has) setUi({ opening: true });
        localStorage.setItem('hourei-atlas-seen', '1');
        const colors = d.manifest.categories.map((c) => c.color);
        const packed = packGeometryInput(d.laws, d.edges, colors);
        try {
          const worker = new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = (ev: MessageEvent) => {
            if (!cancelled) setGeometry(ev.data);
            worker.terminate();
          };
          worker.onerror = () => {
            if (!cancelled) setGeometry(buildGeometry(d.laws, d.edges, colors));
            worker.terminate();
          };
          worker.postMessage(packed, packedTransferList(packed));
        } catch {
          setGeometry(buildGeometry(d.laws, d.edges, colors));
        }
        if (url.view) {
          setInstantView({ ...url.view, key: 1 });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '読み込みに失敗しました';
        setError(msg.includes('版') ? 'データの版が合いません' : msg);
      });
    return () => {
      cancelled = true;
    };
  }, [applyUrl, setData, setError, setGeometry, setUi]);

  useEffect(() => {
    if (!data) return;
    applyUrl(parseUrlState(window.location.search));
    loaded.current = true;
  }, [data, applyUrl]);

  useEffect(() => {
    if (!useAtlas.getState().opening) return;
    const t = window.setTimeout(() => setUi({ opening: false }), 1300);
    const stop = () => setUi({ opening: false });
    window.addEventListener('pointerdown', stop, { once: true });
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('wheel', stop, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('wheel', stop);
    };
  }, [data, setUi]);

  const visibleCount = useMemo(() => {
    if (!data) return 0;
    return countVisibleEdges(data.edges, data.laws, { kinds, parts, types, minRefs, hideIntraFamily });
  }, [data, kinds, parts, types, minRefs, hideIntraFamily]);

  useEffect(() => {
    ensureAtlasGlobal().visibleEdgeCount = visibleCount;
  }, [visibleCount]);

  useEffect(() => {
    if (!loaded.current) return;
    if (skipPush.current) {
      skipPush.current = false;
      return;
    }
    const st = useAtlas.getState();
    const q = serializeUrlState({
      law: st.law,
      edge: st.edge,
      kinds: st.kinds,
      parts: st.parts,
      types: st.types,
      minRefs: st.minRefs,
      color: st.color,
      focus: st.focus,
      view: st.view,
    });
    const url = q ? `?${q}` : window.location.pathname;
    window.history.pushState(null, '', url);
  }, [law, edge, kinds, parts, types, minRefs, color, focus]);

  useEffect(() => {
    if (!view || !loaded.current) return;
    if (camTimer.current) window.clearTimeout(camTimer.current);
    camTimer.current = window.setTimeout(() => {
      const st = useAtlas.getState();
      const q = serializeUrlState({
        law: st.law,
        edge: st.edge,
        kinds: st.kinds,
        parts: st.parts,
        types: st.types,
        minRefs: st.minRefs,
        color: st.color,
        focus: st.focus,
        view: st.view,
      });
      window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
    }, 400);
  }, [view]);

  useEffect(() => {
    const onPop = () => {
      skipPush.current = true;
      applyUrl(parseUrlState(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyUrl]);

  const goToLaw = useCallback((index: number | null) => {
    selectLaw(index);
    ensureAtlasGlobal().selectedLawId = index != null && data ? data.laws.id[index]! : null;
    if (index == null || !data) return;
    const cur = useAtlas.getState();
    const z = cur.view?.zoom ?? cur.fitZoom;
    const nextZ = z < cur.fitZoom + 2 ? cur.fitZoom + 2.5 : z;
    setFlyTo({ x: data.laws.x[index]!, y: data.laws.y[index]!, zoom: nextZ, key: Date.now() });
    setUi({ opening: false, searchOpen: false });
  }, [data, selectLaw, setUi]);

  const onFocus = useCallback((kind: 'group' | 'category', id: number) => {
    if (id < 0) {
      setFilter({ focus: null });
      return;
    }
    setFilter({ focus: { kind, id } });
    if (!data) return;
    const item = kind === 'category'
      ? data.continents.categories.find((c) => c.id === id)
      : data.continents.groups.find((g) => g.id === id);
    if (!item) return;
    const [x, y] = item.labelPos;
    setFlyTo({ x, y, zoom: fitZoom + 1.2, key: Date.now() });
  }, [data, fitZoom, setFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        const st = useAtlas.getState();
        if (st.searchOpen) {
          st.setUi({ searchOpen: false });
          return;
        }
        if (st.selectedEdgeIndex != null) {
          selectEdge(null);
          return;
        }
        if (st.selectedLawIndex != null) goToLaw(null);
        return;
      }
      if (typing) return;
      const st = useAtlas.getState();
      const v = st.view ?? { x: 0, y: 0, zoom: st.fitZoom };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -80 : e.key === 'ArrowRight' ? 80 : 0;
        const dy = e.key === 'ArrowUp' ? -80 : e.key === 'ArrowDown' ? 80 : 0;
        const [wx, wy] = screenDeltaToWorld(dx, dy, v.zoom);
        const next = { x: v.x + wx, y: v.y + wy, zoom: v.zoom };
        st.setView(next);
        setInstantView({ ...next, key: Date.now() });
        ensureAtlasGlobal().lastTransitionMs = 0;
      }
      if (e.key === '+' || e.key === '=') {
        const next = { ...v, zoom: v.zoom + 0.5 };
        st.setView(next);
        setInstantView({ ...next, key: Date.now() });
        ensureAtlasGlobal().lastTransitionMs = 0;
      }
      if (e.key === '-' || e.key === '_') {
        const next = { ...v, zoom: v.zoom - 0.5 };
        st.setView(next);
        setInstantView({ ...next, key: Date.now() });
        ensureAtlasGlobal().lastTransitionMs = 0;
      }
      if (e.key === '0') {
        const next = { x: 0, y: 0, zoom: st.fitZoom };
        st.setView(next);
        setInstantView({ ...next, key: Date.now() });
        ensureAtlasGlobal().lastTransitionMs = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToLaw, selectEdge]);

  if (error) {
    return (
      <div className={styles.shell}>
        <div className={styles.error} role="alert">{error}</div>
      </div>
    );
  }

  const n = data?.manifest.counts.laws ?? 0;

  return (
    <div className={styles.shell}>
      <AtlasMap onSelectLaw={goToLaw} flyTo={flyTo} instantView={instantView} />
      <div className={styles.brand}>
        <p className={styles.logo}>法令アトラス</p>
        <p className={styles.sub}>
          日本の施行中の法令 {n.toLocaleString('ja-JP')} 件の参照地図
        </p>
        {data?.manifest.isMock && <p className={styles.mock}>仮データ</p>}
      </div>
      <SearchBar onPick={goToLaw} />
      <div className={styles.topRight}>
        <FilterPopover visibleCount={visibleCount} />
        <button
          className={`${styles.iconBtn} pressable`}
          aria-label="色分け"
          onClick={() => setFilter({ color: color === 'category' ? 'kind' : 'category' })}
        >
          {color === 'category' ? '分野' : '参照の種類'}
        </button>
        <Link className={`${styles.infoBtn} pressable`} href="/about" aria-label="概要">i</Link>
      </div>
      <Legend onFocus={onFocus} />
      <div className={styles.zoom}>
        <button className={`${styles.iconBtn} pressable`} aria-label="拡大" onClick={() => {
          const v = useAtlas.getState().view ?? { x: 0, y: 0, zoom: fitZoom };
          const next = { ...v, zoom: v.zoom + 0.5 };
          setView(next);
          setInstantView({ ...next, key: Date.now() });
        }}
        >
          ＋
        </button>
        <button className={`${styles.iconBtn} pressable`} aria-label="縮小" onClick={() => {
          const v = useAtlas.getState().view ?? { x: 0, y: 0, zoom: fitZoom };
          const next = { ...v, zoom: v.zoom - 0.5 };
          setView(next);
          setInstantView({ ...next, key: Date.now() });
        }}
        >
          −
        </button>
        <button className={`${styles.iconBtn} pressable`} aria-label="全体表示" onClick={() => {
          const next = { x: 0, y: 0, zoom: fitZoom };
          setView(next);
          setInstantView({ ...next, key: Date.now() });
        }}
        >
          全体
        </button>
        <span className={styles.note}>円の大きさ = 条文の数</span>
      </div>
      <p className={styles.attr}>
        {data?.manifest.attribution.join(' · ')}
        {data ? ` · データ時点 ${data.manifest.egovAsof}` : null}
      </p>
      <DetailPanel onSelectLaw={goToLaw} />
      {!geometry && <div className={styles.loading}>地図を準備しています…</div>}
      <span className="sr-live" aria-live="polite">
        {selectedLawIndex != null && data ? data.laws.title[selectedLawIndex] : selectedEdgeIndex != null ? '参照を選択' : ''}
      </span>
    </div>
  );
}
