# CPPS.lol Adapter Design

## Goal

Add CPPS.lol as a first-class `pickle.ts` server under the public name
`"CPPSlol"`. The implementation must support login, browser population bars
and exact user counts, game connection, the existing shared `Client` actions,
and the CPPS.lol-only packets observed during the authenticated browser
capture.

The example must read `CPPSLOL_USERNAME` and `CPPSLOL_PASSWORD` from the
environment. Credentials, tokens, packet keys, and captured account data must
never be committed.

## Architecture

`CppslolAdapter` will extend `BaseAdapter` and follow the JSON Socket.IO flow
used by `PenguinoriginsAdapter`, with CPPS.lol's origin and signed game
transport:

1. Connect to `/world/login/` and send `login` or `token_login`.
2. Map the returned server names with the browser bar count in `population`
   and the exact penguin count in the CPPS.lol-only `users` field.
3. Connect to `/world/{serverName.toLowerCase()}/`.
4. Send unsigned `game_auth`, retain the returned `packetKey`, and send
   unsigned `join_server`.
5. Sign every subsequent client message with a monotonic `seq`, a millisecond
   `ts`, and a SHA-256 HMAC `mac` compatible with the live CPPS.lol client.
6. Clear the packet key and reset the sequence on disconnect or failed
   authentication.

The exact population mapping will carry this source comment:

```ts
// CPPS.lol's population value is the bar count shown in its server browser.
// `users` is the exact number of penguins online.
```

The signer will be a small isolated unit. Its contract is to reproduce a live
CPPS.lol envelope from `{ action, args, seq, ts }` and the `packetKey`; a
deterministic fixture with a non-production key will lock down canonical
serialization, HMAC encoding, sequence increments, and reset behavior.

## Public API

Shared operations remain on `Client` and delegate to normal adapter overrides.
CPPS.lol-only wire methods will exist only on `CppslolAdapter`; they will not be
added to `BaseAdapter`.

`open_igloo` is the exception to the shared-method rule: CPPS.lol does not send
the `igloo_open_status` acknowledgement expected by `Client.openIgloo()`.
`client.cppslol.openIgloo()` will therefore call a CPPS.lol-only raw adapter
method, while the shared method remains unsupported instead of timing out.

A narrow `client.cppslol` capability object will expose the custom operations
without widening the base adapter contract. Invoking it on another server will
raise the existing non-retryable `unsupported_operation` error.

The captured custom surface includes:

- packed emotes (`pack`, `emote`)
- mature-server acknowledgement
- inventory removal
- snowflake state
- pets
- igloo contest state
- igloo likes and liking an igloo by `iglooId`
- mail
- marriage requests
- leaving a waddle

Captured server actions will receive CPPS.lol-specific message types and typed
event delivery. Existing shared methods such as movement, room joins, item
purchases, clothing updates, frames, snowballs, safe chat, and igloo joins will
be normalized through `CppslolAdapter`.

## Error Handling

Login, transport, authentication, queue, abort, and disconnect failures will
use the existing lifecycle and `ClientOperationError` categories. As with the
other adapters, attempting to send before the game socket is authenticated
will throw synchronously. Authentication failure and disconnect must erase
signing state before control returns to the caller.

For token login, the adapter will retain the supplied token only in private
session state and pass it to `game_auth`. The token is cleared with the signing
state and is never logged or returned through the public API.

## State Synchronization

Inbound `update_player` packets will update ordinary top-level appearance slots
or adapter-specific fields under `RoomUser.meta`, including CPPS.lol layered
slots such as `headLayer`. CPPS.lol `add_item` and `remove_inventory` responses
will also update the normalized player inventory, and captured total-coin
values from `add_item` will update the normalized coin balance.

## Example

Add a dependency-free `examples/cpps-lol-basic.mjs` example and an npm command
that builds the package before running it. The example will:

1. read the CPPS.lol username and password from environment variables;
2. log in and print each server's browser bars and exact user count;
3. connect to the selected or first server;
4. print the loaded player and room;
5. perform harmless movement, emote, and CPPS.lol-specific actions; and
6. disconnect cleanly.

The example must not spend currency, delete inventory, send mail, or create a
relationship request by default.

## Verification

Keep tests focused: one deterministic signer test, login/connect lifecycle and
token propagation tests, an action-mapping test, facade isolation coverage,
and state synchronization coverage for layered equipment and inventory. Run
the live password-login action flow, existing typecheck, test suite, and build
to guard the other adapters.

## Acceptance Criteria

- `new Client("CPPSlol")` logs in and returns browser bars plus exact penguin
  counts.
- Connecting reaches ready state after `load_player` and `join_room`.
- Post-auth messages contain valid increasing `seq`, current `ts`, and `mac`.
- Shared actions use the observed CPPS.lol payloads.
- Captured custom operations are usable through `client.cppslol` but absent
  from `BaseAdapter`.
- Layered appearance and inventory mutations keep normalized client state in
  sync.
- The dependency-free example is runnable through its npm command, contains no
  embedded credentials, and avoids destructive or spending actions by default.
- Existing adapters continue to typecheck and pass their tests.
