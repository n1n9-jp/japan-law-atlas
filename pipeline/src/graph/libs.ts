import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type Attr = Record<string, unknown>;

export interface GGraph {
  order: number;
  size: number;
  addNode(key: string, attr?: Attr): void;
  addEdge(src: string, tgt: string, attr?: Attr): void;
  hasNode(key: string): boolean;
  hasEdge(src: string, tgt: string): boolean;
  getEdgeAttributes(src: string, tgt: string): Attr;
  setEdgeAttribute(src: string, tgt: string, name: string, value: unknown): void;
  getEdgeAttribute(src: string, tgt: string, name: string): unknown;
  getNodeAttributes(key: string): Attr;
  forEachNode(fn: (key: string, attr: Attr) => void): void;
}

type GraphCtor = new (opts?: { type?: 'directed' | 'undirected' | 'mixed'; allowSelfLoops?: boolean }) => GGraph;

export const Graph = require('graphology') as GraphCtor;

export const forceAtlas2 = require('graphology-layout-forceatlas2') as {
  assign(graph: GGraph, params: { iterations: number; getEdgeWeight?: string; settings?: Record<string, unknown> }): void;
};

export const noverlap = require('graphology-layout-noverlap') as {
  assign(graph: GGraph, params: { maxIterations?: number; settings?: Record<string, unknown> }): void;
};

export const pagerank = require('graphology-metrics/centrality/pagerank.js') as (
  graph: GGraph,
  opts?: { alpha?: number; tolerance?: number; maxIterations?: number; getEdgeWeight?: string },
) => Record<string, number>;

export const louvain = require('graphology-communities-louvain') as (
  graph: GGraph,
  opts?: { resolution?: number; rng?: () => number; getEdgeWeight?: string },
) => Record<string, number>;

export interface DensityFn<T> {
  x(fn: (d: T) => number): DensityFn<T>;
  y(fn: (d: T) => number): DensityFn<T>;
  weight(fn: (d: T) => number): DensityFn<T>;
  size(s: [number, number]): DensityFn<T>;
  bandwidth(n: number): DensityFn<T>;
  cellSize(n: number): DensityFn<T>;
  contours(data: T[]): ((value: number) => { coordinates: number[][][][]; value: number }) & { readonly max: number };
}

export const contourDensity = require('d3-contour').contourDensity as <T>() => DensityFn<T>;

const polylabelMod = require('polylabel') as
  | ((polygon: number[][][], precision?: number) => [number, number] & { distance: number })
  | { default: (polygon: number[][][], precision?: number) => [number, number] & { distance: number } };
export const polylabel = (
  typeof polylabelMod === 'function' ? polylabelMod : polylabelMod.default
) as (polygon: number[][][], precision?: number) => [number, number] & { distance: number };

export const culori = require('culori') as {
  converter(mode: 'rgb'): (color: unknown) => { r: number; g: number; b: number } | undefined;
  clampChroma(color: unknown, mode?: string): unknown;
};
