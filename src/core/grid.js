// Uniform grid, rebuilt every tick by counting sort (no allocation).
export class Grid {
  constructor(width, height, cellSize, capacity) {
    this.cs = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const cells = this.cols * this.rows;
    this.start = new Int32Array(cells + 1);
    this.cursor = new Int32Array(cells);
    this.items = new Uint32Array(capacity);
    this.cell = new Int32Array(capacity);
    this.out = new Uint32Array(capacity);
  }

  _col(x) {
    const c = Math.floor(x / this.cs);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  _row(y) {
    const r = Math.floor(y / this.cs);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  rebuild(world, wantKind) {
    const { start, cursor, items, cell, cols } = this;
    start.fill(0);
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== wantKind) continue;
      const c = this._row(world.y[i]) * cols + this._col(world.x[i]);
      cell[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cursor.length; c++) start[c + 1] += start[c];
    cursor.set(start.subarray(0, cursor.length));
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] === wantKind) items[cursor[cell[i]]++] = i;
    }
  }

  // Fills this.out with candidate indices; returns the count. Valid until the next gather().
  gather(x, y, r) {
    const c0 = this._col(x - r);
    const c1 = this._col(x + r);
    const r0 = this._row(y - r);
    const r1 = this._row(y + r);
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const c = row * this.cols + col;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) this.out[n++] = this.items[k];
      }
    }
    return n;
  }

  nearest(world, x, y, maxR) {
    const n = this.gather(x, y, maxR);
    let best = -1;
    let bestD = maxR * maxR;
    for (let k = 0; k < n; k++) {
      const i = this.out[k];
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
