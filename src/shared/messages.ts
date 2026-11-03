/** Messages between content script, service worker and side panel. */
import type { PageScan, Rect } from '../detect';

export interface ThumbNeed {
  need: number;
  /** "url|selectorPath" of instances already cropped, so rescans do not duplicate them. */
  sources: string[];
}

export interface Crop {
  variantId: string;
  /** Viewport CSS px. */
  rect: Rect;
  source: string;
}

export type ContentToWorker =
  | { type: 'scan'; manual: boolean; scan: PageScan }
  | { type: 'thumbs-wanted'; variantIds: string[] }
  | { type: 'capture'; crops: Crop[]; dpr: number };

export interface ScanResponse {
  stored: boolean;
  needThumbs: Record<string, ThumbNeed>;
}

export type PanelToWorker =
  | { type: 'start-recording'; tabId: number; url: string }
  | { type: 'stop-recording'; domain: string }
  | { type: 'scan-tab'; tabId: number };

export type WorkerToContent = { type: 'scan-now'; manual: boolean };

export type PanelToContent = { type: 'highlight'; variantIds: string[] } | { type: 'clear-highlight' };

export type Broadcast =
  | { type: 'inventory-changed'; inventoryId: string }
  | { type: 'scan-status'; tabId: number; state: 'scanning' | 'done' | 'error'; message?: string; count?: number }
  /** Thumbnails need activeTab: blocked until the user clicks the toolbar icon (or the shortcut) on that tab. */
  | { type: 'capture-status'; tabId: number; ok: boolean };

export interface CaptureResponse {
  saved: number;
  blocked?: boolean;
}

export interface WorkerReply {
  ok: boolean;
  error?: string;
}
