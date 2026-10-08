import { KIND } from './world.ts';
import type { World, Kind } from './world.ts';

// Uniform grid, rebuilt every tick by counting sort (no allocation). The sort touches only the occupied cells, so a
// rebuild costs O(entities), not O(arena cells): a 3000 x 2000 arena has about 6000 cells and a few hundred enemies.
export class Grid {
  cs: number;
  cols: number;
  rows: number;
  begin: Int32Array; // first slot of a cell in `items`; valid only where count > 0
  count: Int32Array; // entities in a cell (0 for every cell not in `occupied`)
  cursor: Int32Array;
  occupied: Int32Array; // the cells with count > 0 after the last rebuild
  nOccupied: number;
  items: Uint32Array;
  cell: Int32Array;
  out: Uint32Array;
  maxRadius: number;

  constructor(width: number, height: number, cellSize: number, capacity: number) {
    this.cs = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const cells = this.cols * this.rows;
    this.begin = new Int32Array(cells);
    this.count = new Int32Array(cells);
    this.cursor = new Int32Array(cells);
    this.occupied = new Int32Array(Math.min(cells, capacity));
    this.nOccupied = 0;
    this.items = new Uint32Array(capacity);
    this.cell = new Int32Array(capacity);
    this.out = new Uint32Array(capacity);
    this.maxRadius = 0; // largest radius among the entities of the last rebuild
  }

  _col(x: number): number {
    const c = Math.floor(x / this.cs);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  _row(y: number): number {
    const r = Math.floor(y / this.cs);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  rebuild(world: World, wantKind: Kind): void {
    const { begin, count, cursor, occupied, items, cell, cols } = this;
    for (let k = 0; k < this.nOccupied; k++) count[occupied[k]] = 0;
    let nOcc = 0;
    let maxR = 0;
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== wantKind) continue;
      const c = this._row(world.y[i]) * cols + this._col(world.x[i]);
      cell[i] = c;
      if (count[c]++ === 0) occupied[nOcc++] = c;
      if (world.radius[i] > maxR) maxR = world.radius[i];
    }
    this.maxRadius = maxR;
    this.nOccupied = nOcc;
    let sum = 0;
    for (let k = 0; k < nOcc; k++) {
      const c = occupied[k];
      begin[c] = cursor[c] = sum;
      sum += count[c];
    }
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] === wantKind) items[cursor[cell[i]]++] = i;
    }
  }

  // Fills this.out with candidate indices; returns the count. Valid until the next gather().
  gather(x: number, y: number, r: number): number {
    const c0 = this._col(x - r);
    const c1 = this._col(x + r);
    const r0 = this._row(y - r);
    const r1 = this._row(y + r);
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const c = row * this.cols + col;
        const m = this.count[c];
        if (m === 0) continue;
        for (let k = this.begin[c], e = k + m; k < e; k++) this.out[n++] = this.items[k];
      }
    }
    return n;
  }

  nearest(world: World, x: number, y: number, maxR: number): number {
    const n = this.gather(x, y, maxR);
    let best = -1;
    let bestD = maxR * maxR;
    for (let k = 0; k < n; k++) {
      const i = this.out[k];
      if (world.kind[i] !== KIND.ENEMY) continue; // the grid is built at the start of the tick; slots despawned since are skipped
      const dx = world.x[i] - x;
      const dy = world.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
