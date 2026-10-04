export const KIND = { NONE: 0, ENEMY: 1, PROJECTILE: 2, ENEMY_PROJECTILE: 3, GEM: 4 } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export class World {
  capacity: number;
  // Assigned in the constructor loop below.
  x!: Float32Array;
  y!: Float32Array;
  vx!: Float32Array;
  vy!: Float32Array;
  radius!: Float32Array;
  hp!: Float32Array;
  damage!: Float32Array;
  life!: Float32Array;
  cd!: Float32Array;
  slowT!: Float32Array;
  burnT!: Float32Array;
  type: Uint8Array;
  pierce: Uint8Array;
  bounce: Uint8Array;
  lastHit: Int32Array;
  lastHitGen: Uint16Array;
  gen: Uint16Array;
  kind: Uint8Array;
  free: Uint32Array;
  freeCount: number;
  high: number;
  dropped: number;
  kindCount: Uint32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    for (const f of ['x', 'y', 'vx', 'vy', 'radius', 'hp', 'damage', 'life', 'cd', 'slowT', 'burnT'] as const) {
      this[f] = new Float32Array(capacity);
    }
    this.type = new Uint8Array(capacity);
    this.pierce = new Uint8Array(capacity);
    this.bounce = new Uint8Array(capacity);
    this.lastHit = new Int32Array(capacity);
    this.lastHitGen = new Uint16Array(capacity); // gen[lastHit] when it was hit; a recycled slot has a newer gen
    this.gen = new Uint16Array(capacity); // bumped on despawn
    this.kind = new Uint8Array(capacity); // 0 = free slot
    this.free = new Uint32Array(capacity);
    for (let k = 0; k < capacity; k++) this.free[k] = capacity - 1 - k;
    this.freeCount = capacity;
    this.high = 0; // one past the highest slot ever used; iterate 0..high
    this.dropped = 0;
    this.kindCount = new Uint32Array(Object.keys(KIND).length);
  }

  get count(): number {
    return this.capacity - this.freeCount;
  }

  spawn(
    kind: Kind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    hp: number,
  ): number {
    if (this.freeCount === 0) {
      this.dropped++;
      return -1;
    }
    const i = this.free[--this.freeCount];
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.radius[i] = radius;
    this.hp[i] = hp;
    this.damage[i] = 0;
    this.life[i] = 0;
    this.cd[i] = 0;
    this.type[i] = 0;
    this.pierce[i] = 0;
    this.bounce[i] = 0;
    this.lastHit[i] = -1;
    this.lastHitGen[i] = 0;
    this.slowT[i] = 0;
    this.burnT[i] = 0;
    if (i >= this.high) this.high = i + 1;
    this.kindCount[kind]++;
    return i;
  }

  despawn(i: number): void {
    this.gen[i]++;
    this.kindCount[this.kind[i]]--;
    this.kind[i] = KIND.NONE;
    this.free[this.freeCount++] = i;
  }

  clearKind(kind: Kind): void {
    for (let i = 0; i < this.high; i++) if (this.kind[i] === kind) this.despawn(i);
  }
}
