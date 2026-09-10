# What this extension sends, and what it does not

One sentence: **it sends the address of the product page you are looking at, and nothing else.**

## What is sent

When you open a product page at one of the thirteen shop domains listed in the manifest, the
extension makes **one** request to `https://<cosmic>/api/v1/lookup?url=<the page URL>`.

That is the entire payload. The URL identifies a product; that is why it is sent.

## What is NOT sent, and is not collected in the first place

- **No browsing history.** The extension only runs on the shop domains named in the manifest.
  It cannot see any other tab, and it is not loaded on any other site.
- **No page content.** It does not read the page's text, your cart, your account, or anything
  you type. It reads `location.href` and stops.
- **No user identifier.** No cookie is set, no account is required, no id is generated and
  stored. Two visits from the same browser are indistinguishable to the server.
- **No analytics.** There is no telemetry, no error reporting service, no third-party script.
- **Nothing on pages that are not shops.** There is no `<all_urls>` permission and there never
  will be — host permissions are listed one domain at a time, and adding a domain is a visible
  change a reviewer and the browser both show you.

## Storage

The `storage` permission is used for one thing: remembering that you closed the panel, so it
stays closed. That value never leaves your browser.

## Why the permissions look the way they do

`host_permissions` names thirteen domains rather than asking for everything, because the
extension genuinely cannot work anywhere else — there is no comparison to show on a site whose
prices we do not hold. A permission you cannot justify is one you should not ask for.
