# CPPS.lol Adapter Design

## Goal

Add CPPS.lol as a first-class `pickle.ts` server under the public name
`"CPPSlol"`. The implementation must support login, exact server population
values, game connection, the existing shared `Client` actions, and the
CPPS.lol-only packets observed during the authenticated browser capture.

The example must read `CPPSLOL_USERNAME` and `CPPSLOL_PASSWORD` from the
environment. Credentials, tokens, packet keys, and captured account data must
never be committed.

## Architecture

`CppslolAdapter` will extend `BaseAdapter` and follow the JSON Socket.IO flow
used by `PenguinoriginsAdapter`, with CPPS.lol's origin and signed game
transport:

1. Connect to `/world/login/` and send `login` or `token_login`.
2. Map the returned server names and populations without scaling the values.
3. Connect to `/world/{serverName.toLowerCase()}/`.
4. Send unsigned `game_auth`, retain the returned `packetKey`, and send
   unsigned `join_server`.
5. Sign every subsequent client message with a monotonic `seq`, a millisecond
   `ts`, and a SHA-256 HMAC `mac` compatible with the live CPPS.lol client.
6. Clear the packet key and reset the sequence on disconnect or failed
   authentication.

The exact population mapping will carry this source comment:

```ts
// CPPS.lol reports the exact number of penguins online.
// Unlike other CPPS server browsers, this is not a bar/block-based population value.
```

The signer will be a small isolated unit. Its contract is to reproduce a live
CPPS.lol envelope from `{ action, args, seq, ts }` and the `packetKey`; a
deterministic fixture with a non-production key will lock down canonical
serialization, HMAC encoding, sequence increments, and reset behavior.

## Public API

Shared operations remain on `Client` and delegate to normal adapter overrides.
CPPS.lol-only wire methods will exist only on `CppslolAdapter`; they will not be
added to `BaseAdapter`.

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

## Example

Add a small example that:

1. reads the CPPS.lol username and password from environment variables;
2. logs in and prints each exact server population;
3. connects to the selected or first server;
4. prints the loaded player and room;
5. performs harmless movement, emote, and CPPS.lol-specific actions; and
6. disconnects cleanly.

The example must not spend currency, delete inventory, send mail, or create a
relationship request by default.

## Verification

Keep tests focused: one deterministic signer test, one login/connect lifecycle
test, and one action-mapping test covering the custom packet methods. Run the
existing typecheck, test suite, and build to guard the other adapters.

## Acceptance Criteria

- `new Client("CPPSlol")` logs in and returns exact penguin counts.
- Connecting reaches ready state after `load_player` and `join_room`.
- Post-auth messages contain valid increasing `seq`, current `ts`, and `mac`.
- Shared actions use the observed CPPS.lol payloads.
- Captured custom operations are usable through `client.cppslol` but absent
  from `BaseAdapter`.
- The example contains no embedded credentials and avoids destructive or
  spending actions by default.
- Existing adapters continue to typecheck and pass their tests.
