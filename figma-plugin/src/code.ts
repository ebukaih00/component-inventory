/** Builds the inventory board from the extension's JSON export. */
import { isInventoryExport } from '../../src/detect/export';
import { buildBoard, type BoardItem, type BoardRow, type BoardSection } from './board';
import { color, radius, space, text, THUMB_HEIGHT } from './tokens';

const COLUMN_WIDTH = 560;
const BUCKET_COLOR = { common: color.common, couldBeOne: color.couldBeOne, oneOff: color.oneOff };
const BUCKET_SOFT = { common: color.commonSoft, couldBeOne: color.couldBeOneSoft, oneOff: color.oneOffSoft };

figma.showUI(__html__, { width: 360, height: 320, themeColors: true });

type RGB = { r: number; g: number; b: number };
const solid = (c: RGB): SolidPaint => ({ type: 'SOLID', color: c });

function stack(name: string, dir: 'VERTICAL' | 'HORIZONTAL', gap: number, pad = 0, fill?: RGB): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.itemSpacing = gap;
  f.paddingTop = f.paddingBottom = f.paddingLeft = f.paddingRight = pad;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.fills = fill ? [solid(fill)] : [];
  return f;
}

function label(chars: string, size: number, medium = false, fill: RGB = color.grey7): TextNode {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: medium ? 'Medium' : 'Regular' };
  t.fontSize = size;
  t.characters = chars;
  t.fills = [solid(fill)];
  return t;
}

function fillWidth(parent: FrameNode, child: SceneNode) {
  parent.appendChild(child);
  if ('layoutSizingHorizontal' in child) child.layoutSizingHorizontal = 'FILL';
  if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT';
}

async function thumbnail(dataUrl: string): Promise<SceneNode | null> {
  const b64 = dataUrl.split(',')[1];
  if (!b64) return null;
  try {
    const image = figma.createImage(figma.base64Decode(b64));
    const { width, height } = await image.getSizeAsync();
    const h = THUMB_HEIGHT - 2 * space.s1;
    const w = Math.min(240, Math.max(8, (width / height) * h));
    const tile = stack('Thumbnail', 'HORIZONTAL', 0, space.s1, color.grey1);
    tile.cornerRadius = radius.tile;
    tile.strokes = [solid(color.grey3)];
    tile.strokeWeight = 1;
    const rect = figma.createRectangle();
    rect.resize(w, h);
    rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' }];
    tile.appendChild(rect);
    return tile;
  } catch {
    return null;
  }
}

async function rowNode(r: BoardRow): Promise<FrameNode> {
  const row = stack(r.name, 'HORIZONTAL', space.s3, space.s2);
  row.counterAxisAlignItems = 'CENTER';
  const thumbs = stack('Thumbnails', 'HORIZONTAL', space.s1);
  for (const t of r.thumbnails) {
    const n = await thumbnail(t);
    if (n) thumbs.appendChild(n);
  }
  if (thumbs.children.length) row.appendChild(thumbs);
  else thumbs.remove();
  const textCol = stack('Text', 'VERTICAL', 2);
  fillWidth(row, textCol);
  fillWidth(textCol, label(r.name, text.s13, true));
  fillWidth(textCol, label(r.meta, text.s11, false, color.grey5));
  if (r.note) fillWidth(textCol, label(r.note, text.s11, false, color.grey6));
  fillWidth(textCol, label(r.style, text.s11, false, color.grey5));
  return row;
}

async function itemNode(item: BoardItem, bucket: BoardSection['bucket']): Promise<FrameNode> {
  const box = stack(item.caption ?? item.rows[0]?.name ?? 'Item', 'VERTICAL', space.s1, item.caption ? space.s2 : 0);
  if (item.caption) {
    box.strokes = [solid(color.grey3)];
    box.strokeWeight = 1;
    box.cornerRadius = radius.tile;
    fillWidth(box, label(item.caption, text.s12, false, color.grey6));
  }
  if (item.chips.length) {
    const chips = stack('Differences', 'HORIZONTAL', space.s1);
    chips.layoutWrap = 'WRAP';
    chips.counterAxisSpacing = space.s1;
    for (const c of item.chips) {
      const chip = stack(c, 'HORIZONTAL', 0, 0, BUCKET_SOFT[bucket]);
      chip.paddingLeft = chip.paddingRight = space.s1;
      chip.paddingTop = chip.paddingBottom = 1;
      chip.cornerRadius = radius.control;
      chip.appendChild(label(c, text.s11));
      chips.appendChild(chip);
    }
    fillWidth(box, chips);
  }
  for (const r of item.rows) fillWidth(box, await rowNode(r));
  return box;
}

async function sectionNode(s: BoardSection, x: number, y: number): Promise<SectionNode> {
  const col = stack(s.title, 'VERTICAL', space.s3, space.s6, color.grey0);
  col.resize(COLUMN_WIDTH, col.height);
  col.primaryAxisSizingMode = 'AUTO';
  col.counterAxisSizingMode = 'FIXED';

  const head = stack('Header', 'HORIZONTAL', space.s2);
  head.counterAxisAlignItems = 'CENTER';
  const dot = figma.createEllipse();
  dot.resize(8, 8);
  dot.fills = [solid(BUCKET_COLOR[s.bucket])];
  head.appendChild(dot);
  head.appendChild(label(s.title, text.s15, true));
  head.appendChild(label(String(s.count), text.s13, true, BUCKET_COLOR[s.bucket]));
  fillWidth(col, head);
  fillWidth(col, label(s.hint, text.s12, false, color.grey6));

  if (s.kinds.length === 0) fillWidth(col, label('Nothing here.', text.s12, false, color.grey5));
  for (const k of s.kinds) {
    const kindHead = label(k.label, text.s13, true, color.grey6);
    fillWidth(col, kindHead);
    for (const item of k.items) fillWidth(col, await itemNode(item, s.bucket));
  }

  const section = figma.createSection();
  section.name = `${s.title} · ${s.count}`;
  section.x = x;
  section.y = y;
  section.appendChild(col);
  col.x = space.s6;
  col.y = space.s6 * 2;
  section.resizeWithoutConstraints(col.width + space.s6 * 2, col.height + space.s6 * 3);
  return section;
}

async function build(json: string) {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That is not valid JSON. Paste the export from the Component Inventory side panel.');
  }
  if (!isInventoryExport(data)) throw new Error('This JSON is not a Component Inventory export (schema component-inventory/1).');

  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);
  const board = buildBoard(data);
  const origin = figma.viewport.center;
  const x0 = Math.round(origin.x);
  const y0 = Math.round(origin.y);

  const title = stack('Title', 'VERTICAL', space.s1);
  title.appendChild(label(board.title, 24, true));
  title.appendChild(label(board.subtitle, text.s13, false, color.grey6));
  title.x = x0;
  title.y = y0;

  const nodes: SceneNode[] = [title];
  let x = x0;
  for (const s of board.sections) {
    const node = await sectionNode(s, x, y0 + title.height + space.s6 * 2);
    nodes.push(node);
    x += node.width + space.s6 * 2;
  }
  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  return board.sections.reduce((n, s) => n + s.count, 0);
}

figma.ui.onmessage = async (msg: { type: 'build'; json: string } | { type: 'close' }) => {
  if (msg.type === 'close') return figma.closePlugin();
  try {
    const n = await build(msg.json);
    figma.notify(`Board built: ${n} rows across 3 buckets`);
    figma.ui.postMessage({ type: 'done' });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
