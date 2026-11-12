'use client';

import { create } from 'zustand';
import type { GeometryBuffers } from './geometry';
import type { AtlasData } from './load-data';
import type { Adjacency } from './adjacency';
import {
  defaultUrlState,
  type AtlasUrlState,
  type ColorMode,
  type PartsFilter,
} from './url-state';

export interface AtlasStore extends AtlasUrlState {
  data: AtlasData | null;
  geometry: GeometryBuffers | null;
  adj: Adjacency | null;
  error: string | null;
  hideIntraFamily: boolean;
  hoveredLaw: number | null;
  hoveredEdge: number | null;
  selectedLawIndex: number | null;
  selectedEdgeIndex: number | null;
  searchOpen: boolean;
  legendOpen: boolean;
  filterOpen: boolean;
  sheetExpanded: boolean;
  opening: boolean;
  reducedMotion: boolean;
  fitZoom: number;
  view: { x: number; y: number; zoom: number } | null;
  setData: (data: AtlasData, adj: Adjacency) => void;
  setGeometry: (geometry: GeometryBuffers) => void;
  setError: (error: string | null) => void;
  applyUrl: (state: AtlasUrlState) => void;
  selectLaw: (index: number | null, push?: boolean) => void;
  selectEdge: (index: number | null, push?: boolean) => void;
  setHoverLaw: (index: number | null) => void;
  setHoverEdge: (index: number | null) => void;
  setFilter: (patch: Partial<Pick<AtlasStore, 'kinds' | 'parts' | 'types' | 'minRefs' | 'color' | 'hideIntraFamily' | 'focus'>>) => void;
  setView: (view: { x: number; y: number; zoom: number }) => void;
  setFitZoom: (z: number) => void;
  setUi: (patch: Partial<Pick<AtlasStore, 'searchOpen' | 'legendOpen' | 'filterOpen' | 'sheetExpanded' | 'opening' | 'reducedMotion'>>) => void;
}

export const useAtlas = create<AtlasStore>((set, get) => ({
  ...defaultUrlState(),
  data: null,
  geometry: null,
  adj: null,
  error: null,
  hideIntraFamily: false,
  hoveredLaw: null,
  hoveredEdge: null,
  selectedLawIndex: null,
  selectedEdgeIndex: null,
  searchOpen: false,
  legendOpen: false,
  filterOpen: false,
  sheetExpanded: false,
  opening: false,
  reducedMotion: false,
  fitZoom: 0,
  setData: (data, adj) => set({ data, adj }),
  setGeometry: (geometry) => set({ geometry }),
  setError: (error) => set({ error }),
  applyUrl: (state) => {
    const data = get().data;
    let selectedLawIndex: number | null = null;
    let selectedEdgeIndex: number | null = null;
    if (data && state.law) {
      const i = data.laws.id.indexOf(state.law);
      selectedLawIndex = i >= 0 ? i : null;
    }
    if (data && state.edge) {
      const s = data.laws.id.indexOf(state.edge.src);
      const t = data.laws.id.indexOf(state.edge.tgt);
      if (s >= 0 && t >= 0) {
        for (let i = 0; i < data.edges.n; i++) {
          if (data.edges.src[i] === s && data.edges.tgt[i] === t) {
            selectedEdgeIndex = i;
            break;
          }
        }
      }
    }
    set({
      ...state,
      selectedLawIndex,
      selectedEdgeIndex,
    });
    if (typeof window !== 'undefined') {
      window.__atlas = window.__atlas ?? {
        ready: false, edgesReady: false, visibleEdgeCount: 0, lastTransitionMs: 0, selectedLawId: null,
      };
      window.__atlas.selectedLawId = selectedLawIndex != null && data ? data.laws.id[selectedLawIndex]! : null;
    }
  },
  selectLaw: (index) => {
    const data = get().data;
    set({
      selectedLawIndex: index,
      selectedEdgeIndex: null,
      law: index != null && data ? data.laws.id[index]! : null,
      edge: null,
      searchOpen: false,
    });
  },
  selectEdge: (index) => {
    const data = get().data;
    if (index == null || !data) {
      set({ selectedEdgeIndex: null, edge: null });
      return;
    }
    const s = data.edges.src[index]!;
    const t = data.edges.tgt[index]!;
    set({
      selectedEdgeIndex: index,
      selectedLawIndex: null,
      edge: { src: data.laws.id[s]!, tgt: data.laws.id[t]! },
      law: null,
    });
  },
  setHoverLaw: (index) => set({ hoveredLaw: index }),
  setHoverEdge: (index) => set({ hoveredEdge: index }),
  setFilter: (patch) => set(patch),
  setView: (view) => set({ view }),
  setFitZoom: (fitZoom) => set({ fitZoom }),
  setUi: (patch) => set(patch),
}));

export type { ColorMode, PartsFilter };
