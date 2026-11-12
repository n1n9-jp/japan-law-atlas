import { buildGeometryFromPacked, type PackedGeometryInput } from '../lib/geometry';

self.onmessage = (ev: MessageEvent<PackedGeometryInput>) => {
  const geo = buildGeometryFromPacked(ev.data);
  const transfer: Transferable[] = [
    geo.positions.buffer,
    geo.startIndices.buffer,
    geo.packedIndex.buffer,
    geo.widths.buffer,
    geo.colorByCategory.buffer,
    geo.colorByKind.buffer,
    geo.dash.buffer,
    geo.filterValue.buffer,
    geo.filterCategory.buffer,
    geo.categoryCenters.buffer,
  ];
  (self as DedicatedWorkerGlobalScope).postMessage(geo, transfer);
};
