import type { QueueUpdate } from "./adapter-types.js";
import type { Mascot, PlayerData, Postcard, RoomUser } from "./player-types.js";

export type ClientMessages = {
  send_position: { x: number; y: number };
  send_frame: { frame: number; set?: boolean };
  send_message: { message: string };
  join_room: { room: number; x?: number; y?: number };
  add_item: { item: number };
  send_emote: { emote: number };
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
  check_puffle_sprite: { puffleSprite: unknown };
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
    item: number;
    coins: number;
  };
  get_postcards: {
    postcards: Postcard[];
  };
  get_igloo_open: {
    open: boolean;
  };
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
  disconnect: undefined;
};
