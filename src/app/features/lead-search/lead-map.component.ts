import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

export interface MapPoint {
  id: string;
  n: number;
  name: string;
  lat: number;
  lng: number;
  tone: 'added' | 'match' | 'noweb' | 'default';
}

const TILE = 256;
const MAX_ZOOM = 16;
const MIN_ZOOM = 3;

function worldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** zoom;
}

function worldY(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE * 2 ** zoom;
}

/**
 * Results on a Google map (ADR 0013). The map image comes through the
 * Leadzaro server so the Google key is never exposed; numbered markers are
 * drawn here so they can be hovered and clicked. When the map image isn't
 * available the markers still show on a plain grid, with the reason.
 */
@Component({
  selector: 'app-lead-map',
  standalone: true,
  template: `
    <div class="map" [style.aspect-ratio]="width + ' / ' + height" [class.plain]="!imageUrl()">
      @if (imageUrl(); as url) { <img [src]="url" alt="Map of the search results" draggable="false" /> }
      @if (radius(); as r) {
        <span class="radius" [style.width.%]="r.w" [style.height.%]="r.h" [style.left.%]="r.x" [style.top.%]="r.y"></span>
      }
      @for (p of placed(); track p.id) {
        <button type="button" class="pin" [attr.data-tone]="p.tone" [class.active]="p.id === selectedId()"
          [style.left.%]="p.x" [style.top.%]="p.y" (click)="pick.emit(p.id)" [title]="p.n + '. ' + p.name" [attr.aria-label]="'Result ' + p.n + ': ' + p.name">{{ p.n }}</button>
      }
      @if (loading()) { <span class="map-note">Loading map…</span> }
    </div>
    <div class="map-foot">
      <span class="legend"><i data-tone="default"></i>Result <i data-tone="noweb"></i>No website <i data-tone="match"></i>Possible match <i data-tone="added"></i>In Leads</span>
      @if (error()) { <span class="text-xs warn">{{ error() }}</span> }
      @if (searchUrl()) { <a class="text-xs" [href]="searchUrl()" target="_blank" rel="noopener">Open this search in Google Maps ↗</a> }
    </div>
  `,
  styles: [`
    .map { position: relative; width: 100%; overflow: hidden; border-radius: var(--radius-lg); background: #E8EEF4; border: 1px solid var(--border); user-select: none;
      img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      &.plain { background-image: linear-gradient(var(--border-light) 1px, transparent 1px), linear-gradient(90deg, var(--border-light) 1px, transparent 1px); background-size: 40px 40px; } }
    .radius { position: absolute; transform: translate(-50%, -50%); border: 2px dashed rgba(79, 70, 229, .55); border-radius: 50%; background: rgba(79, 70, 229, .06); pointer-events: none; }
    .pin { position: absolute; transform: translate(-50%, -100%); min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px 12px 12px 2px;
      border: 2px solid #fff; background: var(--primary); color: #fff; font-size: .7rem; font-weight: 700; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.35);
      transition: transform var(--transition);
      &[data-tone='noweb'] { background: #DC2626; } &[data-tone='match'] { background: #D97706; } &[data-tone='added'] { background: #059669; }
      &:hover, &.active { transform: translate(-50%, -100%) scale(1.25); z-index: 2; }
      &.active { outline: 3px solid rgba(79, 70, 229, .45); }
      &:focus-visible { outline: 3px solid var(--primary-light); } }
    .map-note { position: absolute; left: 10px; bottom: 10px; background: rgba(255,255,255,.9); padding: 3px 8px; border-radius: var(--radius); font-size: .75rem; }
    .map-foot { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
    .legend { display: inline-flex; gap: 10px; align-items: center; font-size: .72rem; color: var(--text-muted);
      i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: -6px; background: var(--primary); }
      i[data-tone='noweb'] { background: #DC2626; } i[data-tone='match'] { background: #D97706; } i[data-tone='added'] { background: #059669; } }
    .warn { color: var(--warning-text); }
  `],
})
export class LeadMapComponent {
  private readonly http = inject(HttpClient);

  readonly points = input<MapPoint[]>([]);
  readonly center = input<{ lat: number; lng: number } | null>(null);
  readonly radiusMiles = input<number | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly searchQuery = input('');
  readonly pick = output<string>();

  readonly width = 640;
  readonly height = 320;
  readonly imageUrl = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private objectUrl: string | null = null;

  /** Center and zoom that fit every result (and the search center). */
  readonly view = computed(() => {
    const pts = this.points();
    const c = this.center();
    const lats = [...pts.map((p) => p.lat), ...(c ? [c.lat] : [])];
    const lngs = [...pts.map((p) => p.lng), ...(c ? [c.lng] : [])];
    if (!lats.length) return null;
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
    const lat = (minLat + maxLat) / 2;
    const lng = (minLng + maxLng) / 2;
    let zoom = MAX_ZOOM;
    while (zoom > MIN_ZOOM) {
      const w = worldX(maxLng, zoom) - worldX(minLng, zoom);
      const h = worldY(minLat, zoom) - worldY(maxLat, zoom);
      if (w <= this.width * 0.85 && h <= this.height * 0.8) break;
      zoom -= 1;
    }
    return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), zoom };
  });

  /** Marker positions as % of the map box. */
  readonly placed = computed(() => {
    const v = this.view();
    if (!v) return [];
    const cx = worldX(v.lng, v.zoom);
    const cy = worldY(v.lat, v.zoom);
    return this.points().map((p) => ({
      ...p,
      x: ((worldX(p.lng, v.zoom) - cx + this.width / 2) / this.width) * 100,
      y: ((worldY(p.lat, v.zoom) - cy + this.height / 2) / this.height) * 100,
    }));
  });

  /** The searched area as a circle around the search center (% of the map box). */
  readonly radius = computed(() => {
    const v = this.view();
    const c = this.center();
    const miles = this.radiusMiles();
    if (!v || !c || !miles) return null;
    const metersPerPx = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** v.zoom;
    const px = (miles * 1609.34) / metersPerPx;
    if (px < 12 || px > this.width * 3) return null;
    return {
      x: ((worldX(c.lng, v.zoom) - worldX(v.lng, v.zoom) + this.width / 2) / this.width) * 100,
      y: ((worldY(c.lat, v.zoom) - worldY(v.lat, v.zoom) + this.height / 2) / this.height) * 100,
      w: ((px * 2) / this.width) * 100,
      h: ((px * 2) / this.height) * 100,
    };
  });

  readonly searchUrl = computed(() => (this.searchQuery() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.searchQuery())}` : ''));

  constructor() {
    effect(() => {
      const v = this.view();
      if (v) this.loadImage(v);
    });
    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  private loadImage(v: { lat: number; lng: number; zoom: number }): void {
    this.loading.set(true);
    this.error.set('');
    const params = new HttpParams().set('lat', v.lat).set('lng', v.lng).set('zoom', v.zoom).set('w', this.width).set('h', this.height);
    this.http.get('/api/leads/map', { params, responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.revoke();
        this.objectUrl = URL.createObjectURL(blob);
        this.imageUrl.set(this.objectUrl);
        this.loading.set(false);
      },
      error: (err) => {
        this.revoke();
        this.imageUrl.set(null);
        this.loading.set(false);
        // Error bodies arrive as blobs here; read the message when there is one.
        const body = err?.error;
        if (body instanceof Blob) {
          body.text().then((text) => {
            try { this.error.set(JSON.parse(text).message || 'The map couldn’t be loaded.'); } catch { this.error.set('The map couldn’t be loaded.'); }
          });
        } else this.error.set('The map couldn’t be loaded.');
      },
    });
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
