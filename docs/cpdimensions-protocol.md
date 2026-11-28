# CPDimensions protocol notes

Captured from the CPDimensions desktop client (Electron, PepperFlash, AS2) on 2026-11-28 with `tcpdump` and a CDP HTTP recorder. All values below are synthetic. Raw captures with real credentials live in the gitignored `tmp/cpd-sniff/`.

The server is Houdini, speaking SmartFoxServer classic XML plus `%xt%` packets. Unlike CPZero and CPInfinite, transport is **raw TCP**, not WebSocket: Flash talks to the servers directly. Frames are NUL-terminated in both directions, and TCP freely splits or merges them. Hashing and packet flow match CPZero, so `CpdimensionsAdapter` extends `CpzeroAdapter` and only swaps the socket (`TcpFrameSocket`) and server resolution.

## Endpoints

From `https://play.cpdimensions.com/servers.xml` (locale `pt`):

| Purpose | Address |
|---|---|
| Login | `38.242.207.218:6112` |
| Dimensão Primária (id 3101) | `38.242.207.218:9875` |
| Security Dimension (id 3102, `safe="true"`) | `38.242.207.218:9876` |
| Gravações Dimensionais (id 3104) | `38.242.207.218:9878` |

- **Server 3103** appears in the login reply's population list but not in servers.xml. The client hides it. The adapter reports it as `Server 3103`.
- **Cloudflare.** `play.cpdimensions.com` (servers.xml, `/pt/`, favicon) answers non-browser clients with HTTP 403 `Just a moment...` (`cf-mitigated: challenge`). This was confirmed for curl with default and browser user agents, and for Node `fetch`. The desktop app gets through, presumably because it solves the challenge in its embedded Chromium.
  - The adapter therefore carries the table above as a fallback. A live servers.xml replaces it whenever one gets through.
  - `vanilla.cpdimensions.com` (media) is not gated.
- **Policy file.** Before every connection, the client sends `<policy-file-request/>\0` and the server answers with a `<cross-domain-policy>`. The adapter skips it, and the server accepts `verChk` without it.

## Handshake (login and game)

```
>> <msg t='sys'><body action='verChk' r='0'><ver v='253' /></body></msg>
<< <msg t="sys"><body action="apiOK" r="0" /></msg>
>> <msg t='sys'><body action='rndK' r='-1'></body></msg>
<< <msg t="sys"><body action="rndK" r="-1"><k>KEY&amp;WITH&amp;AMPERSANDS</k></body></msg>
```

- **The random key is a constant.** It was the same 32-character string in every capture, on both login and game servers, and it contains `&`.
- **The key arrives XML-escaped.** Hashes must use the unescaped key. Hashing the raw `&amp;` form gives `%xt%e%-1%101%` (incorrect password). `parseRandomKey` in `cpzero-adapter.ts` unescapes the five XML entities.

## Login server

```
>> <msg t='sys'><body action='login' r='0'><login z='w1'><nick><![CDATA[username]]></nick><pword><![CDATA[LOGIN_HASH]]></pword></login></body></msg>
<< %xt%l%-1%101|101|username|LOGINKEY|houdini|3|0%CONFHASH%%3103,8|3104,8|3101,0|3102,0%%email@example.com%
```

- `LOGIN_HASH = swap(md5(swap(md5(password).upper()) + rndK + "Y(02.>'H}t\":E1"))`, where `swap` exchanges the two 16-character halves. This was verified against the capture.
- `args[0]` is the raw login data: `id|id|username|loginKey|houdini|approval|rejection`.
- `args[1]` is the confirmation hash.
- `args[3]` is world populations as `serverId,bars`.
  - **Population 8** is shown as **PRIVADO**. Picking such a world makes the client show `c103` ("Esse servidor está cheio") without opening a connection. This is inferred from the capture: no TCP connection followed. The value appears to mark private or closed worlds, not a full one.
  - The adapter reports the raw bar level, clamped to a minimum of 1 (inherited from CPZero).
- `args[5]` is the account email.
- **Errors:** `%xt%e%-1%101%` for an incorrect password.

## Game server

```
>> <policy-file-request/>, verChk, rndK (as above)
>> <login z='w1'><nick>RAW_LOGIN_DATA</nick><pword>WORLD_HASH#CONFHASH</pword></login>
<< %xt%l%-1%%
>> %xt%s%j#js%-1%101%LOGINKEY%pt%
<< %xt%js%-1%0%0%0%0%  %xt%lp%-1%PLAYER%COINS%...  %xt%jr%-1%10009%PLAYER...
```

- `WORLD_HASH = swap(md5(loginKey + rndK)) + loginKey`. This was verified against the capture.
- **Join language** is `pt`, as sent by the client.
- **Spawn room** after `j#js` is 10009, not a town room.
- The client sends `p#getdigcooldown` immediately before `j#js` (both captures), as on CPI.

### Post-join burst (client to server)

`i#gi`, `l#mst`, `l#mg`, `u#glr`, `g#gii`, `b#gb`, `n#gn`, `u#gabcms`, `nx#gas`, `nx#pcos`, `nx#mcs`, `f#epfga`, `i#qpa`, `p#pgpi`, `f#epfgr`, `st#gps`, `st#gsbcd`, `outfit#get`, `staffchat#lertudo`, `j#crl`

Server replies of note:

- `mg`: mail entries are `sender|0|postcardType||timestamp|mailId|read`. System mail uses sender `sys`.
- `glr%houdini`, `gs`, `pbr`, `gc`, `pgpi`.
- `initNormalServerJump`.
- `nxquestsettings` and `nxquestdata` carry JSON payloads.
- `outfitupdate` carries a JSON array of saved outfits.
- `staffchatupdate`.

## Packets observed

### Client to server

| Packet | Args | Notes |
|---|---|---|
| `m#sm` | playerId, message | Chat. Echoed as `sm%playerId%message` |
| `j#jr` | room, x, y | |
| `j#jp` | playerId, `igloo` | Igloo join. Reply `jp%room%room%igloo` with room `2000 + playerId`, then `jr` |
| `u#sp` | x, y | |
| `u#se` | emote | |
| `u#sf` | frame | |
| `u#sb` | x, y | Snowball |
| `u#h` | none | Heartbeat |
| `u#pbi`, `u#pbsu` | playerId / id list | Player info. `pbsu` returns names for an id list |
| `s#upp`, `s#uph` | item | Photo and head. Echoed as `upp%playerId%item`, `uph%playerId%item` |
| `t#at`, `t#rt` | `3`, `1` / none | Open and close the map (`at`/`rt` broadcast) |
| `st#sse` | stampId | Stamp earned. Reply `aabs%stampId` |
| `st#gps`, `st#gmres`, `st#gsbcd` | playerId | Stamps, recent stamps, stampbook cover |
| `b#br` | playerId | Buddy request |
| `l#ms` | playerId, postcardType | Send postcard. Reply `ms%coins%1` |
| `l#mc` | none | Mail checked |
| `i#qpp` | playerId | Pins. Reply `qpp%item\|timestamp\|0%...` |
| `g#gr` | none | Open igloo list. Reply `gr%0%0%id\|name\|n\|0\|0%...` |
| `g#gm`, `g#gii`, `g#ggd`, `g#gili`, `g#cli`, `g#li` | | Igloo. `gm` layout is `id:type:music:floor:location:...` |
| `musictrack#getmymusictracks` | | |
| `p#pg` | playerId, `igloo` | Puffles in an igloo |
| `g#pio` | playerId | Reply `pio%1` or `pio%0`. Meaning unverified |
| `nx#bimp` | analytics | |
| `outfit#get`, `staffchat#lertudo` | | CPD-specific |

### Server to client

| Packet | Notes |
|---|---|
| `lp`, `jr`, `ap`, `rp`, `sp`, `se`, `sf`, `sb`, `sm`, `h` | Standard Houdini |
| `upp`, `uph` | Slot updates. Not translated by pickle.js (see CPI notes) |
| `aabs` | Stamp awarded |
| `puffledig` | playerId, item, ... |
| `pgu` | Empty, sent after world auth |
| `e` | Error code, e.g. `101` |

## Adapter coverage

- Login, world join, chat (`sm`), movement, and room joins go through the shared CPZero translator.
- A live test on 2026-11-28 logged in, joined Dimensão Primária, walked, and joined room 100.
- HTTP CONNECT and SOCKS5/5h proxies tunnel both login and game connections (`proxy-tunnel.ts`).

## Open items

- **servers.xml cannot be fetched outside a browser.** If CPD adds or moves worlds, the fallback table in `cpdimensions-adapter.ts` needs updating.
- **Population 8 = PRIVADO** is inferred from the UI, not confirmed with the server.
- **CPD-specific packets are not translated**: `outfitupdate`, `staffchatupdate`, `nxquest*`, `aabs` and `initNormalServerJump`.
