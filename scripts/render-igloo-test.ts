/**
 * Test script: renders sniffed igloo data to PNG files.
 *
 * Usage:
 *   npx tsx scripts/render-igloo-test.ts
 *
 * Outputs:   /tmp/igloo-renders/igloo-{userId}.png
 */

import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import {
	SCENE_LAYOUTS,
	FLOOR_FRAME_MAP,
	type SceneLayer,
	type SceneLayout,
	type LayerType,
} from "./igloo-layouts.js";

const FETCH_TIMEOUT_MS = 15_000;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;
const FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

const CPJ_CDN = "https://cdn.cpjourney.net";
const CPJ_PLAY = "https://play.cpjourney.net";

const CACHE_DIR = resolve("/tmp/igloo-cache");
const OUTPUT_DIR = resolve("/tmp/igloo-renders");

// Canvas is always 1520x960 (borderWidth/borderHeight from Phaser scene settings)
const CANVAS_W = 1520;
const CANVAS_H = 960;

// ---------- types ----------

type IglooData = {
	igloo: number;
	type: number;
	flooring: number;
	music: number;
	location: number;
	furniture: Array<{
		furnitureId: number;
		x: number;
		y: number;
		rotation: number;
		frame: number;
		depth: number;
		slot: number;
	}>;
};

type AtlasFrame = {
	imgIndex: number;
	x: number;
	y: number;
	w: number;
	h: number;
	offsetX: number;
	offsetY: number;
	sourceW: number;
	sourceH: number;
};

type ParsedAtlas = Map<string, AtlasFrame>;

type CrumbsIgloo = {
	key: string;
	name: string;
	path: string;
	x: number;
	y: number;
	cost: number;
};

// Scene layouts and floor frame mappings imported from generated file.
// Regenerate: npx tsx scripts/generate-igloo-layouts.ts

// ---------- fetch helpers ----------

async function fetchRaw(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) throw new Error(`Fetch ${res.status}: ${url}`);
		return Buffer.from(await res.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}
}

async function fetchCached(url: string, cachePath: string): Promise<Buffer> {
	try {
		await stat(cachePath);
		return await readFile(cachePath);
	} catch {
		// cache miss
	}
	const raw = await fetchRaw(url);
	await mkdir(dirname(cachePath), { recursive: true });
	await writeFile(`${cachePath}.tmp`, raw);
	await rename(`${cachePath}.tmp`, cachePath);
	return raw;
}

function safeCachePath(base: string, ...parts: string[]): string {
	for (const p of parts) {
		if (!FILENAME_PATTERN.test(p)) throw new Error(`Unsafe filename: ${p}`);
	}
	const result = join(base, ...parts);
	if (!result.startsWith(base)) throw new Error("Path traversal");
	return result;
}

// ---------- atlas parser ----------

function parseAtlasJson(json: {
	textures: {
		image: string;
		frames: {
			filename: string;
			frame: { x: number; y: number; w: number; h: number };
			spriteSourceSize: { x: number; y: number; w: number; h: number };
			sourceSize: { w: number; h: number };
		}[];
	}[];
}): { frames: ParsedAtlas; imageNames: string[] } {
	const frames: ParsedAtlas = new Map();
	const imageNames: string[] = [];

	for (const tex of json.textures) {
		const imgIndex = imageNames.length;
		imageNames.push(tex.image);
		for (const f of tex.frames) {
			frames.set(f.filename, {
				imgIndex,
				x: f.frame.x,
				y: f.frame.y,
				w: f.frame.w,
				h: f.frame.h,
				offsetX: f.spriteSourceSize.x,
				offsetY: f.spriteSourceSize.y,
				sourceW: f.sourceSize.w,
				sourceH: f.sourceSize.h,
			});
		}
	}

	return { frames, imageNames };
}

async function extractFrame(
	sheetBuf: Buffer,
	frame: AtlasFrame,
): Promise<Buffer> {
	return sharp(sheetBuf)
		.extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h })
		.png()
		.toBuffer();
}

// ---------- crumbs ----------

let crumbsCache: Record<string, unknown> | null = null;

async function getCrumbs(): Promise<Record<string, unknown>> {
	if (crumbsCache) return crumbsCache;
	const buf = await fetchCached(
		`${CPJ_CDN}/assets/media/crumbs/en/crumbs.json`,
		safeCachePath(CACHE_DIR, "crumbs", "crumbs.json"),
	);
	crumbsCache = JSON.parse(buf.toString());
	return crumbsCache!;
}

// ---------- render ----------

async function renderIgloo(data: IglooData): Promise<Buffer> {
	const crumbs = await getCrumbs();
	const igloosCrumbs = crumbs.igloos as Record<string, CrumbsIgloo>;
	const iglooMeta = igloosCrumbs[String(data.type)];
	if (!iglooMeta) throw new Error(`Unknown igloo type: ${data.type}`);

	const buildingKey = iglooMeta.key.toLowerCase();
	console.log(
		`  Rendering igloo ${data.igloo}: ${iglooMeta.name} (type=${data.type}), location=${data.location}, flooring=${data.flooring}, furniture=${data.furniture.length}`,
	);

	// 1. Load location background
	let locationBuf: Buffer | null = null;
	try {
		locationBuf = await fetchCached(
			`${CPJ_CDN}//assets/media/igloos/locations/sprites/${data.location}.png`,
			safeCachePath(CACHE_DIR, "locations", `${data.location}.png`),
		);
	} catch {
		console.log("    Location background not found, using transparent");
	}

	// 2. Load building atlas
	const buildingJsonBuf = await fetchCached(
		`${CPJ_CDN}/assets/media/igloos/buildings/sprites/${buildingKey}/${buildingKey}.json`,
		safeCachePath(CACHE_DIR, "buildings", `${buildingKey}.json`),
	);
	const buildingJson = JSON.parse(buildingJsonBuf.toString());
	const { frames: buildingFrames, imageNames: buildingImages } =
		parseAtlasJson(buildingJson);
	const buildingSheets: Buffer[] = await Promise.all(
		buildingImages.map((imgName) =>
			fetchCached(
				`${CPJ_CDN}/assets/media/igloos/buildings/sprites/${buildingKey}/${imgName}`,
				safeCachePath(CACHE_DIR, "buildings", imgName),
			),
		),
	);

	// 3. Load flooring atlas (if any)
	const floorFrame = FLOOR_FRAME_MAP[data.type] ?? 1;
	let flooringBuf: { buf: Buffer; left: number; top: number; w: number; h: number } | null = null;
	if (data.flooring > 0) {
		try {
			const flooringJsonBuf = await fetchCached(
				`${CPJ_CDN}//assets/media/igloos/flooring/sprites/${data.flooring}.json`,
				safeCachePath(CACHE_DIR, "flooring", `${data.flooring}.json`),
			);
			const flooringJson = JSON.parse(flooringJsonBuf.toString());
			const { frames: flooringFrames, imageNames: flooringImages } =
				parseAtlasJson(flooringJson);

			// Select the correct floor frame variant for this igloo type
			const frameKey = `${floorFrame}_1`;
			const frameInfo = flooringFrames.get(frameKey) ?? flooringFrames.values().next().value;
			if (frameInfo) {
				const sheetBuf = await fetchCached(
					`${CPJ_CDN}//assets/media/igloos/flooring/sprites/${flooringImages[frameInfo.imgIndex]}`,
					safeCachePath(CACHE_DIR, "flooring", flooringImages[frameInfo.imgIndex]),
				);
				const extracted = await extractFrame(sheetBuf, frameInfo);

				// Phaser places flooring at (0, 0) with origin (0.5, 0.5)
				// So the image center is at world (0, 0), extending from (-sourceW/2, -sourceH/2)
				// The frame's pixel data starts at (offsetX, offsetY) within the virtual image
				// World coordinates: worldLeft = -sourceW/2 + offsetX, worldTop = -sourceH/2 + offsetY
				const left = -frameInfo.sourceW / 2 + frameInfo.offsetX;
				const top = -frameInfo.sourceH / 2 + frameInfo.offsetY;

				flooringBuf = { buf: extracted, left, top, w: frameInfo.w, h: frameInfo.h };
				console.log(`    Flooring ${data.flooring} frame ${frameKey}: pos=(${Math.round(left)}, ${Math.round(top)})`);
			}
		} catch (e) {
			console.log(`    Flooring ${data.flooring} failed:`, (e as Error).message);
		}
	}

	// 4. Load furniture atlases
	type FurniReady = {
		buf: Buffer;
		frame: AtlasFrame;
		x: number;
		y: number;
		depth: number;
	};

	const furnitureReady: FurniReady[] = [];
	const furniAtlasCache = new Map<
		number,
		{ frames: ParsedAtlas; sheets: Buffer[] } | null
	>();

	for (const item of data.furniture) {
		const id = item.furnitureId;
		if (!furniAtlasCache.has(id)) {
			try {
				const jsonBuf = await fetchCached(
					`${CPJ_PLAY}/assets/media/furniture/sprites/${id}.json`,
					safeCachePath(CACHE_DIR, "furniture", `${id}.json`),
				);
				const json = JSON.parse(jsonBuf.toString());
				const { frames, imageNames } = parseAtlasJson(json);
				const sheets = await Promise.all(
					imageNames.map((imgName) =>
						fetchCached(
							`${CPJ_PLAY}/assets/media/furniture/sprites/${imgName}`,
							safeCachePath(CACHE_DIR, "furniture", imgName),
						),
					),
				);
				furniAtlasCache.set(id, { frames, sheets });
			} catch {
				furniAtlasCache.set(id, null);
			}
		}

		const atlas = furniAtlasCache.get(id);
		if (!atlas) continue;

		const frameKey = `${item.rotation}_${item.frame}_1`;
		const frameInfo = atlas.frames.get(frameKey);
		if (!frameInfo) continue;

		try {
			const frameBuf = await extractFrame(
				atlas.sheets[frameInfo.imgIndex],
				frameInfo,
			);
			furnitureReady.push({
				buf: frameBuf,
				frame: frameInfo,
				x: item.x,
				y: item.y,
				depth: item.depth,
			});
		} catch {
			// skip items that fail extraction
		}
	}

	furnitureReady.sort((a, b) => a.depth - b.depth);

	// 5. Composite everything

	const addBuildingLayer = async (layer: SceneLayer): Promise<{ buf: Buffer; left: number; top: number; w: number; h: number } | null> => {
		const frameInfo = buildingFrames.get(layer.frameName);
		if (!frameInfo) return null;

		const left = layer.x - frameInfo.sourceW * layer.originX + frameInfo.offsetX;
		const top = layer.y - frameInfo.sourceH * layer.originY + frameInfo.offsetY;

		try {
			const buf = await extractFrame(buildingSheets[frameInfo.imgIndex], frameInfo);
			return { buf, left, top, w: frameInfo.w, h: frameInfo.h };
		} catch {
			return null;
		}
	};

	const sceneLayout = SCENE_LAYOUTS[data.type];

	// Collect layers in proper order
	const bgLayers: Array<{ buf: Buffer; left: number; top: number; w: number; h: number }> = [];
	const floorLayers: Array<{ buf: Buffer; left: number; top: number; w: number; h: number }> = [];
	const fgLayers: Array<{ buf: Buffer; left: number; top: number; w: number; h: number }> = [];

	if (sceneLayout) {
		// Use known scene layout
		for (const layer of sceneLayout.layers) {
			const result = await addBuildingLayer(layer);
			if (!result) continue;

			switch (layer.layerType) {
				case "floor":
					floorLayers.push(result);
					break;
				case "bg":
					bgLayers.push(result);
					break;
				case "fg":
					fgLayers.push(result);
					break;
			}
		}
	} else {
		// Fallback: render all building frames generically
		// Use conventional names: "floor" at depth -2, "walls"/"wall" as bg, "roof" as fg
		console.log(`    No scene layout for type ${data.type}, using generic fallback`);
		for (const [frameName, frameInfo] of buildingFrames) {
			// Skip interactive/animated variants
			if (frameName.includes("-active") || frameName.includes("-hover")) continue;
			if (frameName.match(/^fire_\d{4}$/) && frameName !== "fire_0001") continue;

			const buf = await extractFrame(buildingSheets[frameInfo.imgIndex], frameInfo);
			const entry = {
				buf,
				left: frameInfo.offsetX,
				top: frameInfo.offsetY,
				w: frameInfo.w,
				h: frameInfo.h,
			};

			if (frameName === "floor" || frameName.startsWith("floor_") || frameName === "stairs_top") {
				floorLayers.push(entry);
			} else if (frameName === "roof" || frameName === "fg") {
				fgLayers.push(entry);
			} else {
				bgLayers.push(entry);
			}
		}
	}

	// Now composite in order: location → floor layers → flooring → bg layers → furniture → fg layers
	const layers: sharp.OverlayOptions[] = [];

	// Location background
	if (locationBuf) {
		const locResized = await sharp(locationBuf)
			.resize(CANVAS_W, CANVAS_H, { fit: "cover" })
			.png()
			.toBuffer();
		layers.push({ input: locResized });
	}

	// Floor layers (depth -2)
	for (const entry of floorLayers) {
		await safeComposite(layers, entry);
	}

	// Flooring overlay (depth -1)
	if (flooringBuf) {
		await safeComposite(layers, flooringBuf);
	}

	// Background building layers (depth 0 - behind furniture)
	for (const entry of bgLayers) {
		await safeComposite(layers, entry);
	}

	// Furniture items (sorted by depth)
	for (const item of furnitureReady) {
		const left = Math.round(item.x - item.frame.sourceW / 2 + item.frame.offsetX);
		const top = Math.round(item.y - item.frame.sourceH / 2 + item.frame.offsetY);

		await safeComposite(layers, { buf: item.buf, left, top, w: item.frame.w, h: item.frame.h });
	}

	// Foreground building layers (on top of furniture)
	for (const entry of fgLayers) {
		await safeComposite(layers, entry);
	}

	return sharp({
		create: {
			width: CANVAS_W,
			height: CANVAS_H,
			channels: 4,
			background: TRANSPARENT,
		},
	})
		.composite(layers)
		.png()
		.toBuffer();
}

/**
 * Safely add a layer, cropping to fit within canvas bounds to avoid
 * sharp's "Image to composite must have same dimensions or smaller" error.
 */
async function safeComposite(
	layers: sharp.OverlayOptions[],
	entry: { buf: Buffer; left: number; top: number; w: number; h: number },
): Promise<void> {
	const intLeft = Math.round(entry.left);
	const intTop = Math.round(entry.top);

	// Skip fully out-of-bounds
	if (intLeft + entry.w <= 0 || intTop + entry.h <= 0) return;
	if (intLeft >= CANVAS_W || intTop >= CANVAS_H) return;

	const cropLeft = Math.max(0, -intLeft);
	const cropTop = Math.max(0, -intTop);
	const finalLeft = Math.max(0, intLeft);
	const finalTop = Math.max(0, intTop);
	const maxW = CANVAS_W - finalLeft;
	const maxH = CANVAS_H - finalTop;
	const cropW = Math.min(entry.w - cropLeft, maxW);
	const cropH = Math.min(entry.h - cropTop, maxH);

	if (cropW <= 0 || cropH <= 0) return;

	let buf = entry.buf;
	if (cropLeft > 0 || cropTop > 0 || cropW < entry.w || cropH < entry.h) {
		buf = await sharp(entry.buf)
			.extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
			.png()
			.toBuffer();
	}

	layers.push({ input: buf, left: finalLeft, top: finalTop });
}

// ---------- main ----------

async function main() {
	await mkdir(OUTPUT_DIR, { recursive: true });

	const testData: IglooData[] = JSON.parse(
		await readFile("/tmp/test_igloos.json", "utf-8"),
	);

	// Skip empty igloos (no furniture, default type)
	const interesting = testData.filter(
		(d) => d.furniture.length > 0 || d.type !== 1,
	);

	console.log(`Rendering ${interesting.length} igloos...\n`);

	for (const data of interesting) {
		try {
			const buf = await renderIgloo(data);
			const outPath = join(OUTPUT_DIR, `igloo-${data.igloo}.png`);
			await writeFile(outPath, buf);
			console.log(`  -> ${outPath}\n`);
		} catch (e) {
			console.error(`  FAILED igloo ${data.igloo}:`, (e as Error).message, "\n");
		}
	}

	console.log("Done!");
}

main().catch(console.error);
