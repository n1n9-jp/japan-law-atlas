export interface AtlasGlobal {
  ready: boolean;
  edgesReady: boolean;
  visibleEdgeCount: number;
  lastTransitionMs: number;
  selectedLawId: string | null;
}

declare global {
  interface Window {
    __atlas: AtlasGlobal;
  }
}

export function ensureAtlasGlobal(): AtlasGlobal {
  if (typeof window === 'undefined') {
    return { ready: false, edgesReady: false, visibleEdgeCount: 0, lastTransitionMs: 0, selectedLawId: null };
  }
  if (!window.__atlas) {
    window.__atlas = { ready: false, edgesReady: false, visibleEdgeCount: 0, lastTransitionMs: 0, selectedLawId: null };
  }
  return window.__atlas;
}
