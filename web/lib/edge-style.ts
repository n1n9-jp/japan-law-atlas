/** 法令間エッジの見た目。P1〜P3 を満たすよう選んだ値。 */

export const EDGE_LAYER_OPACITY = 0.12;
/** 遠い線の層。ズームしても上げない。 */
export const EDGE_FAR_OPACITY = 0.06;

/** 近い線の層の不透明度。`0.12 × min(4, 2^max(0, Δ − 1))`。 */
export function nearLayerOpacity(delta: number): number {
  return EDGE_LAYER_OPACITY * Math.min(4, 2 ** Math.max(0, delta - 1));
}
/** 頂点アルファの基準。分野をまたぐ線は組の本数の平方根で割る。 */
export const EDGE_VERTEX_ALPHA = 220;
/** 全体表示で組の本数を数える重みの下限。 */
export const OVERVIEW_PAIR_WEIGHT = 5;
/** 同じ分野の中の線。平方根では割らず、この係数だけ掛ける。 */
export const INTRA_CATEGORY_ALPHA_MUL = 0.4;
/** 色分けが参照の種類のとき、cite の頂点アルファ倍率。 */
export const CITE_KIND_ALPHA_MUL = 0.35;

export const EDGE_BLEND = {
  blend: true,
  blendColorOperation: 'add' as const,
  blendColorSrcFactor: 'src-alpha' as const,
  blendColorDstFactor: 'one' as const,
  blendAlphaOperation: 'add' as const,
  blendAlphaSrcFactor: 'one' as const,
  blendAlphaDstFactor: 'one' as const,
  depthTest: false,
};
