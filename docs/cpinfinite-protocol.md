# CPInfinite protocol notes

Captured from `play.cpinfinite.com` (Ruffle 0.8.0, AS2 client) on 2026-11-27. All values below are synthetic. Raw captures with real credentials live in the gitignored `tmp/cpi-sniff/`.

The server is Houdini, speaking SmartFoxServer classic XML plus `%xt%` packets over WebSocket. The protocol is the same as CPZero, so `CpinfiniteAdapter` extends `CpzeroAdapter`.

## Endpoints

| Purpose | URL |
|---|---|
| Server list | `https://play.cpinfinite.com/servers.xml` |
| Login | `wss://server.cpinfinite.com/login` |
| Marshmallow (id 3100, locale `en`, port 9875) | `wss://server.cpinfinite.com/blizzard` |
| Glaciar (id 3101, locale `es`, port 9876) | `wss://server.cpinfinite.com/glaciar` |
| Avalanche (id 3102, locale `pt`, port 9877) | `wss://server.cpinfinite.com/avalanche` |
| Yeti (id 3103, locale `fr`, port 9878) | `wss://server.cpinfinite.com/yeti` |

- **Mapping game servers to paths.** The client's `RufflePlayer.config.socketProxy` maps TCP `host:port` to WS URLs, so game paths are keyed by the servers.xml port, not by the server name.
  - `/marshmallow` returns HTTP 404. Marshmallow is reached at `/blizzard`.
  - The adapter resolves the name to its port, then to the path (`GAME_PATH_BY_PORT`).
- **No Origin header needed.** A probe without an `Origin` header completes `verChk` and `rndK` on `/login` and on every game path.

## Handshake (login and game)

```
>> <msg t='sys'><body action='verChk' r='0'><ver v='253' /></body></msg>
<< <msg t="sys"><body action="apiOK" r="0" /></msg>
>> <msg t='sys'><body action='rndK' r='-1'></body></msg>
<< <msg t="sys"><body action="rndK" r="-1"><k>houdini</k></body></msg>
```

The random key was the constant `houdini` in every capture. Frames are NUL-terminated. Ruffle sends them as binary Blobs, and CDP shows outgoing payloads as empty.

## Login server

```
>> <login z='w1'><nick>USERNAME</nick><pword>LOGIN_HASH</pword></login>
<< %xt%l%-1%101|101|username|LOGINKEY|houdini|0|0%CONFHASH%%3103,0|3102,0|3101,0|3100,0%%email@example.com%
```

- `LOGIN_HASH = swap(md5(swap(md5(password).upper()) + rndK + "Y(02.>'H}t\":E1"))`, where `swap` exchanges the two 16-character halves.
- `args[0]` is the raw login data: `id|id|username|loginKey|houdini|approval|rejection`.
- `args[1]` is the confirmation hash.
- `args[3]` is world populations as `serverId,bars`. These are Houdini bar levels, not user counts. The 0-7 scale is unverified. No endpoint exposes exact online counts.
- `args[5]` is the account email.

## Game server

```
>> verChk, rndK (as above)
>> %xt%s%p#getdigcooldown%-1%          (client sends this before authenticating)
>> <login z='w1'><nick>RAW_LOGIN_DATA</nick><pword>WORLD_HASH#CONFHASH</pword></login>
<< %xt%l%-1%%
<< %xt%loadcurroutfit%-1%{"slot1":{...},"slot2":{...}}%     (CPI-specific JSON outfit slots)
>> %xt%s%j#js%-1%101%LOGINKEY%en%
<< %xt%pgu%-1%%  %xt%js%-1%0%0%0%0%  %xt%lp%-1%PLAYER%...  %xt%jr%-1%ROOM%PLAYER...
```

`WORLD_HASH = swap(md5(loginKey + rndK)) + loginKey`. This was verified against a capture.

### Post-join burst (client to server)

`i#gi`, `l#mst`, `l#mg`, `u#glr`, `g#gii`, `b#gb`, `n#gn`, `u#gabcms`, `nx#gas`, `nx#pcos`, `nx#mcs`, `f#epfga`, `i#qpa`, `p#pgpi`, `f#epfgr`, `u#sp`, `j#crl`

## Packets observed

### Client to server

| Packet | Args | Notes |
|---|---|---|
| `j#jr` | room, x, y | x and y are 0 when entering from the map |
| `u#sp` | x, y | |
| `u#se` | emote | |
| `u#sa` | action | Echoed as `sa` |
| `u#sb` | x, y | Snowball |
| `u#h` | none | Heartbeat |
| `u#pbi` | playerId | Player card info |
| `g#pio` | playerId | Echo `pio%1` or `pio%0`. Meaning unverified |
| `g#uiss`, `g#im`, `t#rt`, `u#gbffl`, `g#gr` | | Igloo and misc. Meanings unverified |
| `nx#bimp` | `player_id:..|map_duration:..|exit_room_id:..` | Map analytics |
| `p#checkpufflename` | name | |
| `f#epfgm`, `f#epfgr` | | EPF |

No chat (`m#sm`) packet was captured.

### Server to client

| Packet | Notes |
|---|---|
| `lp`, `jr`, `ap`, `sp`, `se`, `sa`, `sb`, `h` | Standard Houdini |
| `upa2` | playerId, item. Inferred to be the `hand2` slot update (see Player string) |
| `uph`, `upp` | Head and photo updates |
| `ai` | item, then a second number. Whether that is the coin balance is unverified |
| `at`, `rt` | playerId (+ n). Meaning unverified |
| `jp`, `gm`, `ggd`, `gili`, `cli`, `gail`, `gaili`, `uvi` | Igloo |
| `getmymusictracks`, `pg` | Music and puffles |

### Player string

`id|nickname|approval|color|head|face|neck|body|hand|feet|flag|photo|x|y|frame|member|memberDays|...||||||L:a,b,c,d,e,f`

Inferred from the capture, not confirmed: the `L:` field holds the six CPI-only slots in `loadcurroutfit` key order: `hair, beak, back, body2, hand2, mount`. Evidence:

- `lp` had `L:0,0,0,0,N,0`, and N appeared in `gi` (inventory).
- After `upa2%playerId%0`, every later player string had `L:0,0,0,0,0,0`.
- `loadcurroutfit` slots contain exactly these six extra keys beyond the vanilla nine.

The pickle.js translator handles neither `L:` nor the slot packets (`upc`, `uph`, `upa2`, `upp`, ...). See Open items.

## Open items

- **Slot updates not translated.** Inbound slot updates (`uph`, `upp`, `upa2`, etc.) produce no `update_player` message. The translator only handles a generic `up`. This affects CPZero too.
- **Population clamp.** `population` is the Houdini bar level clamped to a minimum of 1 (inherited from CPZero), so idle worlds that report 0 appear as 1.

## HTTP

- `/servers.xml`: the server list above.
- `/services`: static config.
- `/datatech/serverlog`: returns 404.

No population or analytics endpoint returns counts.
