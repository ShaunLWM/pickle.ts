import type { ClientDisconnectInfo } from "../lifecycle.js";
import type { QueueUpdate } from "./adapter-types.js";
import type {
  FurnitureStoreItem,
  GameCard,
  GamePlayer,
  IglooFurniturePlacement,
  IglooStoreItem,
  Mascot,
  MatState,
  NinjaData,
  PlayerData,
  Postcard,
  Puffle,
  PuffleWellbeing,
  RoomUser,
  RoundResult,
} from "./player-types.js";

export type ClientMessages = {
  send_position: { x: number; y: number };
  send_frame: { frame: number; set?: boolean };
  send_message: { message: string };
  join_room: { room: number; x?: number; y?: number };
  add_item: { item: number | string };
  send_emote: { emote: number; pack?: number };
  send_safe: { safe: number };
  snowball: { x: number; y: number };
  buddy_request: { id: number };
  buddy_accept: { id: number };
  buddy_reject: { id: number };
  buddy_request_seen: { id: number };
  get_buddy: { id: number; type: "buddies" | "buddyRequests" };
  remove_buddy: { id: number };
  get_player: { id: number };
  ignore_add: { id: number };
  ignore_remove: { id: number };
  send_postcard: { userId: number; cardId: string };
  get_stamps: { userId: number };
  get_postcards: Record<string, never>;
  get_igloo_open: { igloo: number };
  get_igloos: Record<string, never>;
  get_puffles: { userId: number; isBackyard?: boolean };
  get_igloo_likes: { iglooId?: number };
  join_igloo: { igloo: number; x?: number; y?: number };
  update_color: { item: number };
  update_head: { item: number };
  update_face: { item: number };
  update_neck: { item: number };
  update_body: { item: number };
  update_hand: { item: number };
  update_feet: { item: number };
  update_flag: { item: number };
  update_photo: { item: number };
  game_over: { coins: number };
  collect_stamp: { stamp: number };
  get_all_slots: Record<string, never>;
  get_mascots: Record<string, never>;
  get_weather: Record<string, never>;
  join_server: Record<string, never>;
  adopt_puffle: { type: number; name: string };
  check_puffle_sprite: { puffleSprite: unknown };
  open_sprite: { sprite: string };
  equip_toy: { toy: number };
  get_all_puffles: Record<string, never>;
  get_wellbeing: { puffle: number };
  puffle_play: { puffle: number };
  update_puffle_rest: { puffle: number };
  puffle_buy_item: { puffleId: number; item: number };
  walk_puffle: { puffle: number };
  backyard_supplies: Record<string, never>;
  buddy_find: { id: number };
  get_store_music: Record<string, never>;
  add_music: { music: string };
  get_igloostore_items: Record<string, never>;
  add_furniture: { furniture: string; amount: number };
  update_music: { music: string };
  update_furniture: { furniture: IglooFurniturePlacement[] };
  update_furniture_auto: { furniture: IglooFurniturePlacement[] };
  update_igloo: { type: number };
  open_igloo: Record<string, never>;
  close_igloo_bounds: Record<string, never>;
  like_igloo: { iglooId?: number };
  igloo_editor_open: Record<string, never>;
  igloo_editor_closed: Record<string, never>;
  tower_init: Record<string, never>;
  queue_server_join: { server: string };
  /** Fetch ninja rank, progress, and card deck */
  get_ninja: Record<string, never>;
  /** Fetch state of all Dojo mats (wire: get_waddles) */
  get_waddles: Record<string, never>;
  /** Join Sensei matchmaking queue */
  join_matchmaking: Record<string, never>;
  /** Leave Sensei matchmaking queue */
  leave_matchmaking: Record<string, never>;
  /** Start a Card-Jitsu match after entering a game room */
  start_game: Record<string, never>;
  /** Play a card from your hand by slot index */
  select_card: { slot: number };
  /** Preload a power card animation */
  load_animation: { animation: string };
  /** Sit on a Dojo mat to wait for an opponent (wire: join_waddle) */
  join_waddle: { waddle: number };
  /** CPPS.lol-only packets. */
  leave_waddle: Record<string, never>;
  remove_inventory: { item: number };
  get_snowflake_state: Record<string, never>;
  accept_mature: Record<string, never>;
  get_pets: { userId: number };
  get_igloo_contest: Record<string, never>;
  send_mail: { recipient: number; postcardId: number };
  marry_request: { id: number };
};

export type ServerMessages = {
  login: {
    success: boolean;
    username: string;
    key: string;
    populations: Record<string, number>;
    moderator: boolean;
    buddyWorlds: string[];
  };
  game_auth: {
    success: boolean;
    token?: string;
  };
  load_player: {
    user: PlayerData;
  };
  join_room: {
    room: number;
    users: RoomUser[];
  };
  add_player: {
    user: RoomUser;
  };
  remove_player: {
    user: number;
  };
  send_position: {
    id: number;
    x: number;
    y: number;
  };
  send_frame: {
    id: number;
    frame: number;
    set?: boolean;
  };
  send_message: {
    id: number;
    message: string;
  };
  send_emote: {
    id: number;
    emote: number;
    pack?: number;
  };
  join_game_room: {
    game: number;
  };
  game_over: {
    coins: number;
    hasStamps: boolean;
    totalStamps: number;
    collectedStamps: number;
    stampList: string[];
    room: string;
    gift: boolean;
    doubleCoins: boolean;
    towerCoins: boolean;
  };
  stamp_earned: {
    stamp: number;
  };
  set_weather: {
    type: string;
    intensity: number;
  };
  open_sprite: {
    id: number;
    sprite: string;
  };
  close_sprite: {
    id: number;
  };
  queue_server_join: Record<string, never>;
  wait_queue_update: QueueUpdate;
  cpj_ping: Record<string, never>;
  get_mascots: {
    mascots: Mascot[];
  };
  get_player: {
    user: RoomUser;
  };
  buddy_request: {
    id: number;
  };
  buddy_accept: {
    id: number;
    username: string;
    requester: boolean;
    online: boolean;
  };
  buddy_reject: {
    id: number;
  };
  buddy_request_seen: {
    id: number;
  };
  get_buddy: {
    id: number;
    penguin: Record<string, unknown>;
    type: "buddies" | "buddyRequests";
  };
  send_postcard: {
    coins: number;
  };
  stamps_result: {
    stamps: number[];
    inventory: number[];
    coverOnly: number[];
    unseen: number[];
    username: string;
    playerColor: number;
    stampbook: {
      userId: number;
      colour: number;
      clasp: number;
      highlight: number;
      pattern: number;
    };
    coverStamps: {
      stampId: number;
      itemId: number;
      x: number;
      y: number;
      rotation: number;
    }[];
  };
  ignore_add: {
    id: number;
    username: string;
  };
  ignore_remove: {
    id: number;
  };
  add_item: {
    item: number | string;
    coins: number;
    name?: string;
    slot?: string;
  };
  get_postcards: {
    postcards: Postcard[];
  };
  get_igloo_open: {
    open: boolean;
  };
  get_igloos: {
    igloos: Array<{ id: number; username: string; likes: number }>;
    myIglooLikes: number;
  };
  get_igloo_likes: {
    likes: number;
  };
  join_igloo: {
    igloo: number;
    users: RoomUser[];
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
  get_puffles: {
    userId: number;
    puffles: Puffle[];
  };
  get_all_puffles: { puffles: Puffle[] };
  get_wellbeing: PuffleWellbeing;
  get_walking_puffle: { puffle: Puffle };
  update_wellbeing: PuffleWellbeing;
  puffle_levelup: { puffleId: number; level: number };
  puffle_popup: { puffleId: number; popupId: number };
  buy_puffle_item: {
    puffleId: number;
    item: number;
    coins: number;
    puffleInventory: Record<string, unknown>;
  };
  walk_puffle: { user: number; puffle: number; type: number };
  backyard_supplies: {
    supplyCost: number;
    puffleCount: number;
    supplyState: number;
  };
  buddy_find: { find: number; username: string; game: boolean };
  receive_postcard: Postcard;
  get_store_music: { music: IglooStoreItem[] };
  add_music: { music: string; coins: number };
  get_igloostore_items: {
    furniture: FurnitureStoreItem[];
    flooring: IglooStoreItem[];
    igloo: IglooStoreItem[];
    location: IglooStoreItem[];
  };
  add_furniture: { furniture: string; coins: number; amount: number };
  update_music: { music: string };
  igloo_open_status: { status: number };
  igloo_bounds_status: { status: number };
  igloo_liked: Record<string, never>;
  update_player: {
    id: number;
    item: number;
    slot: string;
  };
  slot: unknown[];
  server_error: {
    error: number | string;
  };
  kick: {
    reason: string;
  };
  close_with_error: {
    error: string;
  };
  /** Server broadcast: a snowball was thrown */
  snowball: { id: number; x: number; y: number };
  /** Server broadcast: a safe-chat phrase was sent */
  send_safe: { id: number; safe: number };
  /** A puffle stopped walking with a player */
  stop_walking: { user: number; puffle: { type: number; id: number } };
  /** A player sat at or left a minigame table */
  update_table: { table: number; seat: number; username?: string | null };
  /** A player equipped or removed a transformation costume (0 = reverted to normal) */
  transform_player: { id: number; transform: number };
  adopt_puffle: {
    puffle?: unknown;
    coins: number;
  };
  /** Generic server info/notification message */
  info: {
    message: string;
  };
  unknown_packet: {
    action: string;
    args: Record<string, unknown>;
  };
  disconnect: ClientDisconnectInfo;
  /** Ninja rank, progress, and full card deck */
  get_ninja: NinjaData;
  /** State of all Dojo mats — keys are mat IDs, values are seat arrays */
  get_waddles: { waddles: MatState };
  /** A player sat on or left a Dojo mat */
  update_waddle: { waddle: number; seat: number; username: string | null };
  /** Acknowledged entry into matchmaking queue */
  join_matchmaking: Record<string, never>;
  /** Matchmaking countdown tick with queued player names */
  tick_matchmaking: { tick: number; users: string[] };
  /** Match started — contains both players with seat assignments */
  start_game: { users: GamePlayer[] };
  /** Cards dealt to your hand (initial deal or replacement after a round) */
  set_cards: { cards: GameCard[] };
  /** Enemy card slot indices (card details hidden until round_over) */
  add_enemy_cards: { cards: number[] };
  /** A new round has begun */
  start_round: Record<string, never>;
  /** Cards are now playable — select a card */
  enable_cards: Record<string, never>;
  /** A card was removed from the opponent's visible hand */
  remove_card: { slot: number };
  /** Server acknowledged your card selection */
  move_my_card: { slot: number };
  /** Power card effects applied this round */
  card_effect: { effects: { effect: number; winner: number }[] };
  /** Round result — both cards revealed with winner */
  round_over: RoundResult;
  /** Element animation played (f=fire, w=water, s=snow) */
  play_animation: { animation: string; winner: number };
  /** Game finished — winner seat, winning card UUIDs, and result message */
  game_won: { winner: number; uuid: string[]; message: string };
  /** CPPS.lol-only events. */
  remove_inventory: { id: number | string };
  snowflake_state: {
    windowOpen: boolean;
    lifetimeMs: number;
    type: string | number | null;
  };
  get_pets: {
    userId?: number;
    pets: Puffle[];
  };
  igloo_contest: { active: boolean };
  igloo_likes: {
    iglooId: number;
    likes: number;
    liked: boolean;
    created?: boolean | string;
  };
  marry_request: { id: number };
};

/** CPPS.lol-only commands captured from its signed Socket.IO protocol. */
export type CppslolClientMessages = Pick<
  ClientMessages,
  | "leave_waddle"
  | "remove_inventory"
  | "get_snowflake_state"
  | "accept_mature"
  | "get_pets"
  | "get_igloo_contest"
  | "send_mail"
  | "marry_request"
>;

/** CPPS.lol-only events captured from its signed Socket.IO protocol. */
export type CppslolServerMessages = Pick<
  ServerMessages,
  | "remove_inventory"
  | "snowflake_state"
  | "get_pets"
  | "igloo_contest"
  | "igloo_likes"
  | "marry_request"
>;

/** CPJourney-only commands captured from its Socket.IO protocol. */
export type CpjourneyClientMessages = Pick<
  ClientMessages,
  | "get_puffles"
  | "adopt_puffle"
  | "check_puffle_sprite"
  | "get_all_puffles"
  | "get_wellbeing"
  | "puffle_play"
  | "update_puffle_rest"
  | "puffle_buy_item"
  | "walk_puffle"
  | "backyard_supplies"
  | "buddy_find"
  | "get_store_music"
  | "add_music"
  | "get_igloostore_items"
  | "add_furniture"
  | "update_music"
  | "update_furniture"
  | "update_furniture_auto"
  | "update_igloo"
  | "open_igloo"
  | "close_igloo_bounds"
  | "like_igloo"
  | "igloo_editor_open"
  | "igloo_editor_closed"
  | "open_sprite"
  | "tower_init"
>;

/** CPJourney-only events captured from its Socket.IO protocol. */
export type CpjourneyServerMessages = Pick<
  ServerMessages,
  | "game_over"
  | "get_postcards"
  | "join_igloo"
  | "get_puffles"
  | "adopt_puffle"
  | "get_all_puffles"
  | "get_wellbeing"
  | "get_walking_puffle"
  | "update_wellbeing"
  | "puffle_levelup"
  | "puffle_popup"
  | "buy_puffle_item"
  | "walk_puffle"
  | "backyard_supplies"
  | "buddy_find"
  | "receive_postcard"
  | "get_store_music"
  | "add_music"
  | "get_igloostore_items"
  | "add_furniture"
  | "update_music"
  | "igloo_open_status"
  | "igloo_bounds_status"
  | "igloo_liked"
>;
