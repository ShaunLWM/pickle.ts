import type { Socket } from "socket.io-client"
import type { LoginOptions, LoginResult, QueueUpdate, TokenLoginOptions } from "../types/adapter-types.js"

export type ConnectOptions = {
  onQueueUpdate?: (update: QueueUpdate) => void
}

export abstract class BaseAdapter {
  abstract readonly id: string
  protected socket: Socket | null = null

  abstract login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult>
  abstract connect(serverName: string, loginResult: LoginResult, options?: ConnectOptions): Promise<Socket>
  abstract disconnect(): void
  abstract send(action: string, args: Record<string, unknown>): void

  sendMessage(message: string): void {
    this.send("send_message", { message })
  }

  sendEmote(emote: number): void {
    this.send("send_emote", { emote })
  }

  sendSafe(safe: number): void {
    this.send("send_safe", { safe })
  }

  walk(x: number, y: number): void {
    this.send("send_position", { x, y })
  }

  sendFrame(frame: number, set?: boolean): void {
    this.send("send_frame", { frame, set })
  }

  snowball(x: number, y: number): void {
    this.send("snowball", { x, y })
  }

  joinRoom(room: number, x?: number, y?: number): void {
    this.send("join_room", { room, x: x ?? 0, y: y ?? 0 })
  }

  addItem(item: number): void {
    this.send("add_item", { item })
  }

  equipColor(item: number): void {
    this.send("update_color", { item })
  }

  equipHead(item: number): void {
    this.send("update_head", { item })
  }

  equipFace(item: number): void {
    this.send("update_face", { item })
  }

  equipNeck(item: number): void {
    this.send("update_neck", { item })
  }

  equipBody(item: number): void {
    this.send("update_body", { item })
  }

  equipHand(item: number): void {
    this.send("update_hand", { item })
  }

  equipFeet(item: number): void {
    this.send("update_feet", { item })
  }

  equipFlag(item: number): void {
    this.send("update_flag", { item })
  }

  equipPhoto(item: number): void {
    this.send("update_photo", { item })
  }

  buddyRequest(id: number): void {
    this.send("buddy_request", { id })
  }

  buddyAccept(id: number): void {
    this.send("buddy_accept", { id })
  }

  buddyReject(id: number): void {
    this.send("buddy_reject", { id })
  }

  buddyRequestSeen(id: number): void {
    this.send("buddy_request_seen", { id })
  }

  getBuddy(id: number, type: "buddies" | "buddyRequests"): void {
    this.send("get_buddy", { id, type })
  }

  removeBuddy(id: number): void {
    this.send("remove_buddy", { id })
  }

  addIgnore(id: number): void {
    this.send("ignore_add", { id })
  }

  removeIgnore(id: number): void {
    this.send("ignore_remove", { id })
  }

  getPlayer(id: number): void {
    this.send("get_player", { id })
  }

  getAllSlots(): void {
    this.send("get_all_slots", {})
  }

  getMascots(): void {
    this.send("get_mascots", {})
  }

  sendPostcard(userId: number, cardId: string): void {
    this.send("send_postcard", { userId, cardId })
  }

  getStamps(userId: number): void {
    this.send("get_stamps", { userId })
  }

  getPostcards(): void {
    this.send("get_postcards", {})
  }

  getIglooOpen(igloo: number): void {
    this.send("get_igloo_open", { igloo })
  }

  joinIgloo(igloo: number, x?: number, y?: number): void {
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 })
  }

  gameOver(coins: number): void {
    this.send("game_over", { coins })
  }

  collectStamp(stamp: number): void {
    this.send("collect_stamp", { stamp })
  }
}
