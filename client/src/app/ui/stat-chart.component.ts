import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/** One measure drawn in a chart, with its fixed color (validated for the dark admin surface: gold, blue, pink). */
export interface ChartSeries { key: string; label: string; color: string }
export interface ChartRow { label: string; values: Partial<Record<string, number>> }

/** The admin charts' categorical colors, always in this order (validated: lightness band, CVD and contrast on #111a38). */
export const CHART_COLORS = ['#ad8a3c', '#5a8ee0', '#c9659a'] as const;

/** A clean upper bound for the axis and its four steps. */
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  return Math.max(4, step * 4);
}

/**
 * A plain column chart for the admin statistics (no chart library): grouped columns per row, one baseline, a hairline
 * grid, a legend for two or more measures, a tooltip per group and a table view. `horizontal` draws bars instead, for
 * comparisons with long names (games, personal links).
 */
@Component({
  selector: 'px-stat-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart">
      <figcaption>
        <b>{{ title() }}</b>
        @if (subtitle()) { <small>{{ subtitle() }}</small> }
      </figcaption>
      @if (series().length > 1) {
        <ul class="legend" aria-label="מקרא">
          @for (s of series(); track s.key) { <li><i [style.background]="s.color"></i>{{ s.label }}</li> }
        </ul>
      }
      @if (!rows().length || empty()) {
        <p class="none">אין נתונים בטווח הזה.</p>
      } @else if (horizontal()) {
        <div class="hbars" role="img" [attr.aria-label]="title()">
          @for (r of rows(); track r.label) {
            <div class="hrow" (mouseenter)="hover.set($index)" (mouseleave)="hover.set(null)" [class.on]="hover() === $index">
              <span class="hname" [title]="r.label">{{ r.label }}</span>
              <div class="hgroup">
                @for (s of series(); track s.key) {
                  <div class="hline">
                    <i class="hbar" [style.width.%]="pct(r.values[s.key])" [style.background]="s.color"></i>
                    <span class="hval">{{ fmt()(r.values[s.key] ?? 0) }}</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="plot" dir="ltr" role="img" [attr.aria-label]="title()">
          <div class="yaxis">
            @for (t of ticks(); track t) { <span [style.bottom.%]="(t / max()) * 100">{{ fmt()(t) }}</span> }
          </div>
          <div class="area">
            @for (t of ticks(); track t) { <i class="grid" [style.bottom.%]="(t / max()) * 100"></i> }
            <div class="cols">
              @for (r of rows(); track r.label) {
                <div class="group" (mouseenter)="hover.set($index)" (mouseleave)="hover.set(null)" (focus)="hover.set($index)" (blur)="hover.set(null)"
                  tabindex="0" [attr.aria-label]="r.label + ': ' + describe(r)">
                  <div class="bars">
                    @for (s of series(); track s.key) {
                      <i class="col" [style.height.%]="pct(r.values[s.key])" [style.background]="s.color"></i>
                    }
                  </div>
                  @if (hover() === $index) {
                    <div class="tip" [class.left]="$index > rows().length / 2" dir="rtl">
                      <b>{{ r.label }}</b>
                      @for (s of series(); track s.key) { <span><i [style.background]="s.color"></i>{{ s.label }}: {{ fmt()(r.values[s.key] ?? 0) }}</span> }
                    </div>
                  }
                </div>
              }
            </div>
            <div class="xaxis">
              @for (r of rows(); track r.label) { <span [class.skip]="!showLabel($index)">{{ r.label }}</span> }
            </div>
          </div>
        </div>
      }
      @if (rows().length && !empty()) {
        <details class="table">
          <summary>הצגה כטבלה</summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>{{ rowHeader() }}</th>@for (s of series(); track s.key) { <th>{{ s.label }}</th> }</tr></thead>
              <tbody>
                @for (r of rows(); track r.label) {
                  <tr><td>{{ r.label }}</td>@for (s of series(); track s.key) { <td>{{ fmt()(r.values[s.key] ?? 0) }}</td> }</tr>
                }
              </tbody>
            </table>
          </div>
        </details>
      }
    </figure>
  `,
  styles: [`
    :host { display:block; }
    .chart { margin:0; padding:1rem; background:var(--panel-solid); border:1px solid var(--line); border-radius:var(--radius); }
    figcaption { display:flex; flex-direction:column; gap:.15rem; margin-bottom:.6rem; }
    figcaption b { color:var(--text); font-size:1rem; } figcaption small { color:var(--muted); font-size:.8rem; }
    .legend { list-style:none; display:flex; flex-wrap:wrap; gap:.3rem 1rem; margin:0 0 .6rem; padding:0; font-size:.82rem; color:var(--muted); }
    .legend li { display:flex; align-items:center; gap:.35rem; } .legend i { width:12px; height:12px; border-radius:3px; display:inline-block; }
    .none { color:var(--muted); margin:1.5rem 0; text-align:center; }
    .plot { display:grid; grid-template-columns:auto 1fr; gap:.4rem; height:220px; }
    .yaxis { position:relative; width:3.2rem; height:calc(100% - 1.6rem); }
    .yaxis span { position:absolute; right:0; transform:translateY(50%); font-size:.72rem; color:var(--muted); white-space:nowrap; }
    .area { position:relative; display:flex; flex-direction:column; min-width:0; }
    .grid { position:absolute; left:0; right:0; height:1px; background:rgba(201,162,77,.14); }
    .cols { position:relative; flex:1; display:flex; align-items:stretch; border-bottom:1px solid rgba(201,162,77,.35); }
    .group { position:relative; flex:1 1 0; min-width:0; display:flex; align-items:flex-end; justify-content:center; outline:none; cursor:default; }
    .group:hover, .group:focus-visible { background:rgba(255,255,255,.04); }
    .bars { display:flex; align-items:flex-end; gap:2px; height:100%; width:100%; justify-content:center; padding:0 2px; box-sizing:border-box; }
    .col { display:block; flex:0 1 24px; max-width:24px; min-height:0; border-radius:4px 4px 0 0; }
    .xaxis { display:flex; height:1.6rem; }
    .xaxis span { flex:1 1 0; min-width:0; text-align:center; font-size:.7rem; color:var(--muted); white-space:nowrap; overflow:visible; padding-top:.3rem; }
    .xaxis span.skip { visibility:hidden; }
    .tip { position:absolute; bottom:calc(100% - 2.5rem); right:50%; z-index:3; transform:translateX(50%); min-width:9rem; padding:.5rem .65rem;
      background:#0a1028; border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); font-size:.8rem; display:flex; flex-direction:column; gap:.2rem; pointer-events:none; }
    .tip b { color:var(--text); } .tip span { color:var(--muted); display:flex; align-items:center; gap:.35rem; white-space:nowrap; }
    .tip i { width:10px; height:10px; border-radius:2px; display:inline-block; }
    .hbars { display:flex; flex-direction:column; gap:.55rem; }
    .hrow { display:grid; grid-template-columns:minmax(6rem, 30%) 1fr; gap:.6rem; align-items:center; padding:.2rem .3rem; border-radius:8px; }
    .hrow.on { background:rgba(255,255,255,.04); }
    .hname { font-size:.85rem; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .hgroup { display:flex; flex-direction:column; gap:2px; }
    .hline { display:flex; align-items:center; gap:.4rem; min-height:14px; }
    .hbar { display:block; height:12px; min-width:2px; border-radius:0 4px 4px 0; }
    .hval { font-size:.75rem; color:var(--muted); white-space:nowrap; }
    .table { margin-top:.6rem; font-size:.85rem; } .table summary { cursor:pointer; color:var(--muted); }
    .table-wrap { overflow-x:auto; margin-top:.4rem; }
    table { width:100%; border-collapse:collapse; } th, td { padding:.3rem .5rem; text-align:start; border-bottom:1px solid rgba(201,162,77,.15); white-space:nowrap; }
    th { color:var(--gold-2); }
  `],
})
export class StatChartComponent {
  title = input.required<string>();
  subtitle = input<string>('');
  series = input.required<ChartSeries[]>();
  rows = input.required<ChartRow[]>();
  horizontal = input(false);
  rowHeader = input('תקופה');
  fmt = input<(v: number) => string>((v) => Math.round(v).toLocaleString('he-IL'));

  hover = signal<number | null>(null);

  private top = computed(() => Math.max(0, ...this.rows().flatMap((r) => this.series().map((s) => r.values[s.key] ?? 0))));
  empty = computed(() => this.top() === 0);
  max = computed(() => (this.horizontal() ? Math.max(this.top(), 1) : niceMax(this.top())));
  ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (this.max() / 4) * i));

  pct(v: number | undefined) {
    return Math.max(0, Math.min(100, ((v ?? 0) / this.max()) * 100));
  }

  /** With many groups only some labels fit under the axis; the tooltip and the table still have every one. */
  showLabel(i: number) {
    const n = this.rows().length;
    const every = n <= 12 ? 1 : Math.ceil(n / 10);
    return i % every === 0 || i === n - 1;
  }

  describe(r: ChartRow) {
    return this.series().map((s) => `${s.label} ${this.fmt()(r.values[s.key] ?? 0)}`).join(', ');
  }
}
