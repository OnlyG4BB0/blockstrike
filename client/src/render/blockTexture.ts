import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { RENDER } from '../config.ts';

/**
 * Texture dei blocchi generata al volo: grana leggera e bordo scuro, in scala di grigi.
 * Viene moltiplicata per il colore di ogni blocco, così una sola texture serve tutta la mappa.
 */
export function createBlockTexture(maxAnisotropy: number): CanvasTexture {
  const size = RENDER.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Il browser non supporta il canvas 2D.');

  const image = context.createImageData(size, size);
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 246 + (random() - 0.5) * 14;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (border) value *= 0.78;
      else if (x === 1 || y === 1) value += 6;
      const i = (y * size + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
