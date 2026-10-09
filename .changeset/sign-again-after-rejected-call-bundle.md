---
"@lifi/sdk-provider-ethereum": patch
---

After a user rejected a single-call EIP-5792 bundle in MetaMask, every "Try again" failed with "This bundle id is unknown". The wallet showed no new prompt. MetaMask returns the bundle id before the user approves the bundle. When the user rejects the bundle, MetaMask removes it.

Now the SDK uses a new rule for a bundle with one call. If the wallet reports the bundle and then has no record of it in the same wait, the SDK treats the bundle as never sent. The step fails with a final `SignatureRejected`. The action keeps the bundle id with `txFinal: true`, so the action is closed, and "Try again" signs a new bundle. The SDK uses this rule only for 10 minutes after signing. Some wallets get the bundle status from a remote service, and that service can forget an old bundle.

This rule applies only to a bundle with one call. MetaMask returns the id of a bundle with two or more calls only after it sent the bundle. The action stores the number of calls in `callCount`, so the rule also works after a page reload. A bundle that the SDK stored before this release has no `callCount`, and the rule does not apply to it.

One limit stays for a bundle with one call. If the wallet sends it and then loses its record of it within 10 minutes of signing, "Try again" can sign a second bundle. Examples are "Delete activity and nonce data" or "Reset account" in MetaMask, or a remote status service that forgets the bundle.

When the wallet has no record of the bundle at its first answer, the step fails with the new code `LiFiErrorCode.CallBundleNotFound`. A page reload after the reject is an example. The step also fails with this code when the rule does not apply. An example is a wallet that loses the bundle 10 minutes or more after signing. The SDK cannot know if the wallet sent this bundle. Thus the action keeps the bundle id, and "Try again" waits for the bundle again and does not sign. A route that is stuck after a reject on `@lifi/sdk` 4.11.0 fails with `CallBundleNotFound` on its next "Try again".

If an "unknown bundle id" error (5730) reaches the error parser from another call, the step also fails with `CallBundleNotFound`, not with `SignatureRejected`.
