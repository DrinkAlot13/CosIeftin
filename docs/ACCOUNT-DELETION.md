# In-app account deletion — what it needs

**Report only. Not built.** Both stores now require it, and it is a real gap independent of
either: **a person cannot currently delete their own account through any surface we ship.**

---

## 1. What each store actually requires

| | requirement |
|---|---|
| **Apple** | Guideline 5.1.1(v): an app that supports account creation must let the user **initiate deletion from inside the app**. A link to a support page or an e-mail address is explicitly not sufficient. |
| **Google** | Play's Data deletion policy: an app with account creation must offer deletion **in-app** *and* at a **web URL reachable without installing the app**, declared in Play Console. Google additionally wants partial deletion (data without the account) to be distinguishable from full deletion. |

Google's web-URL half is the part people miss, and it is the half a TWA makes easy: the TWA is
the website, so one route satisfies both.

## 2. What we have, and why it is not enough

`npm run erase:user -- --username <name> --write` — GDPR Article 17, proved on real probe accounts.
It deletes `User`, `GroceryList(Item)`, `UserFavorite`, `UserBlocklist`, `UserProductAdd`, and
separately `PriceAlert` by `--telegram <chatId>`.

It is an **operator script**. Someone must e-mail us and someone must run it. GDPR accepts that;
neither store does.

`/confidentialitate` already describes the Telegram chat id as separate data with its own erasure
route, `export-user` says the same, and `tests/erasure-cascade.test.ts` fails the build if a new
model gains a `userId` without `onDelete: Cascade` or without being named in `erase:user`. **The
erasure story itself is sound.** What is missing is a way for the person to trigger it.

## 3. What the endpoint needs

**Authentication.** Session-authenticated, acting only on `session.userId`. It must never accept
a user id, a username, or any identifier from the request body — an endpoint that deletes the
account named in its payload is an account-deletion oracle for anyone with a session.

**Re-authentication.** Password required in the request even though the session is already valid.
Deletion is irreversible and a borrowed unlocked phone is the realistic threat; this is the one
place where asking again is not friction for its own sake.

**Confirmation.** Two steps, and the second must be typed rather than tapped — the Romanian for
"delete" typed into a field, not a second button next to the first. A double-tap is not a
decision.

**It must reuse `erase:user`, not reimplement it.** This is the ONE NAMED CONCEPT rule and it has
teeth here: a second implementation of "everything attached to a person" is one that silently
stops matching the schema, and the thing it would silently stop deleting is somebody's data while
a policy page promises otherwise. The refactor is to lift the body of `erase-user.ts` into
`src/lib/gdpr/erase.ts` exporting `eraseUserById(id, { write })`, leaving the script as a CLI
wrapper. The route then calls the same function the operator does, and
`tests/erasure-cascade.test.ts` keeps guarding both because it reads the schema.

**What it returns.** Sign the session out, then a plain confirmation page — not a redirect to the
home page, which reads as "nothing happened".

**Rate limiting.** Named limit, low. It is authenticated, so this is about repeated password
guesses against the re-auth, not about volume.

**The Telegram case.** `PriceAlert` is keyed by `chatId` and has no `userId` — the two identities
are genuinely unlinked, which is a privacy property rather than an oversight, and both the policy
page and `export-user` already say so. An in-app deletion therefore **cannot** remove a person's
price alerts, and the confirmation screen has to say that in one sentence with the `/bot`
instruction for doing it. Silently leaving them would make the deletion incomplete; silently
deleting them would require a link we deliberately do not keep.

## 4. Scope

One route, one lib extraction, one confirmation page, one test that the route refuses an
unauthenticated caller and refuses a body-supplied id. Perhaps half a day.

**Not urgent on its own** — `User` has few rows and no one has asked. It becomes blocking the
moment either store submission starts, which is why it is written down now rather than
discovered during review.
