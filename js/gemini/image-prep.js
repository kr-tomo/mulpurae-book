import { AppError } from '../core/errors.js';

export const ACCEPTED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.85;

/**
 * @param {{type: string, size: number}} file
 * @returns {void}
 */
export function checkImageFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new AppError('validation', 'JPEG·PNG·WebP 이미지만 분석할 수 있습니다 (HEIC 는 JPEG 로 바꿔 주세요)');
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    throw new AppError('validation', '이미지 파일은 0 바이트보다 크고 20MB 이하여야 합니다');
  }
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} max
 * @returns {{width: number, height: number}}
 */
export function fitWithin(w, h, max) {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const short = Math.max(1, Math.round((Math.min(w, h) * max) / long));
  return w >= h ? { width: max, height: short } : { width: short, height: max };
}

/**
 * Re-encodes so that only our JPEG — never the original bytes or their EXIF — leaves the browser.
 * @param {Blob & {type: string}} file
 * @param {{maxEdge?: number, quality?: number}} [opts]
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function prepareImage(file, opts = {}) {
  checkImageFile(file);
  /** @type {ImageBitmap} */
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new AppError('validation', '이미지를 읽을 수 없습니다', { cause: err });
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxEdge ?? DEFAULT_MAX_EDGE);
    const quality = opts.quality ?? DEFAULT_QUALITY;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      draw(/** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d')), bitmap, width, height);
      return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }), width, height };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), bitmap, width, height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new AppError('validation', '이미지를 변환할 수 없습니다'))), 'image/jpeg', quality),
    );
    return { blob: /** @type {Blob} */ (blob), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {ImageBitmap} bitmap
 * @param {number} width
 * @param {number} height
 */
function draw(ctx, bitmap, width, height) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
