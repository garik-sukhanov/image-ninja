declare module 'magic-wand-tool' {
  export interface MagicWandImage {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    bytes: number;
  }

  export interface MagicWandMask {
    data: Uint8Array;
    width: number;
    height: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  }

  export function floodFill(
    image: MagicWandImage,
    px: number,
    py: number,
    colorThreshold: number,
    mask?: MagicWandMask | null,
    includeBorders?: boolean,
  ): MagicWandMask | null;

  export function gaussBlurOnlyBorder(
    mask: MagicWandMask,
    radius: number,
    visited?: Uint8Array | null,
  ): MagicWandMask;

  export function createBorderMask(mask: MagicWandMask): MagicWandMask;
}
