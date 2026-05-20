import { io } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";
import { BaseAdapter } from "./base-adapter.js";
const BASE_URL = "wss://play.cpjourney.net";
const DEFAULT_SECRET = "skip";
export class CpjourneyAdapter extends BaseAdapter {
    id = "CPJourney";
    async login(options) {
        const loginSocket = this.createSocket("/world/login/");
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                loginSocket.disconnect();
                reject(new Error("Login timed out"));
            }, 10_000);
            loginSocket.on("connect", () => {
                const secret = options.secret ?? DEFAULT_SECRET;
                const args = "token" in options
                    ? { username: options.username, token: options.token, secret }
                    : { username: options.username, password: options.password, secret };
                loginSocket.emit("message", { action: "login", args });
            });
            loginSocket.on("message", (msg) => {
                if (msg.action !== "login")
                    return;
                clearTimeout(timeout);
                loginSocket.disconnect();
                const response = msg.args;
                if (!response.success) {
                    reject(new Error("Login failed"));
                    return;
                }
                const servers = Object.entries(response.populations).map(([name, population]) => ({ name, population }));
                resolve({
                    servers,
                    key: response.key,
                    username: response.username,
                    moderator: response.moderator,
                    buddyWorlds: response.buddyWorlds ?? [],
                });
            });
            loginSocket.on("connect_error", (err) => {
                clearTimeout(timeout);
                loginSocket.disconnect();
                reject(new Error(`Login connection failed: ${err.message}`));
            });
        });
        return result;
    }
    async connect(serverName, loginResult, options) {
        const gameSocket = this.createSocket(`/world/${serverName.toLowerCase()}/`);
        this.socket = gameSocket;
        await new Promise((resolve, reject) => {
            let authSent = false;
            gameSocket.on("connect", () => {
                gameSocket.emit("message", {
                    action: "game_auth",
                    args: {
                        username: loginResult.username,
                        key: loginResult.key,
                        createToken: false,
                        joinInvis: false,
                        takeoverMascot: false,
                        token: "",
                    },
                });
            });
            gameSocket.on("message", (msg) => {
                switch (msg.action) {
                    case "wait_queue_update": {
                        options?.onQueueUpdate?.(msg.args);
                        break;
                    }
                    case "game_auth": {
                        if (authSent)
                            break;
                        authSent = true;
                        const response = msg.args;
                        if (!response.success) {
                            gameSocket.disconnect();
                            reject(new Error("Game auth failed"));
                            return;
                        }
                        gameSocket.emit("message", { action: "join_server", args: {} });
                        resolve();
                        break;
                    }
                }
            });
            gameSocket.on("connect_error", (err) => {
                gameSocket.disconnect();
                reject(new Error(`Game connection failed: ${err.message}`));
            });
        });
        return gameSocket;
    }
    send(action, args) {
        if (!this.socket)
            throw new Error("Not connected");
        this.socket.emit("message", { action, args });
    }
    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
    }
    createSocket(path) {
        return io(BASE_URL, {
            path,
            parser: msgpackParser,
            transports: ["polling", "websocket"],
            reconnection: false,
        });
    }
}
//# sourceMappingURL=cpjourney-adapter.js.map