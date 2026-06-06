/** Core appearance slots shared by all servers (CPJourney, CPLegacy, NewCP). */
export type PlayerAppearance = {
  color: number;
  head: number;
  face: number;
  neck: number;
  body: number;
  hand: number;
  feet: number;
  flag: number;
  photo: number;
};

/** CPJourney only */
export type PlayerSettings = {
  music_volume: number;
  sfx_volume: number;
  hide_penguins: boolean;
  hide_chats: boolean;
  hide_emotes: boolean;
  hide_ui: boolean;
  hide_usernames: boolean;
  quality: number;
  silence_notifications: boolean;
  opt_out_postcards: boolean;
  opt_out_buddy_requests: boolean;
};

export type Buddy = {
  id: number;
  username: string;
  online: boolean;
  /** CPJourney only */
  favorite?: boolean;
  /** CPJourney only */
  items?: number[];
  /** CPJourney only */
  onlineServer?: string;
};

/**
 * A penguin visible in a room. Only fields present on 2+ servers are
 * top-level. Single-server extras live in `meta`.
 *
 * Display name mapping:
 * - CPJourney: `displayName`
 * - CPLegacy: `realUsername` → `displayName`
 * - NewCP: `nickname` → `displayName`
 */
export type RoomUser = PlayerAppearance & {
  id: number;
  username: string;
  x: number;
  y: number;
  frame: number;
  /** Adapter-specific extras. See each adapter's normalizeUser for keys. */
  meta: Record<string, unknown>;
  /** Original unnormalized server response */
  _raw: Record<string, unknown>;
  /** Display name — source field varies per server, normalized here */
  displayName?: string;
  /** CPJourney, CPLegacy */
  joinTime?: string;
  /** CPJourney: puffle type number, CPLegacy: walking puffle ID */
  walking?: number;
};

/**
 * Full player data from `load_player`. Only fields present on 2+ servers
 * are top-level. Single-server extras live in `meta`.
 *
 * Coins/rank source:
 * - CPJourney/NewCP: sibling fields of `user` in `load_player` args
 * - CPLegacy: inside `user` object directly
 */
export type PlayerData = RoomUser & {
  coins: number;
  rank: number;
  inventory: number[];
  /** CPJourney, NewCP */
  buddies?: Buddy[];
  /** CPJourney, CPLegacy (CPLegacy maps from `pending` array) */
  buddyRequests?: number[];
  /** CPJourney, NewCP */
  ignores?: number[];
  /** All servers — CPJourney: array, CPLegacy/NewCP: Record<string, number> */
  furniture?: unknown[] | Record<string, unknown>;
  /** CPJourney, NewCP */
  flooring?: unknown[];
  /** CPJourney, NewCP */
  igloos?: unknown[];
};

export type Postcard = {
  id: number;
  username: string;
  senderId: number;
  postcardId: number;
  extra: string | null;
  date: string;
};

export type NinjaCard = {
  id: number;
  powerID: number;
  element: string;
  color: string;
  value: number;
  quantity: number;
};

export type NinjaProgress = {
  rank: number;
  progress: number;
};

export type NinjaData = {
  rank: number;
  progress: number;
  fire: NinjaProgress;
  water: NinjaProgress;
  cards: NinjaCard[];
};

export type GameCard = {
  slot: number;
  card: number;
  uuid: string;
};

export type RevealedCard = {
  id: number;
  uuid: string;
  powerID: number;
  element: string;
  color: string;
  value: number;
};

export type RoundResult = {
  seat0card: RevealedCard;
  seat1card: RevealedCard;
  winner: number;
};

export type GamePlayer = {
  seat: number;
  colour: number;
  name: string;
  belt: number;
  /** Sensei match flag — msgpack ext type, null when not a sensei game */
  sensei: unknown;
};

/** State of all mats in the Dojo. Keys are mat IDs (e.g. "200"), values are seat arrays with player usernames or null. */
export type MatState = Record<string, (string | null)[]>;

export type Mascot = {
  id: number;
  name: string;
  giveaway: number;
  stamp: number;
};
