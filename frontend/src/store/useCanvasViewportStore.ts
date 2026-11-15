import { create } from 'zustand';

export interface CanvasViewport {
  pan: { x: number; y: number };
  zoom: number;
}

interface CanvasViewportState extends CanvasViewport {
  /** Only restoration increments this; normal panning must not feed itself back. */
  restoreRevision: number;
  capture: (viewport: CanvasViewport) => void;
  restore: (viewport?: CanvasViewport) => void;
}

const INITIAL: CanvasViewport = { pan: { x: 0, y: 0 }, zoom: 1 };

function clean(viewport?: CanvasViewport): CanvasViewport {
  if (!viewport || !Number.isFinite(viewport.pan?.x) || !Number.isFinite(viewport.pan?.y) ||
      !Number.isFinite(viewport.zoom) || viewport.zoom < 0.1 || viewport.zoom > 5) return INITIAL;
  return { pan: { x: viewport.pan.x, y: viewport.pan.y }, zoom: viewport.zoom };
}

export const useCanvasViewportStore = create<CanvasViewportState>((set) => ({
  ...INITIAL,
  restoreRevision: 0,
  capture: (viewport) => set(clean(viewport)),
  restore: (viewport) => set((state) => ({ ...clean(viewport), restoreRevision: state.restoreRevision + 1 })),
}));
