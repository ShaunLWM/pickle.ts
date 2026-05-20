import type { Mascot, PlayerData, RoomUser } from "./player-types.js";
import type { QueueUpdate } from "./adapter-types.js";
export type ClientMessages = {
    send_position: {
        x: number;
        y: number;
    };
    send_frame: {
        frame: number;
        set?: boolean;
    };
    send_message: {
        message: string;
    };
    join_room: {
        room: number;
        x?: number;
        y?: number;
    };
    add_item: {
        item: number;
    };
    send_emote: {
        emote: number;
    };
    send_safe: {
        safe: number;
    };
    snowball: {
        x: number;
        y: number;
    };
    buddy_request: {
        id: number;
    };
    buddy_accept: {
        id: number;
    };
    remove_buddy: {
        id: number;
    };
    get_player: {
        id: number;
    };
    add_ignore: {
        id: number;
    };
    remove_ignore: {
        id: number;
    };
    update_color: {
        item: number;
    };
    update_head: {
        item: number;
    };
    update_face: {
        item: number;
    };
    update_neck: {
        item: number;
    };
    update_body: {
        item: number;
    };
    update_hand: {
        item: number;
    };
    update_feet: {
        item: number;
    };
    update_flag: {
        item: number;
    };
    update_photo: {
        item: number;
    };
    get_all_slots: Record<string, never>;
    get_mascots: Record<string, never>;
    get_weather: Record<string, never>;
    join_server: Record<string, never>;
    check_puffle_sprite: {
        puffleSprite: unknown;
    };
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
    update_player: {
        id: number;
        item: number;
        slot: string;
    };
    slot: unknown[];
    error: {
        error: number;
    };
};
//# sourceMappingURL=message-types.d.ts.map