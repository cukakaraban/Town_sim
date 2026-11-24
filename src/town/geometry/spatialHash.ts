import { Vec2 } from '../model/types';

export interface SpatialEntry<T> {
  pos: Vec2;
  item: T;
}

export class SpatialHash<T> {
  readonly cellSize: number;
  private cells = new Map<string, SpatialEntry<T>[]>();

  constructor(cellSize: number) {
    this.cellSize = Math.max(1e-3, cellSize);
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  insertPoint(pos: Vec2, item: T): void {
    const [cx, cy] = this.cellCoords(pos.x, pos.y);
    const k = this.key(cx, cy);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push({ pos, item });
  }

  insertBounds(minX: number, minY: number, maxX: number, maxY: number, pos: Vec2, item: T): void {
    const [cx0, cy0] = this.cellCoords(minX, minY);
    const [cx1, cy1] = this.cellCoords(maxX, maxY);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push({ pos, item });
      }
    }
  }

  queryRadius(pos: Vec2, radius: number): SpatialEntry<T>[] {
    const rSq = radius * radius;
    const [cx0, cy0] = this.cellCoords(pos.x - radius, pos.y - radius);
    const [cx1, cy1] = this.cellCoords(pos.x + radius, pos.y + radius);
    const results: SpatialEntry<T>[] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const dx = e.pos.x - pos.x;
          const dy = e.pos.y - pos.y;
          if (dx * dx + dy * dy <= rSq) {
            results.push(e);
          }
        }
      }
    }
    return results;
  }

  hasWithin(pos: Vec2, radius: number, predicate?: (item: T, pos: Vec2) => boolean): boolean {
    const rSq = radius * radius;
    const [cx0, cy0] = this.cellCoords(pos.x - radius, pos.y - radius);
    const [cx1, cy1] = this.cellCoords(pos.x + radius, pos.y + radius);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const dx = e.pos.x - pos.x;
          const dy = e.pos.y - pos.y;
          if (dx * dx + dy * dy <= rSq) {
            if (!predicate || predicate(e.item, e.pos)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  queryBounds(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const [cx0, cy0] = this.cellCoords(minX, minY);
    const [cx1, cy1] = this.cellCoords(maxX, maxY);
    const seen = new Set<T>();
    const results: T[] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i].item;
          if (!seen.has(item)) {
            seen.add(item);
            results.push(item);
          }
        }
      }
    }
    return results;
  }

  clear(): void {
    this.cells.clear();
  }
}
