/**
 * Generates igloo layout data from Yukon (.scene files) + CPJ (webpack chunks).
 *
 * Sources:
 *   - Yukon repo (.scene JSON + .js): github.com/wizguin/yukon
 *   - CPJ webpack chunks: play.cpjourney.net (for CPJ-only igloo types)
 *   - CPJ crumbs.json: cdn.cpjourney.net
 *
 * Output: scripts/igloo-layouts.ts
 * Usage:  npx tsx scripts/generate-igloo-layouts.ts
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "igloo-layouts.ts");
const TIMEOUT = 10_000;
const YUKON_RAW =
	"https://raw.githubusercontent.com/wizguin/yukon/main/src/scenes/igloos";
const YUKON_API =
	"https://api.github.com/repos/wizguin/yukon/contents/src/scenes/igloos";
const CPJ_CDN = "https://cdn.cpjourney.net";
const CPJ_PLAY = "https://play.cpjourney.net";

const FG_NAMES = new Set(["fg", "roof"]);

// Authoritative floorFrame map from Yukon source analysis.
// Used as primary source; CPJ-extracted values supplement unknown types.
const KNOWN_FLOOR_FRAMES: Record<number, number> = {
	0: 17, 1: 1, 2: 1, 3: 2, 4: 2, 5: 1, 6: 1, 8: 2, 9: 2,
	10: 4, 11: 5, 12: 6, 13: 3, 14: 3, 15: 7, 16: 8, 17: 3,
	18: 1, 19: 10, 20: 11, 21: 3, 22: 8, 23: 7, 24: 11, 25: 11,
	26: 12, 27: 7, 28: 12, 29: 10, 30: 3, 32: 3, 33: 8,
	35: 13, 36: 11, 37: 2, 38: 8, 39: 8, 40: 14, 41: 15,
	43: 11, 49: 15, 50: 15, 51: 18, 52: 6, 53: 15, 55: 16,
	56: 4, 57: 16, 58: 16, 63: 16, 65: 16, 67: 16, 68: 16,
	69: 16, 75: 16, 76: 1, 84: 15,
	85: 15, 86: 15, 87: 15, 88: 15, 89: 15, 90: 15, 91: 15,
	92: 15, 93: 15, 94: 15, 98: 15, 99: 1, 100: 1, 101: 10,
	103: 16, 104: 16, 105: 12, 106: 18, 107: 3, 108: 3, 109: 2,
	110: 1, 111: 1, 112: 18, 113: 7, 114: 18, 115: 18, 116: 16, 117: 1,
};

// ---------- types ----------

type LayerType = "floor" | "bg" | "fg";
type SceneLayer = {
	frameName: string;
	x: number;
	y: number;
	originX: number;
	originY: number;
	layerType: LayerType;
	flipX?: true;
};
type SceneLayout = { floorFrame: number; layers: SceneLayer[] };

// ---------- fetch ----------

async function fetchText(url: string): Promise<string | null> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), TIMEOUT);
	try {
		const r = await fetch(url, { signal: ctrl.signal });
		clearTimeout(t);
		return r.ok ? await r.text() : null;
	} catch {
		clearTimeout(t);
		return null;
	}
}

async function fetchJson<T>(url: string): Promise<T | null> {
	const t = await fetchText(url);
	return t ? JSON.parse(t) : null;
}

// ---------- yukon parsers ----------

function parseYukonScene(json: {
	displayList?: Array<Record<string, unknown>>;
}): SceneLayer[] {
	const out: SceneLayer[] = [];

	function walk(items: Array<Record<string, unknown>>, floorCtx: boolean) {
		for (const it of items) {
			switch (it.type) {
				case "Layer":
					walk(
						(it.list as Array<Record<string, unknown>>) ?? [],
						it.label === "floor" && it.scope === "CLASS",
					);
					break;
				case "Image": {
					const tex = it.texture as
						| { key: string; frame: string }
						| undefined;
					if (!tex?.frame) break;
					const fn = tex.frame;
					let lt: LayerType = "bg";
					if (floorCtx || (it.label === "floor" && it.scope === "CLASS"))
						lt = "floor";
					else if (
						FG_NAMES.has(fn) ||
						FG_NAMES.has(it.label as string)
					)
						lt = "fg";
					out.push({
						frameName: fn,
						x: (it.x as number) ?? 0,
						y: (it.y as number) ?? 0,
						originX: (it.originX as number) ?? 0.5,
						originY: (it.originY as number) ?? 0.5,
						layerType: lt,
						...(it.flipX ? { flipX: true as const } : {}),
					});
					break;
				}
			}
		}
	}

	walk(json.displayList ?? [], false);
	return out;
}

function parseYukonFloorFrame(js: string): number | null {
	const m = js.match(/this\.floorFrame\s*=\s*(\d+)/);
	return m ? +m[1] : null;
}

// ---------- cpj chunk parser ----------

function resolveStringTable(src: string): Map<number, string> | null {
	// Extract the string array: const _arr=['str1','str2',...];
	const arrMatch = src.match(
		/const\s+\w+\s*=\s*\[([^\]]{20,})\]\s*;/,
	);
	if (!arrMatch) return null;
	const strings = arrMatch[1].match(/'([^']*)'/g)?.map((s) => s.slice(1, -1));
	if (!strings || !strings.includes("floorFrame")) return null;

	// Find the lookup offset: _var=_var-(0xHEX);
	const offsetMatch = src.match(/=\s*\w+\s*-\s*(0x[0-9a-f]+)\s*;/i);
	if (!offsetMatch) return null;
	const offset = parseInt(offsetMatch[1], 16);

	// Find all lookupFn(0xHEX) calls in the source and the strings they should resolve to.
	// We know certain patterns: this[fn(X)]='floorFrame' assignment is followed by =0xN.
	// Also: 'add', 'image', 'setOrigin', 'floorSpawn', etc. appear as property accesses.
	// We find lookups used with known string contexts to determine the correct rotation.
	//
	// Strategy: find fn(0xHEX) where the context makes it clear what string it should be.
	// E.g.: super('SceneName') tells us nothing, but this[fn(X)][fn(Y)](...,'texKey','frame')
	// where Y should be 'image' and X should be 'add'.
	//
	// Simplest: try all rotations. For each, check if fn(knownHex) produces 'add' where
	// we see ][fn(knownHex)]( patterns (property access before a function call).

	// Find all hex values used in lookup calls: _0xVarName(0xHEX)
	const lookupName = src.match(/function\s+(\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[^}]*-\s*0x/)?.[0];
	const fnNameMatch = src.match(
		/const\s+(\w+)\s*=\s*(\w+)\s*;.*?function\s+\2\b/s,
	);
	const fnName = fnNameMatch?.[1];

	// Collect all lookup hex values used in the code
	const lookupRe = fnName
		? new RegExp(`${fnName}\\((0x[0-9a-f]+)\\)`, "gi")
		: /\b\w+\((0x[0-9a-f]+)\)/gi;

	// Try all rotations and validate against known string patterns
	for (let rot = 0; rot < strings.length; rot++) {
		const rotated = [...strings.slice(rot), ...strings.slice(0, rot)];
		const map = new Map<number, string>();
		for (let i = 0; i < rotated.length; i++) {
			map.set(i + offset, rotated[i]);
		}

		// Validate: check if the 'floorFrame' hex key, when used as a lookup,
		// appears near an assignment with a hex/decimal value
		let ffHex: number | null = null;
		for (const [k, v] of map) {
			if (v === "floorFrame") {
				ffHex = k;
				break;
			}
		}
		if (ffHex == null) continue;

		const hexStr = `0x${ffHex.toString(16)}`;
		// Check if this hex value actually appears in the source as a lookup argument
		if (!src.includes(hexStr)) continue;

		// Verify: the hex value should appear in a context like:
		// this[fn(hexStr)]=0xNN (property assignment)
		const assignRe = new RegExp(
			`\\(${hexStr}\\)\\]\\s*=\\s*(0x[0-9a-f]+|\\d+)`,
			"i",
		);
		if (assignRe.test(src)) return map;
	}

	return null;
}

function parseCpjChunk(
	src: string,
	texKey: string,
): { layers: SceneLayer[]; floorFrame: number | null } {
	let floorFrame: number | null = null;

	// Try literal property: this['floorFrame']=0xN or this.floorFrame=N
	const ffLiteral = src.match(
		/(?:this\['floorFrame'\]|this\.floorFrame)\s*=\s*(0x[0-9a-f]+|\d+)/i,
	);
	if (ffLiteral) {
		floorFrame = ffLiteral[1].startsWith("0x")
			? parseInt(ffLiteral[1], 16)
			: +ffLiteral[1];
	}

	// Try obfuscated property via string table resolution
	if (floorFrame == null) {
		const strTable = resolveStringTable(src);
		if (strTable) {
			// Find which hex key maps to 'floorFrame'
			let ffHex: number | null = null;
			for (const [k, v] of strTable) {
				if (v === "floorFrame") {
					ffHex = k;
					break;
				}
			}
			if (ffHex != null) {
				// Match: this[lookupFn(0xHEX)]=value where HEX matches ffHex
				const hexStr = `0x${ffHex.toString(16)}`;
				const re = new RegExp(
					`\\w+\\(${hexStr}\\)\\]\\s*=\\s*(0x[0-9a-f]+|\\d+)`,
					"i",
				);
				const m = src.match(re);
				if (m) {
					floorFrame = m[1].startsWith("0x")
						? parseInt(m[1], 16)
						: +m[1];
				}
			}
		}
	}

	const layers: SceneLayer[] = [];
	const num = "(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+(?:e[+-]?\\d+)?)?)";
	const re = new RegExp(
		`\\(\\s*${num}\\s*,\\s*${num}\\s*,\\s*'${texKey}'\\s*,\\s*'([\\w-]+)'\\s*\\)`,
		"g",
	);
	const parseNum = (s: string) =>
		s.startsWith("0x") ? parseInt(s, 16) : parseFloat(s);

	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		const x = parseNum(m[1]);
		const y = parseNum(m[2]);
		const fn = m[3];

		let ox = 0.5;
		let oy = 0.5;
		const after = src.slice(m.index + m[0].length, m.index + m[0].length + 300);
		const om = after.match(
			/^(?:\[['"][^'"]+['"]\])*\s*(?:\['setOrigin'\]|\.setOrigin)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/,
		);
		if (om) {
			ox = +om[1];
			oy = +om[2];
		}

		let lt: LayerType = "bg";
		if (/^floor(_\d+)?$/.test(fn) || fn === "stairs_top") lt = "floor";
		else if (FG_NAMES.has(fn)) lt = "fg";

		layers.push({ frameName: fn, x, y, originX: ox, originY: oy, layerType: lt });
	}

	return { layers, floorFrame };
}

// ---------- cpj bundle helpers ----------

async function fetchCpjBundleUrl(): Promise<string | null> {
	// Bundle is loaded dynamically: assets/scripts/client/yukon.min.js
	return `${CPJ_PLAY}/assets/scripts/client/yukon.min.js`;
}

function extractChunkInfo(bundle: string) {
	// Module map: './igloos/dir/Name':['id1','id2','id3']
	const moduleMap: Record<string, string[]> = {};
	const modRe =
		/'\.\/(igloos\/[\w/]+?)(?:\.js)?'\s*:\s*(\[[^\]]+\])/g;
	let mm: RegExpExecArray | null;
	while ((mm = modRe.exec(bundle)) !== null) {
		try {
			moduleMap[mm[1]] = JSON.parse(mm[2].replace(/'/g, '"'));
		} catch {
			/* skip malformed */
		}
	}

	// Hash map: {0xHEX:'hash',...} inside the chunk URL function
	const hashMap: Record<number, string> = {};
	let urlPrefix = "";
	const urlMatch = bundle.match(
		/'(assets\/scripts\/client\/\d+\.)'\s*\+\s*\{/,
	);
	if (urlMatch) {
		urlPrefix = urlMatch[1];
		const start = bundle.indexOf(
			"{",
			urlMatch.index! + urlMatch[0].length - 1,
		);
		let depth = 1;
		let i = start + 1;
		while (depth > 0 && i < bundle.length) {
			if (bundle[i] === "{") depth++;
			else if (bundle[i] === "}") depth--;
			i++;
		}
		const hRe = /(0x[0-9a-fA-F]+)\s*:\s*'([a-f0-9]+)'/g;
		let hm: RegExpExecArray | null;
		const obj = bundle.slice(start, i);
		while ((hm = hRe.exec(obj)) !== null) {
			hashMap[parseInt(hm[1], 16)] = hm[2];
		}
	}

	return { moduleMap, hashMap, urlPrefix };
}

// ---------- output ----------

function sortedKeys<T>(obj: Record<number | string, T>): Record<string, T> {
	const sorted: Record<string, T> = {};
	for (const k of Object.keys(obj).sort((a, b) => +a - +b))
		sorted[k] = obj[+k];
	return sorted;
}

function generateTs(
	layouts: Record<number, SceneLayout>,
	floorFrames: Record<number, number>,
): string {
	const lines = [
		"// Auto-generated by generate-igloo-layouts.ts",
		`// Generated: ${new Date().toISOString()}`,
		"// Regenerate: npx tsx scripts/generate-igloo-layouts.ts",
		"",
		'export type LayerType = "floor" | "bg" | "fg";',
		"",
		"export type SceneLayer = {",
		"\tframeName: string;",
		"\tx: number;",
		"\ty: number;",
		"\toriginX: number;",
		"\toriginY: number;",
		"\tlayerType: LayerType;",
		"\tflipX?: true;",
		"};",
		"",
		"export type SceneLayout = {",
		"\tfloorFrame: number;",
		"\tlayers: SceneLayer[];",
		"};",
		"",
		"export const SCENE_LAYOUTS: Record<number, SceneLayout> = " +
			JSON.stringify(sortedKeys(layouts), null, "\t") +
			";",
		"",
		"export const FLOOR_FRAME_MAP: Record<number, number> = " +
			JSON.stringify(sortedKeys(floorFrames), null, "\t") +
			";",
		"",
	];
	return lines.join("\n");
}

// ---------- main ----------

async function main() {
	console.log("Fetching crumbs...");
	const crumbs = await fetchJson<Record<string, unknown>>(
		`${CPJ_CDN}/assets/media/crumbs/en/crumbs.json`,
	);
	if (!crumbs?.igloos) throw new Error("Failed to fetch crumbs");
	const igloos = crumbs.igloos as Record<
		string,
		{ key: string; name: string; path: string }
	>;

	console.log("Listing Yukon igloo directories...");
	const yukonDirs = await fetchJson<Array<{ name: string; type: string }>>(
		YUKON_API,
	);
	const yukonSet = new Set(
		(yukonDirs ?? []).filter((d) => d.type === "dir").map((d) => d.name),
	);
	console.log(`  ${yukonSet.size} Yukon directories`);

	const layouts: Record<number, SceneLayout> = {};
	// Start with known floor frames, supplement with extracted values
	const floorFrames: Record<number, number> = { ...KNOWN_FLOOR_FRAMES };
	const cpjOnly: Array<[number, { key: string }]> = [];

	// --- Yukon types ---
	console.log("Fetching Yukon scenes...");
	await Promise.allSettled(
		Object.entries(igloos).map(async ([typeId, meta]) => {
			const dir = meta.key.toLowerCase();
			const id = +typeId;
			if (!yukonSet.has(dir)) {
				cpjOnly.push([id, meta]);
				return;
			}

			const [sceneText, jsText] = await Promise.all([
				fetchText(`${YUKON_RAW}/${dir}/${meta.key}.scene`),
				fetchText(`${YUKON_RAW}/${dir}/${meta.key}.js`),
			]);
			if (!sceneText) {
				cpjOnly.push([id, meta]);
				return;
			}

			const layers = parseYukonScene(JSON.parse(sceneText));
			const ff = jsText ? parseYukonFloorFrame(jsText) : null;
			if (layers.length > 0)
				layouts[id] = { floorFrame: floorFrames[id] ?? ff ?? 1, layers };
			if (ff != null && !(id in floorFrames)) floorFrames[id] = ff;
		}),
	);

	const yukonOk = Object.keys(layouts).length;
	console.log(`  Parsed ${yukonOk} Yukon scenes, ${cpjOnly.length} CPJ-only`);

	// --- CPJ-only types ---
	if (cpjOnly.length > 0) {
		console.log("Fetching CPJ bundle...");
		const bundleUrl = await fetchCpjBundleUrl();
		if (!bundleUrl) {
			console.log("  Could not find CPJ bundle URL");
		} else {
			const bundle = await fetchText(bundleUrl);
			if (!bundle) {
				console.log("  Could not fetch CPJ bundle");
			} else {
				const { moduleMap, hashMap, urlPrefix } = extractChunkInfo(bundle);
				console.log(
					`  ${Object.keys(moduleMap).length} modules, ${Object.keys(hashMap).length} chunks`,
				);

				for (const [id, meta] of cpjOnly) {
					const dir = meta.key.toLowerCase();
					const path = `igloos/${dir}/${meta.key}`;
					const chunkIds = moduleMap[path] ?? moduleMap[`${path}.js`];
					if (!chunkIds || chunkIds.length < 2) continue;

					const sceneChunkId = +chunkIds[chunkIds.length - 1];
					const hash = hashMap[sceneChunkId];
					if (!hash) continue;

					const chunkSrc = await fetchText(
						`${CPJ_PLAY}/${urlPrefix}${hash}.min.js`,
					);
					if (!chunkSrc) continue;

					const { layers, floorFrame } = parseCpjChunk(chunkSrc, dir);
					const ff = floorFrames[id] ?? floorFrame ?? 1;
					if (layers.length > 0) {
						layouts[id] = { floorFrame: ff, layers };
						console.log(
							`  ${meta.key} (${id}): ${layers.length} layers, floorFrame=${ff}`,
						);
					}
					if (floorFrame != null && !(id in KNOWN_FLOOR_FRAMES))
						floorFrames[id] = floorFrame;
				}
			}
		}
	}

	// --- Write output ---
	const total = Object.keys(layouts).length;
	console.log(
		`\nTotal: ${total} layouts, ${Object.keys(floorFrames).length} floor frames`,
	);

	const ts = generateTs(layouts, floorFrames);
	await writeFile(OUTPUT, ts);
	console.log(`Written to ${OUTPUT}`);
}

main().catch(console.error);
