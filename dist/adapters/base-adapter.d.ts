import type { Socket } from "socket.io-client";
import type { LoginOptions, LoginResult, QueueUpdate, TokenLoginOptions } from "../types/adapter-types.js";
export type ConnectOptions = {
    onQueueUpdate?: (update: QueueUpdate) => void;
};
export declare abstract class BaseAdapter {
    abstract readonly id: string;
    protected socket: Socket | null;
    abstract login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult>;
    abstract connect(serverName: string, loginResult: LoginResult, options?: ConnectOptions): Promise<Socket>;
    abstract disconnect(): void;
    abstract send(action: string, args: Record<string, unknown>): void;
    sendMessage(message: string): void;
    sendEmote(emote: number): void;
    sendSafe(safe: number): void;
    walk(x: number, y: number): void;
    sendFrame(frame: number, set?: boolean): void;
    snowball(x: number, y: number): void;
    joinRoom(room: number, x?: number, y?: number): void;
    addItem(item: number): void;
    equipColor(item: number): void;
    equipHead(item: number): void;
    equipFace(item: number): void;
    equipNeck(item: number): void;
    equipBody(item: number): void;
    equipHand(item: number): void;
    equipFeet(item: number): void;
    equipFlag(item: number): void;
    equipPhoto(item: number): void;
    buddyRequest(id: number): void;
    buddyAccept(id: number): void;
    removeBuddy(id: number): void;
    addIgnore(id: number): void;
    removeIgnore(id: number): void;
    getPlayer(id: number): void;
    getAllSlots(): void;
    getMascots(): void;
}
//# sourceMappingURL=base-adapter.d.ts.map