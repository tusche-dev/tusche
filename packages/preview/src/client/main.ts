/// <reference lib="dom" />
// The preview page: one canvas, a status chip, a panel with the selected node.
import { decodeMessage, PreviewCanvas } from '@tusche/engine/preview';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvasEl = $<HTMLCanvasElement>('canvas');
const dot = $('dot');
const status = $('status');
const errorBox = $('error');
const empty = $('empty');
const zoomButton = $('zoom');
const info = $('info');

/** Pointer travel (px) under which a press is a click, not a drag. */
const CLICK_SLOP = 4;
const RECONNECT_MAX_MS = 5000;

const preview = await PreviewCanvas.create(canvasEl, {
  wasmUrl: '/canvaskit.wasm',
  assetUrl: (file) => `/assets/${file}`,
  fontUrl: (font) => `/fonts/${font.id}`,
}).catch((e: Error) => {
  empty.textContent = `Cannot start the canvas: ${e.message}`;
  throw e;
});

const time = () => new Date().toLocaleTimeString([], { hour12: false });

function setStatus(state: 'live' | 'error' | 'offline', text: string): void {
  dot.className = `dot ${state === 'offline' ? '' : state}`;
  status.textContent = text;
}

const showZoom = () => {
  zoomButton.textContent = `${Math.round(preview.zoom * 100)}%`;
};

// Messages are applied one after another: fonts load in between.
let applying: Promise<void> = Promise.resolve();
let retry = 250;

function connect(): void {
  const socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  );
  socket.onopen = () => {
    retry = 250;
    setStatus('live', 'live');
  };
  socket.onmessage = (event) => {
    const message = decodeMessage(String(event.data));
    applying = applying.then(async () => {
      if (message.type === 'error') {
        errorBox.textContent = message.message;
        errorBox.hidden = false;
        setStatus('error', `error · ${time()}`);
        if (preview.scene.roots.length === 0) empty.textContent = 'Nothing to show yet';
        return;
      }
      await preview.apply(message);
      errorBox.hidden = true;
      empty.hidden = preview.scene.roots.length > 0;
      empty.textContent = 'The document is empty';
      setStatus('live', `updated ${time()}`);
      showZoom();
      showInfo();
    });
  };
  socket.onclose = () => {
    setStatus('offline', 'disconnected, retrying…');
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, RECONNECT_MAX_MS);
  };
}

function showInfo(): void {
  const id = preview.selection;
  const node = id === null ? undefined : preview.info(id);
  info.hidden = node === undefined;
  if (!node) return;
  $('info-id').textContent = node.id;
  $('info-name').textContent = `${node.name} · ${node.type.toLowerCase()}`;
  const { x, y, width, height } = node.bounds;
  $('info-size').textContent = `${round(width)}×${round(height)} at ${round(x)}, ${round(y)}`;
  const path = $('info-path');
  path.replaceChildren();
  for (const ancestor of node.ancestors) {
    const button = document.createElement('button');
    button.textContent = ancestor.name || ancestor.id;
    button.title = ancestor.id;
    button.onclick = () => select(ancestor.id);
    if (path.childElementCount > 0) path.append('›');
    path.append(button);
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

function select(id: string | null): void {
  preview.select(id);
  showInfo();
}

// Pointer: drag pans, a click selects, hovering outlines.
let drag: { x: number; y: number; moved: boolean; id: number } | undefined;

const local = (e: MouseEvent) => {
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  canvasEl.setPointerCapture(e.pointerId);
});

canvasEl.addEventListener('pointermove', (e) => {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      canvasEl.classList.add('grabbing');
      preview.hover(null);
    }
    preview.panBy(dx, dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  const p = local(e);
  preview.hover(preview.nodeAt(p.x, p.y));
});

canvasEl.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const clicked = !drag.moved && e.button === 0;
  drag = undefined;
  canvasEl.classList.remove('grabbing');
  if (clicked) {
    const p = local(e);
    select(preview.nodeAt(p.x, p.y));
  }
});

canvasEl.addEventListener('pointerleave', () => {
  if (!drag) preview.hover(null);
});

canvasEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = local(e);
    // Pinch on a trackpad arrives as a wheel event with Ctrl.
    if (e.ctrlKey || e.metaKey) {
      preview.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)));
      showZoom();
    } else {
      const scale = e.deltaMode === 1 ? 16 : 1;
      preview.panBy(-e.deltaX * scale, -e.deltaY * scale);
    }
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') select(null);
  else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) fit();
  else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-')) {
    e.preventDefault();
    const { width, height } = canvasEl.getBoundingClientRect();
    preview.zoomAt(width / 2, height / 2, e.key === '-' ? 1 / 1.25 : 1.25);
    showZoom();
  }
});

function fit(): void {
  preview.fit();
  showZoom();
}

$('fit').onclick = fit;
zoomButton.onclick = () => {
  const { width, height } = canvasEl.getBoundingClientRect();
  preview.zoomAt(width / 2, height / 2, 1 / preview.zoom);
  showZoom();
};
$('copy').onclick = () => {
  const id = preview.selection;
  if (id !== null) void navigator.clipboard?.writeText(id);
};

new ResizeObserver(() => preview.resize()).observe(canvasEl);
connect();
