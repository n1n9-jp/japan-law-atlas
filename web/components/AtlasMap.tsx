'use client';

import { CollisionFilterExtension, DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import { LinearInterpolator, OrthographicView, TRANSITION_EVENTS } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { neighborSet, topNeighborIds } from '@/lib/adjacency';
import { ensureAtlasGlobal } from '@/lib/atlas-global';
import { cameraDurationMs, EASE_IN_OUT, fitZoomForBounds, screenDeltaToWorld, worldDeltaToScreen } from '@/lib/camera';
import { ACCENT_RGB, BG_RGB, GHOST_RGB, KIND_RGB, lighten } from '@/lib/colors';
import { EDGE_BLEND, EDGE_FAR_OPACITY, nearLayerOpacity } from '@/lib/edge-style';
import {
  farWeightFloor,
  gpuFilterRangeFar,
  gpuFilterRangeNear,
  lawLabelRankCut,
  lodLengthCutoff,
  nearWeightFloor,
} from '@/lib/filters';
import { charsetFrom, chromeWorldBoxes, displayLabel, labelBox, placeLabels, type PlaceableLabel } from '@/lib/labels';
import { LAW_STATUSES, REF_KIND_LABELS, REF_KINDS } from '@/lib/shared/contract';
import { useAtlas } from '@/lib/store';
import styles from './chrome.module.css';

const interpolator = new LinearInterpolator({ transitionProps: ['target', 'zoom'] });

const HIGHLIGHT_DIM = 0.15;
const FLOW_OPACITY = 0.3;
const FLOW_MAX_PX = 4;
const FLOW_TOP_N = 12;
const CITE_KIND = REF_KINDS.indexOf('cite');
const CITE_WIDTH = 1;
const CITE_ALPHA_CAP = 0.4;
const NEIGHBOR_LABELS = 15;
const LABEL_SAMPLE = 'あア漢字・·ー法令民法司法治安';

type Idx = { index: number };

type LawLabel = PlaceableLabel & {
  index: number;
};

/** CollisionFilterExtension は優先度を -1000〜1000 に制限する。 */
function lawCollisionPriority(prRank: number, n: number, kind: 'self' | 'neighbor' | 'other'): number {
  if (kind === 'self') return 1000;
  const t = (prRank - 1) / Math.max(n - 1, 1);
  const base = 1000 - t * 2000;
  return kind === 'neighbor' ? Math.min(980, Math.max(base, 700)) : base;
}

type HiEdge = {
  path: [number, number][];
  colors: [number, number, number, number][];
  width: number;
  index: number;
  src: number;
  tgt: number;
  kind: number;
};

function flattenRings(polygons: number[][][]): [number, number][][][] {
  return polygons.map((poly) => poly.map((ring) => {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i]!, ring[i + 1]!]);
    return pts;
  }));
}

function quadraticPath(
  ax: number, ay: number, bx: number, by: number, bend = 0.2, steps = 20,
): [number, number][] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend * len;
  const cy = my + (dx / len) * bend * len;
  const path: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    path.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]);
  }
  return path;
}

export function AtlasMap({
  onSelectLaw,
  flyTo,
  instantView,
}: {
  onSelectLaw: (index: number | null) => void;
  flyTo: { x: number; y: number; zoom: number; key: number } | null;
  instantView: { x: number; y: number; zoom: number; key: number } | null;
}) {
  const data = useAtlas((s) => s.data);
  const geometry = useAtlas((s) => s.geometry);
  const adj = useAtlas((s) => s.adj);
  const kinds = useAtlas((s) => s.kinds);
  const parts = useAtlas((s) => s.parts);
  const types = useAtlas((s) => s.types);
  const minRefs = useAtlas((s) => s.minRefs);
  const hideIntraFamily = useAtlas((s) => s.hideIntraFamily);
  const colorMode = useAtlas((s) => s.color);
  const focus = useAtlas((s) => s.focus);
  const selectedLaw = useAtlas((s) => s.selectedLawIndex);
  const hoveredLaw = useAtlas((s) => s.hoveredLaw);
  const selectedEdge = useAtlas((s) => s.selectedEdgeIndex);
  const fitZoom = useAtlas((s) => s.fitZoom);
  const reduced = useAtlas((s) => s.reducedMotion);
  const opening = useAtlas((s) => s.opening);
  const setView = useAtlas((s) => s.setView);
  const setFitZoom = useAtlas((s) => s.setFitZoom);
  const setHoverLaw = useAtlas((s) => s.setHoverLaw);
  const selectEdge = useAtlas((s) => s.selectEdge);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [viewState, setViewState] = useState<{ target: [number, number, number]; zoom: number }>({
    target: [0, 0, 0],
    zoom: -2,
  });
  const [fontsReady, setFontsReady] = useState(false);
  const [labelFont, setLabelFont] = useState('"Noto Sans JP", sans-serif');
  const [tip, setTip] = useState<{ x: number; y: number; text: string; instant: boolean } | null>(null);
  const tipTimer = useRef<number | null>(null);
  const seenTip = useRef(false);
  const ready = useRef(false);
  const edgesReadyRef = useRef(false);
  const [edgesOn, setEdgesOn] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const flyKey = useRef(0);
  const instantKey = useRef(0);
  const viewRef = useRef(viewState);
  viewRef.current = viewState;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const edgesOnRef = useRef(edgesOn);
  edgesOnRef.current = edgesOn;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const family = '"Noto Sans JP", sans-serif';
    setLabelFont(family);
    let done = false;
    const mark = () => {
      if (done) return;
      done = true;
      setFontsReady(true);
    };
    const t = window.setTimeout(mark, 800);
    void Promise.all([
      document.fonts.ready,
      document.fonts.load(`11px ${family}`, LABEL_SAMPLE),
      document.fonts.load(`500 14px ${family}`, LABEL_SAMPLE),
      document.fonts.load(`500 16px ${family}`, LABEL_SAMPLE),
    ]).then(mark).catch(mark);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!data) return;
    const z = fitZoomForBounds(data.manifest.bounds, size.width, size.height);
    setFitZoom(z);
    if (!useAtlas.getState().view) {
      const [a, b, c, d] = data.manifest.bounds;
      setViewState({ target: [(a + c) / 2, (b + d) / 2, 0], zoom: z });
    }
  }, [data, size.width, size.height, setFitZoom]);

  useEffect(() => {
    if (!flyTo || flyTo.key === flyKey.current) return;
    flyKey.current = flyTo.key;
    const cur = viewRef.current;
    const dx = flyTo.x - cur.target[0];
    const dy = flyTo.y - cur.target[1];
    const screen = worldDeltaToScreen(dx, dy, cur.zoom);
    const dur = reduced ? 0 : cameraDurationMs(flyTo.zoom - cur.zoom, screen);
    ensureAtlasGlobal().lastTransitionMs = dur;
    setViewState({
      target: [flyTo.x, flyTo.y, 0],
      zoom: flyTo.zoom,
      transitionDuration: dur,
      transitionInterpolator: interpolator,
      transitionEasing: EASE_IN_OUT,
      transitionInterruption: TRANSITION_EVENTS.BREAK,
    } as typeof viewState);
  }, [flyTo, reduced]);

  useEffect(() => {
    if (!instantView || instantView.key === instantKey.current) return;
    instantKey.current = instantView.key;
    ensureAtlasGlobal().lastTransitionMs = 0;
    setViewState({ target: [instantView.x, instantView.y, 0], zoom: instantView.zoom });
    setView({ x: instantView.x, y: instantView.y, zoom: instantView.zoom });
  }, [instantView, setView]);

  const highlight = hoveredLaw ?? selectedLaw;
  const neighbors = useMemo(
    () => (highlight != null && adj ? neighborSet(adj, highlight) : null),
    [highlight, adj],
  );
  const neighborTop = useMemo(
    () => (highlight != null && adj ? new Set(topNeighborIds(adj, highlight, NEIGHBOR_LABELS)) : null),
    [highlight, adj],
  );

  const continentPolys = useMemo(() => {
    if (!data) return [];
    return data.continents.categories.flatMap((c) => {
      const color = data.manifest.categories[c.id]?.color ?? [120, 120, 120];
      return flattenRings(c.polygons).map((polygon, i) => ({
        polygon,
        color,
        id: c.id,
        groupId: data.manifest.categories[c.id]?.groupId ?? 0,
        key: `${c.id}-${i}`,
      }));
    });
  }, [data]);

  const flowPaths = useMemo(() => {
    if (!data || !focus) return [];
    const cats = data.manifest.categories;
    const involved = (src: number, tgt: number) => {
      if (focus.kind === 'category') return src === focus.id || tgt === focus.id;
      return cats[src]?.groupId === focus.id || cats[tgt]?.groupId === focus.id;
    };
    const idxs: number[] = [];
    for (let i = 0; i < data.flows.n; i++) {
      if (involved(data.flows.src[i]!, data.flows.tgt[i]!)) idxs.push(i);
    }
    idxs.sort((a, b) => data.flows.refs[b]! - data.flows.refs[a]!);
    const out: { path: [number, number][]; color: [number, number, number]; width: number }[] = [];
    for (const i of idxs.slice(0, FLOW_TOP_N)) {
      const s = cats[data.flows.src[i]!]!;
      const t = cats[data.flows.tgt[i]!]!;
      const [ax, ay] = s.labelPos;
      const [bx, by] = t.labelPos;
      out.push({
        path: quadraticPath(ax, ay, bx, by, 0.2, 20),
        color: s.color,
        width: Math.min(FLOW_MAX_PX, Math.sqrt(data.flows.refs[i]!)),
      });
    }
    return out;
  }, [data, focus]);

  const edgeData = useMemo(() => {
    if (!geometry || !data) return null;
    const colorBuf = colorMode === 'kind' ? geometry.colorByKind : geometry.colorByCategory;
    return {
      length: data.edges.n,
      startIndices: geometry.startIndices,
      attributes: {
        getPath: { value: geometry.positions, size: 2 },
        getWidth: { value: geometry.widths, size: 1 },
        getColor: { value: colorBuf, size: 4 },
        getFilterValue: { value: geometry.filterValue, size: 4 },
        getDashArray: { value: geometry.dash, size: 2 },
      },
    };
  }, [geometry, data, colorMode]);

  const hiEdges = useMemo(() => {
    if (!data || !geometry || highlight == null || !adj) return [] as HiEdge[];
    const list: HiEdge[] = [];
    const seen = new Set<number>();
    const candidates = [...(adj.out[highlight] ?? []), ...(adj.in[highlight] ?? [])];
    for (const rec of candidates) {
      const e = rec.edgeIndex;
      if (seen.has(e)) continue;
      seen.add(e);
      const packed = geometry.packedIndex[e]!;
      const a = geometry.startIndices[packed]!;
      const b = geometry.startIndices[packed + 1]!;
      const path: [number, number][] = [];
      const colors: [number, number, number, number][] = [];
      const n = b - a;
      const kind = data.edges.domKind[e]!;
      const rgb = KIND_RGB[kind] ?? [217, 222, 231];
      const selected = selectedLaw === highlight;
      const cite = kind === CITE_KIND;
      const dstAlpha = cite ? CITE_ALPHA_CAP : 1;
      const width = cite ? CITE_WIDTH : selected ? 2 : 1.5;
      for (let k = 0; k < n; k++) {
        const p = a + k;
        path.push([geometry.positions[p * 2]!, geometry.positions[p * 2 + 1]!]);
        const t = n <= 1 ? 1 : k / (n - 1);
        const alpha = Math.round((0.25 + (dstAlpha - 0.25) * t) * 255);
        colors.push([rgb[0]!, rgb[1]!, rgb[2]!, alpha]);
      }
      list.push({
        path, colors, width, index: e, kind,
        src: data.edges.src[e]!, tgt: data.edges.tgt[e]!,
      });
    }
    return list;
  }, [adj, data, geometry, highlight, selectedLaw]);

  const citeHi = useMemo(() => hiEdges.filter((e) => e.kind === CITE_KIND), [hiEdges]);
  const otherHi = useMemo(() => hiEdges.filter((e) => e.kind !== CITE_KIND), [hiEdges]);

  const zoom = viewState.zoom;
  const delta = zoom - fitZoom;
  const lz = lodLengthCutoff(size.width, size.height, zoom, fitZoom);
  const nearFloor = nearWeightFloor(delta);
  const farFloor = farWeightFloor(delta);
  const showFar = delta > 0.5;
  const showGroups = zoom < fitZoom + 0.75;
  const showCats = zoom >= fitZoom + 0.75 && zoom < fitZoom + 3;
  const rankCut = lawLabelRankCut(zoom, fitZoom);

  const lawLabels = useMemo((): LawLabel[] => {
    if (!data) return [];
    const overview = zoom < fitZoom + 0.75;
    const scale = 2 ** zoom;
    const halfW = (size.width / scale) * 0.7;
    const halfH = (size.height / scale) * 0.7;
    const cx = viewState.target[0];
    const cy = viewState.target[1];
    const blocked = chromeWorldBoxes(size.width, size.height, zoom, viewState.target);
    if (overview) {
      for (const g of data.manifest.groups) {
        const pos = data.continents.groups.find((x) => x.id === g.id)?.labelPos;
        if (!pos) continue;
        blocked.push(labelBox(pos[0], pos[1], displayLabel(g.name), zoom, 16));
      }
    } else if (zoom < fitZoom + 3) {
      for (const c of data.manifest.categories) {
        blocked.push(labelBox(c.labelPos[0], c.labelPos[1], displayLabel(c.name), zoom, 14));
      }
    }
    const out: LawLabel[] = [];
    for (let i = 0; i < data.laws.n; i++) {
      const self = i === selectedLaw;
      const neighbor = neighborTop?.has(i) ?? false;
      const pinned = self || neighbor;
      if (overview && !pinned) continue;
      if (!pinned && data.laws.prRank[i]! > rankCut) continue;
      const x = data.laws.x[i]!;
      const y = data.laws.y[i]!;
      if (!pinned && (x < cx - halfW || x > cx + halfW || y < cy - halfH || y > cy + halfH)) continue;
      const kind = self ? 'self' : neighbor ? 'neighbor' : 'other';
      out.push({
        index: i,
        position: [x, y],
        text: displayLabel(data.laws.label[i]!),
        priority: lawCollisionPriority(data.laws.prRank[i]!, data.laws.n, kind),
        locked: self,
      });
    }
    return placeLabels(out, zoom, blocked);
  }, [data, neighborTop, rankCut, zoom, fitZoom, size.width, size.height, viewState.target, selectedLaw]);

  const groupCharset = useMemo(
    () => (data ? charsetFrom(data.manifest.groups.map((g) => g.name)) : []),
    [data],
  );
  const catCharset = useMemo(
    () => (data ? charsetFrom(data.manifest.categories.map((c) => c.name)) : []),
    [data],
  );
  const lawCharset = useMemo(
    () => charsetFrom(lawLabels.map((d) => d.text)),
    [lawLabels],
  );
  const labelFontSettings = useMemo(
    () => ({ sdf: false, fontSize: 64, buffer: 4 }),
    [],
  );

  if (!data) return <div className={styles.map} ref={wrap} />;

  const minZoom = fitZoom - 1;
  const maxZoom = fitZoom + 7;
  const fillA = zoom > fitZoom + 3 ? Math.round(0.04 * 255) : Math.round(0.08 * 255);
  const dimEdges = highlight != null || selectedEdge != null ? HIGHLIGHT_DIM : 1;
  const openingMul = opening ? 0 : 1;
  const filterCats = [kinds, types, types, hideIntraFamily ? [0] : [0, 1]];

  const inFocus = (catId: number, groupId: number) => {
    if (!focus) return true;
    if (focus.kind === 'category') return catId === focus.id;
    return groupId === focus.id;
  };

  const layers = [];
  layers.push(new SolidPolygonLayer({
    id: 'continents-fill',
    data: continentPolys,
    getPolygon: (d: { polygon: [number, number][][] }) => d.polygon[0] ?? [],
    getFillColor: (d) => {
      const dim = inFocus(d.id, d.groupId) ? 1 : 0.25;
      return [...d.color, Math.round(fillA * dim * (openingMul || 1))] as [number, number, number, number];
    },
    filled: true,
    stroked: false,
    pickable: false,
    parameters: { depthTest: false },
  }));
  layers.push(new PathLayer({
    id: 'continents-stroke',
    data: continentPolys.map((d) => ({ path: d.polygon[0], color: d.color, id: d.id, groupId: d.groupId })),
    getPath: (d) => d.path,
    getColor: (d) => {
      const dim = inFocus(d.id, d.groupId) ? 1 : 0.25;
      return [...d.color, Math.round(255 * 0.25 * dim)] as [number, number, number, number];
    },
    getWidth: 1,
    widthUnits: 'pixels',
    pickable: false,
  }));

  if (flowPaths.length) {
    layers.push(new PathLayer({
      id: 'flows',
      data: flowPaths,
      getPath: (d) => d.path,
      getColor: (d) => [...d.color, 255] as [number, number, number, number],
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      pickable: false,
      opacity: FLOW_OPACITY * dimEdges,
    }));
  }

  const nearOnTop = delta >= 3;
  const pushHiEdges = () => {
    layers.push(new PathLayer({
      id: 'edges-hi-cite',
      data: citeHi,
      getPath: (d) => d.path,
      getColor: (d) => d.colors,
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      pickable: true,
      jointRounded: true,
    }));
    layers.push(new PathLayer({
      id: 'edges-hi-other',
      data: otherHi,
      getPath: (d) => d.path,
      getColor: (d) => d.colors,
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      pickable: true,
      jointRounded: true,
    }));
  };
  let pushNear: (() => void) | null = null;
  if (edgeData && edgesOn && geometry) {
    const nearRange = gpuFilterRangeNear(parts, minRefs, nearFloor, lz);
    const farRange = gpuFilterRangeFar(parts, minRefs, farFloor, lz);
    const getFilterCategory = (_d: unknown, { index }: Idx) => [
      geometry.filterCategory[index * 4]!,
      geometry.filterCategory[index * 4 + 1]!,
      geometry.filterCategory[index * 4 + 2]!,
      geometry.filterCategory[index * 4 + 3]!,
    ];
    pushNear = () => {
      layers.push(new PathLayer({
        id: 'edges-near',
        data: edgeData as never,
        getFilterCategory,
        widthUnits: 'pixels',
        pickable: false,
        opacity: nearLayerOpacity(delta) * dimEdges,
        extensions: [
          new DataFilterExtension({ filterSize: 4, categorySize: 4 }),
          new PathStyleExtension({ dash: true }),
        ],
        filterRange: nearRange,
        filterCategories: filterCats,
        parameters: EDGE_BLEND,
        updateTriggers: {
          getColor: colorMode,
          getFilterCategory: [kinds.join(), types.join(), hideIntraFamily],
          filterRange: [parts, minRefs, nearFloor, lz],
          filterCategories: [kinds.join(), types.join(), hideIntraFamily],
        },
      }));
    };
    layers.push(new PathLayer({
      id: 'edges-far',
      data: edgeData as never,
      getFilterCategory,
      widthUnits: 'pixels',
      pickable: false,
      visible: showFar,
      opacity: EDGE_FAR_OPACITY * dimEdges,
      extensions: [
        new DataFilterExtension({ filterSize: 4, categorySize: 4 }),
        new PathStyleExtension({ dash: true }),
      ],
      filterRange: farRange,
      filterCategories: filterCats,
      parameters: EDGE_BLEND,
      updateTriggers: {
        getColor: colorMode,
        getFilterCategory: [kinds.join(), types.join(), hideIntraFamily],
        filterRange: [parts, minRefs, farFloor, lz],
        filterCategories: [kinds.join(), types.join(), hideIntraFamily],
      },
    }));
    if (!nearOnTop) pushNear();
  }

  if (!nearOnTop) pushHiEdges();

  const ghost = LAW_STATUSES.indexOf('repealed');
  layers.push(new ScatterplotLayer({
    id: 'laws',
    data: { length: data.laws.n },
    getPosition: (_d: unknown, { index }: Idx) => [data.laws.x[index]!, data.laws.y[index]!],
    getRadius: (_d: unknown, { index }: Idx) => data.laws.r[index]!,
    radiusUnits: 'common',
    radiusMinPixels: 1.2,
    radiusMaxPixels: 48,
    getFillColor: (_d: unknown, { index }: Idx) => {
      const st = data.laws.status[index]!;
      const cat = data.manifest.categories[data.laws.category[index]!]!;
      const dimFocus = inFocus(data.laws.category[index]!, cat.groupId) ? 1 : 0.25;
      const dimN = neighbors && !neighbors.has(index) ? 0.25 : 1;
      const a = Math.round(255 * dimFocus * dimN);
      if (st === ghost) return [0, 0, 0, 0];
      return [cat.color[0]!, cat.color[1]!, cat.color[2]!, a];
    },
    getLineColor: (_d: unknown, { index }: Idx) => {
      if (data.laws.status[index] !== ghost) return [0, 0, 0, 0];
      return [...GHOST_RGB, 200] as [number, number, number, number];
    },
    getLineWidth: (_d: unknown, { index }: Idx) => (data.laws.status[index] === ghost ? 1 : 0),
    lineWidthUnits: 'pixels',
    stroked: true,
    filled: true,
    pickable: true,
    extensions: [new DataFilterExtension({ categorySize: 2 })],
    getFilterCategory: (_d: unknown, { index }: Idx) => [data.laws.type[index]!, data.laws.status[index]!],
    filterCategories: [types, [0, 1, 2]],
    updateTriggers: {
      getFillColor: [selectedLaw, hoveredLaw, focus?.id, focus?.kind],
      filterCategories: types.join(),
    },
  }));

  if (nearOnTop) {
    pushNear?.();
    pushHiEdges();
  }

  if (selectedLaw != null) {
    layers.push(new ScatterplotLayer({
      id: 'sel-ring',
      data: [{ position: [data.laws.x[selectedLaw]!, data.laws.y[selectedLaw]!], r: data.laws.r[selectedLaw]! }],
      getPosition: (d) => d.position,
      getRadius: (d) => d.r,
      radiusUnits: 'common',
      radiusMinPixels: 2,
      stroked: true,
      filled: false,
      getLineColor: [...ACCENT_RGB, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      pickable: false,
    }));
  }

  if (fontsReady) {
    if (showGroups) {
      layers.push(new TextLayer({
        id: 'labels-group',
        data: data.manifest.groups,
        getPosition: (d) => {
          const g = data.continents.groups.find((x) => x.id === d.id);
          return g?.labelPos ?? [0, 0];
        },
        getText: (d) => displayLabel(d.name),
        getSize: 16,
        getColor: [255, 252, 245, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: labelFont,
        fontWeight: 500,
        characterSet: groupCharset,
        fontSettings: labelFontSettings,
        outlineWidth: 0.2,
        outlineColor: [...BG_RGB, 255],
        pickable: false,
      }));
    }
    if (showCats) {
      layers.push(new TextLayer({
        id: 'labels-cat',
        data: data.manifest.categories,
        getPosition: (d) => d.labelPos,
        getText: (d) => displayLabel(d.name),
        getSize: 14,
        getColor: (d) => [...lighten(d.color, 0.82), 255] as [number, number, number, number],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: labelFont,
        fontWeight: 500,
        characterSet: catCharset,
        fontSettings: labelFontSettings,
        outlineWidth: 0.2,
        outlineColor: [...BG_RGB, 255],
        getCollisionPriority: (d: { lawCount: number }) => Math.min(1000, d.lawCount),
        extensions: [new CollisionFilterExtension()],
        collisionEnabled: true,
        collisionGroup: 'cat-labels',
        pickable: false,
      }));
    }
    if (lawLabels.length) {
      layers.push(new TextLayer({
        id: 'labels-laws',
        data: lawLabels,
        getPosition: (d: LawLabel) => d.position,
        getText: (d: LawLabel) => d.text,
        getSize: 11,
        getColor: (d: LawLabel) => (
          d.locked ? [255, 252, 245, 255] : [232, 230, 225, 240]
        ) as [number, number, number, number],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: labelFont,
        fontWeight: 500,
        characterSet: lawCharset,
        fontSettings: labelFontSettings,
        outlineWidth: 0.2,
        outlineColor: [...BG_RGB, 255],
        pickable: false,
        updateTriggers: { getColor: selectedLaw },
      }));
    }
  }

  const showTip = (x: number, y: number, text: string) => {
    const instant = seenTip.current;
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    if (instant) {
      setTip({ x, y, text, instant: true });
      return;
    }
    tipTimer.current = window.setTimeout(() => {
      seenTip.current = true;
      setTip({ x, y, text, instant: false });
    }, 250);
  };

  const isHiLayer = (id: string | undefined) => id === 'edges-hi-cite' || id === 'edges-hi-other';

  return (
    <div className={styles.map} ref={wrap}>
      <DeckGL
        views={new OrthographicView({
          flipY: false,
          controller: { doubleClickZoom: true, scrollZoom: true, dragPan: true },
          clearColor: [BG_RGB[0], BG_RGB[1], BG_RGB[2], 255],
        })}
        viewState={{ ...viewState, minZoom, maxZoom }}
        onViewStateChange={({ viewState: vs }) => {
          const next = vs as { target: [number, number, number]; zoom: number };
          setViewState({ target: next.target, zoom: next.zoom });
          setView({ x: next.target[0], y: next.target[1], zoom: next.zoom });
        }}
        layers={layers}
        useDevicePixels
        getCursor={({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
        onAfterRender={() => {
          if (!ready.current && data) {
            ready.current = true;
            performance.mark('atlas:first-frame');
            ensureAtlasGlobal().ready = true;
            window.setTimeout(() => setEdgesOn(true), 300);
          }
          if (!edgesReadyRef.current && geometryRef.current && edgesOnRef.current) {
            edgesReadyRef.current = true;
            ensureAtlasGlobal().edgesReady = true;
          }
        }}
        onClick={(info) => {
          if (isHiLayer(info.layer?.id) && info.object) {
            selectEdge((info.object as { index: number }).index);
            return;
          }
          if (info.layer?.id === 'laws' && info.index != null && info.index >= 0) {
            onSelectLaw(info.index);
            return;
          }
          if (!info.picked) onSelectLaw(null);
        }}
        onHover={(info) => {
          if (info.layer?.id === 'laws' && info.index != null && info.index >= 0) {
            setHoverLaw(info.index);
            const i = info.index;
            const cat = data.manifest.categories[data.laws.category[i]!]!;
            showTip(info.x, info.y, `${data.laws.label[i]}　${cat.name}　→${data.laws.outLaws[i]} ←${data.laws.inLaws[i]}`);
            return;
          }
          if (isHiLayer(info.layer?.id) && info.object) {
            const o = info.object as { src: number; tgt: number; index: number };
            const kind = REF_KIND_LABELS[REF_KINDS[data.edges.domKind[o.index]!]!];
            const n = data.edges.mainRefs[o.index]!;
            showTip(info.x, info.y, `${data.laws.label[o.src]} → ${data.laws.label[o.tgt]}　${kind} ${n}`);
            setHoverLaw(null);
            return;
          }
          setHoverLaw(null);
          setTip(null);
        }}
        style={{ width: '100%', height: '100%', background: 'var(--bg)' }}
      />
      {tip && (
        <div
          className={styles.tooltip}
          data-instant={tip.instant}
          style={{ position: 'absolute', left: tip.x + 12, top: tip.y + 12 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

export default AtlasMap;

export function panBy(px: number, py: number): void {
  const s = useAtlas.getState();
  const view = s.view ?? { x: 0, y: 0, zoom: s.fitZoom };
  const [dx, dy] = screenDeltaToWorld(px, py, view.zoom);
  s.setView({ x: view.x + dx, y: view.y + dy, zoom: view.zoom });
}
