import type { Socket } from "socket.io-client";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type {
  PlayerAppearance,
  PlayerData,
  RoomUser,
} from "../types/player-types.js";

export type ConnectOptions = {
  onQueueUpdate?: (update: QueueUpdate) => void;
};

export abstract class BaseAdapter {
  abstract readonly id: string;
  protected socket: Socket | null = null;

  abstract login(
    options: LoginOptions | TokenLoginOptions,
  ): Promise<LoginResult>;
  abstract connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket>;
  abstract disconnect(): void;
  abstract send(action: string, args: Record<string, unknown>): void;

  normalizeUser(_raw: Record<string, unknown>): RoomUser {
    throw new Error("Not implemented: normalizeUser");
  }

  normalizePlayer(_raw: Record<string, unknown>): PlayerData {
    throw new Error("Not implemented: normalizePlayer");
  }

  protected extractAppearance(raw: Record<string, unknown>): PlayerAppearance {
    return {
      color: (raw.color as number) ?? 0,
      head: (raw.head as number) ?? 0,
      face: (raw.face as number) ?? 0,
      neck: (raw.neck as number) ?? 0,
      body: (raw.body as number) ?? 0,
      hand: (raw.hand as number) ?? 0,
      feet: (raw.feet as number) ?? 0,
      flag: (raw.flag as number) ?? 0,
      photo: (raw.photo as number) ?? 0,
    };
  }

  sendMessage(_message: string): void {
    throw new Error("Not implemented: sendMessage");
  }

  sendEmote(_emote: number): void {
    throw new Error("Not implemented: sendEmote");
  }

  sendSafe(_safe: number): void {
    throw new Error("Not implemented: sendSafe");
  }

  walk(_x: number, _y: number): void {
    throw new Error("Not implemented: walk");
  }

  sendFrame(_frame: number, _set?: boolean): void {
    throw new Error("Not implemented: sendFrame");
  }

  snowball(_x: number, _y: number): void {
    throw new Error("Not implemented: snowball");
  }

  joinRoom(_room: number, _x?: number, _y?: number): void {
    throw new Error("Not implemented: joinRoom");
  }

  addItem(_item: number): void {
    throw new Error("Not implemented: addItem");
  }

  equipColor(_item: number): void {
    throw new Error("Not implemented: equipColor");
  }

  equipHead(_item: number): void {
    throw new Error("Not implemented: equipHead");
  }

  equipFace(_item: number): void {
    throw new Error("Not implemented: equipFace");
  }

  equipNeck(_item: number): void {
    throw new Error("Not implemented: equipNeck");
  }

  equipBody(_item: number): void {
    throw new Error("Not implemented: equipBody");
  }

  equipHand(_item: number): void {
    throw new Error("Not implemented: equipHand");
  }

  equipFeet(_item: number): void {
    throw new Error("Not implemented: equipFeet");
  }

  equipFlag(_item: number): void {
    throw new Error("Not implemented: equipFlag");
  }

  equipPhoto(_item: number): void {
    throw new Error("Not implemented: equipPhoto");
  }

  buddyRequest(_id: number): void {
    throw new Error("Not implemented: buddyRequest");
  }

  buddyAccept(_id: number): void {
    throw new Error("Not implemented: buddyAccept");
  }

  buddyReject(_id: number): void {
    throw new Error("Not implemented: buddyReject");
  }

  buddyRequestSeen(_id: number): void {
    throw new Error("Not implemented: buddyRequestSeen");
  }

  getBuddy(_id: number, _type: "buddies" | "buddyRequests"): void {
    throw new Error("Not implemented: getBuddy");
  }

  removeBuddy(_id: number): void {
    throw new Error("Not implemented: removeBuddy");
  }

  addIgnore(_id: number): void {
    throw new Error("Not implemented: addIgnore");
  }

  removeIgnore(_id: number): void {
    throw new Error("Not implemented: removeIgnore");
  }

  getPlayer(_id: number): void {
    throw new Error("Not implemented: getPlayer");
  }

  getAllSlots(): void {
    throw new Error("Not implemented: getAllSlots");
  }

  getMascots(): void {
    throw new Error("Not implemented: getMascots");
  }

  sendPostcard(_userId: number, _cardId: string): void {
    throw new Error("Not implemented: sendPostcard");
  }

  getStamps(_userId: number): void {
    throw new Error("Not implemented: getStamps");
  }

  getPostcards(): void {
    throw new Error("Not implemented: getPostcards");
  }

  getIglooOpen(_igloo: number): void {
    throw new Error("Not implemented: getIglooOpen");
  }

  joinIgloo(_igloo: number, _x?: number, _y?: number): void {
    throw new Error("Not implemented: joinIgloo");
  }

  gameOver(_coins: number): void {
    throw new Error("Not implemented: gameOver");
  }

  collectStamp(_stamp: number): void {
    throw new Error("Not implemented: collectStamp");
  }
}
