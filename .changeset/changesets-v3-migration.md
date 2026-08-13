---
---

Release-less on purpose. The Changesets v3 / `changesets/action` v2 migration touches
publishable package dirs only to regenerate the committed `src/version.ts` files, which
`changeset:prepublish` already regenerated at publish time — so no package needs a bump.
