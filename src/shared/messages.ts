/** Messages between content script, service worker and side panel. */
import type { CaptureDraft, Kind, Matcher, PageScan, PickRule, PickTarget, Rect } from '../detect';

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
  | { type: 'capture'; crops: Crop[]; dpr: number }
  | { type: 'get-rules' }
  /** The element picker: the user clicked an element (also heard by the side panel). */
  | { type: 'picked'; target: PickTarget; suggestion: Kind; label: string; size: string }
  | { type: 'pick-cancelled' }
  /** The board: store this element, cropping `rect` (viewport px) out of a screenshot for its preview. */
  | { type: 'collect'; draft: CaptureDraft; rect: Rect | null; dpr: number; source: 'picked' | 'found'; groupId?: string | null }
  /** Collecting started or stopped on the page (Esc, or the shortcut). Heard by the side panel. */
  | { type: 'collect-state'; on: boolean };

export interface CollectResponse {
  ok: boolean;
  added: boolean;
  groupName: string | null;
  preview: boolean;
  error?: string;
}

export interface FindResponse {
  ok: boolean;
  /** Elements on the page that match the group, collected or not. */
  count: number;
  /** New versions found and collected. */
  added: number;
  route: string;
  error?: string;
}

export interface ScanResponse {
  stored: boolean;
  needThumbs: Record<string, ThumbNeed>;
}

export type PanelToWorker =
  | { type: 'start-recording'; tabId: number; url: string }
  | { type: 'stop-recording'; domain: string }
  | { type: 'scan-tab'; tabId: number }
  | { type: 'start-pick'; tabId: number }
  | { type: 'add-rule'; tabId: number; domain: string; rule: PickRule }
  | { type: 'set-collecting'; tabId: number; on: boolean }
  | { type: 'find-similar'; tabId: number; groupId: string };

export type WorkerToContent =
  | { type: 'scan-now'; manual: boolean }
  | { type: 'pick-start' }
  | { type: 'collect-start' }
  | { type: 'collect-stop' }
  | { type: 'collect-toggle' }
  /** `known`: style keys already in the group; matches with a new key get collected. */
  | { type: 'find-similar'; groupId: string; matchers: Matcher[]; known: string[] };

export type PanelToContent =
  | { type: 'highlight'; variantIds: string[] }
  | { type: 'highlight-selectors'; selectors: string[] }
  | { type: 'clear-highlight' }
  | { type: 'pick-cancel' };

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
