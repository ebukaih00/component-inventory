/** Crops element thumbnails out of a visible-tab screenshot, in the service worker. */
import type { Crop } from '../shared/messages';

/** Auto-detect thumbnails: 2× the panel's 48px tile. */
export const THUMB_MAX = { w: 640, h: 96 };
/** Board previews are shown larger, and cards need to stay readable. */
export const BOARD_MAX = { w: 960, h: 640 };

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

export async function cropScreenshot(screenshot: string, crops: Crop[], dpr: number, max = THUMB_MAX): Promise<{ crop: Crop; dataUrl: string }[]> {
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob());
  const out: { crop: Crop; dataUrl: string }[] = [];
  for (const crop of crops) {
    const sx = Math.max(0, Math.floor(crop.rect.x * dpr));
    const sy = Math.max(0, Math.floor(crop.rect.y * dpr));
    const sw = Math.min(bitmap.width - sx, Math.ceil(crop.rect.width * dpr));
    const sh = Math.min(bitmap.height - sy, Math.ceil(crop.rect.height * dpr));
    if (sw < 2 || sh < 2) continue;
    const scale = Math.min(1, max.w / sw, max.h / sh);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    // PNG, because Figma's createImage accepts PNG, JPEG and GIF only.
    out.push({ crop, dataUrl: await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' })) });
  }
  bitmap.close();
  return out;
}

/** captureVisibleTab is limited to 2 calls a second; queue every capture through this. */
const MIN_GAP_MS = 550;
let chain: Promise<unknown> = Promise.resolve();
let last = 0;

export function throttledCapture(windowId: number): Promise<string> {
  const run = async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
