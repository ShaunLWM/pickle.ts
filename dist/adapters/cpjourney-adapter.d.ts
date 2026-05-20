import { type Socket } from "socket.io-client";
import type { LoginOptions, LoginResult, TokenLoginOptions } from "../types/adapter-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";
export declare class CpjourneyAdapter extends BaseAdapter {
    readonly id = "CPJourney";
    login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult>;
    connect(serverName: string, loginResult: LoginResult, options?: ConnectOptions): Promise<Socket>;
    send(action: string, args: Record<string, unknown>): void;
    disconnect(): void;
    private createSocket;
}
//# sourceMappingURL=cpjourney-adapter.d.ts.map