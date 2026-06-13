# CPJ Igloo Rendering

Technical reference for how Club Penguin Journey renders igloo scenes. This documents the asset pipeline, coordinate system, compositing layer order, and data structures needed to reproduce igloo rendering outside the game client.

## Asset Sources

| Asset | URL Pattern | Format |
|-------|-------------|--------|
| Building atlas | `cdn.cpjourney.net/assets/media/igloos/buildings/sprites/{key}/{key}.json` | TexturePacker multiatlas |
| Building sheets | `cdn.cpjourney.net/assets/media/igloos/buildings/sprites/{key}/{key}-{n}.webp` | WebP spritesheet |
| Flooring atlas | `cdn.cpjourney.net/assets/media/igloos/flooring/sprites/{id}.json` | TexturePacker multiatlas |
| Flooring sheets | `cdn.cpjourney.net/assets/media/igloos/flooring/sprites/{id}-{n}.webp` | WebP spritesheet |
| Location background | `cdn.cpjourney.net/assets/media/igloos/locations/sprites/{id}.png` | PNG |
| Furniture atlas | `play.cpjourney.net/assets/media/furniture/sprites/{id}.json` | TexturePacker multiatlas |
| Furniture sheets | `play.cpjourney.net/assets/media/furniture/sprites/{id}-{n}.webp` | WebP spritesheet |
| Crumbs (metadata) | `cdn.cpjourney.net/assets/media/crumbs/en/crumbs.json` | JSON |

### Crumbs Lookups

- `crumbs.igloos[type]` -> `{ key, name, path, x, y, cost }` — `key` is used for building atlas path (lowercased)
- `crumbs.furniture[id]` -> `{ name, type, sort, cost, member, max, fps? }` — `type: 1` = floor item, `type: 2` = wall item
- `crumbs.flooring[id]` -> `{ name, cost }`
- `crumbs.locations[id]` -> `{ name, cost }`

## Coordinate System

The igloo canvas is always **1520x960** pixels (set as `borderWidth`/`borderHeight` in each Phaser scene).

All positions use **Phaser's origin-based coordinate system**: an image placed at `(x, y)` with origin `(originX, originY)` has its top-left corner at:

```
topLeft.x = x - width * originX
topLeft.y = y - height * originY
```

Default origin is `(0.5, 0.5)` (center). When a frame has `spriteSourceSize` trimming, the actual pixel data is at:

```
topLeft.x = x - sourceW * originX + offsetX
topLeft.y = y - sourceH * originY + offsetY
```

Where `sourceW`/`sourceH` is the untrimmed frame size and `offsetX`/`offsetY` is the trim offset from `spriteSourceSize`.

## Compositing Layer Order

Phaser assigns explicit depth values. From back to front:

| Depth | Layer | Description |
|-------|-------|-------------|
| -4 | Location background | Exterior scenery PNG, resized to fill canvas |
| -2 | Floor layer | Building floor frame(s) — `this.floor` in Phaser scene |
| -1 | Flooring overlay | Flooring texture, masked to igloo floor shape |
| 0 | Building structure | Walls, doors, windows, chimneys — no explicit depth set |
| y | Furniture | Each item at `depth = y`, sorted ascending |
| y | Foreground | Building frames in `this.sort` array (e.g., `fg` in Apartment) |

### Floor Layer

The floor layer is a Phaser `Layer` (or single `Image`) assigned to `this.floor`, then reassigned to `depth = -2`. For multi-part floors (Gym, LogCabin), all sub-images are inside this Layer.

### Flooring Overlay

Placed at world coordinates `(0, 0)` with origin `(0.5, 0.5)`. The flooring atlas uses a **4500x2500 virtual canvas** (`sourceSize`) for most variants, with the actual floor texture trimmed to a smaller region at a large offset. Special cases:

- `floorFrame 17`: `sourceSize = 1520x960` (matches canvas directly, used for NoBoundary type)
- Igloo type `0x41` (65, MagicalHideout): flooring is skipped entirely
- Igloo type `0x70` (112, HolidayEstate): flooring placed at `(-120, 0)` instead of `(0, 0)`
- `floorFrame 0x18` (24): flooring placed at `(480, 240)` instead of `(0, 0)`

For server-side rendering without Phaser's physics mask, the flooring position on the canvas is:

```
canvasLeft = -sourceW/2 + offsetX
canvasTop  = -sourceH/2 + offsetY
```

### Foreground Items

Some building frames render **on top of furniture** because they're in the scene's `this.sort` array, which y-sorts them alongside furniture sprites. The `fg` frame in Apartment is the primary example — it's the room's foreground arch that overlaps furniture.

## Floor Frame Mapping

Each igloo type has a specific `floorFrame` number that selects which flooring shape variant to use. The flooring atlas frame name format is `{floorFrame}_1` (e.g., `12_1` for Restaurant).

This mapping is defined in each igloo scene's constructor (e.g., `this.floorFrame = 12`). See `FLOOR_FRAME_MAP` in `scripts/igloo-layouts.ts` for the complete mapping.

## Scene Layout Data

Each igloo type defines its building frame positions in a Phaser Editor 2D `.scene` file (JSON format for Yukon types) or compiled webpack chunk (for CPJ-only types).

### Yukon Source (Open Source)

Repository: `github.com/wizguin/yukon`

Scene files: `src/scenes/igloos/{dir}/{Name}.scene` — Phaser Editor 2D JSON with `displayList` array containing position/origin/texture data.

JS files: `src/scenes/igloos/{dir}/{Name}.js` — contains `floorFrame`, `floorSpawn`, `wallSpawn`, `wallBounds` properties.

### CPJ-Only Types

Types not in Yukon (Restaurant, TwoStory, Apartment, etc.) have scene code in lazy-loaded webpack chunks. These are obfuscated but the texture key and frame names remain as literal strings. Positions are extractable via regex pattern matching.

### Regenerating Layout Data

```bash
npx tsx scripts/generate-igloo-layouts.ts
```

This fetches Yukon `.scene` files from GitHub and CPJ webpack chunks, parses them, and outputs `scripts/igloo-layouts.ts` with `SCENE_LAYOUTS` and `FLOOR_FRAME_MAP`.

## Furniture Sprite Frame Naming

Pattern: `{rotation}_{artFrame}_{animFrame}`

- `rotation`: 1-8, maps to the `rotation` field from `join_igloo` response
- `artFrame`: 1-6, maps to the `frame` field from `join_igloo` response
- `animFrame`: animation sequence frame (use `1` for static rendering)

Example: `3_2_1` = rotation 3, art frame 2, animation frame 1.

Furniture with `crumbs.furniture[id].fps` has animated frames (fps > 0). For canvas rendering, cycle through `animFrame` values at the specified FPS.

## Building Atlas Frame Names

Building atlases vary per igloo type. Common frame names:

| Frame | Purpose | Layer |
|-------|---------|-------|
| `floor`, `floor_1`, `floor_2` | Floor surface | Floor (depth -2) |
| `wall`, `walls`, `wall_1`, `wall_2`, `wall_3` | Wall structure | Background |
| `door`, `door0001` | Entry door | Background |
| `door-active`, `door-hover` | Interactive door states | Skip for rendering |
| `chimney` | Chimney | Background |
| `window`, `window_1` | Windows | Background |
| `stairs`, `stairs_top` | Staircase parts | stairs_top = Floor, stairs = Background |
| `wood`, `wood_1` | Wood paneling (Gym) | Floor |
| `fg` | Foreground overlay | Foreground (on top of furniture) |
| `roof` | Roof structure | Foreground |
| `fire_0001`..`fire_0016` | Animated fire | Background (use 0001 for static) |
| `platform`, `fireholder`, `fireback` | Decorative elements | Background |
| `sideladder`, `shelf`, `doorframe` | Structural elements | Background |
| `windowlight` | Window light effect | Background |

## WebSocket Packets

### `get_igloos` (client -> server)

Request: `{ action: "get_igloos", args: {} }`

Response:
```ts
{
  action: "get_igloos",
  args: {
    igloos: Array<{ id: number; username: string; likes: number }>;
    myIglooLikes: number;
  }
}
```

### `join_igloo` (client -> server)

Request: `{ action: "join_igloo", args: { igloo: number, x: 0, y: 0 } }`

Response:
```ts
{
  action: "join_igloo",
  args: {
    igloo: number;       // userId
    users: RoomUser[];
    type: number;        // igloo building type
    flooring: number;    // flooring id
    music: number;       // music track id
    location: number;    // background location id
    furniture: Array<{
      furnitureId: number;
      x: number;
      y: number;
      rotation: number;  // 1-8
      frame: number;     // art frame variant (1-6)
      depth: number;     // y-based depth sort
      slot: number;
    }>;
  }
}
```

### `get_igloo_likes` (client -> server)

Request: `{ action: "get_igloo_likes", args: {} }`

Response: `{ action: "get_igloo_likes", args: { likes: number } }`
