export {};

declare global {
  interface Window {
    __atlas: {
      ready: boolean;
      edgesReady: boolean;
      visibleEdgeCount: number;
      lastTransitionMs: number;
      selectedLawId: string | null;
    };
  }
}
