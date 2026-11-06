/** Helpers both panel views use. */
import type { ComponentChildren } from 'preact';
import type { PanelToWorker, WorkerReply } from '../shared/messages';
import type { TabInfo } from './useInventory';

export async function askWorker<T = WorkerReply>(msg: PanelToWorker): Promise<T> {
  return ((await chrome.runtime.sendMessage(msg)) ?? { ok: false, error: 'No response from the extension.' }) as T;
}

/** Asks for this product's host permission. Must run inside the click's user gesture. */
export async function requestSiteAccess(tab: TabInfo): Promise<boolean> {
  if (!tab.url) return false;
  const u = new URL(tab.url);
  return chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] }).catch(() => false);
}

export function download(contents: string, type: string, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contents], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Shell({ children }: { children: ComponentChildren }) {
  return <div class="shell">{children}</div>;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A toast that clears itself; the latest message wins. */
export function flasher(setNote: (f: (n: string | null) => string | null) => void) {
  return (msg: string) => {
    setNote(() => msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 3000);
  };
}
