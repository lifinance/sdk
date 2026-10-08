---
"@lifi/sdk-provider-ethereum": patch
---

After a user rejected a single-call EIP-5792 bundle in MetaMask, every "Try again" failed with "This bundle id is unknown". The wallet showed no new prompt. MetaMask returns the bundle id before the user approves the bundle. When the user rejects the bundle, MetaMask removes it.

Now, when the wallet reports the bundle and then has no record of it in the same wait, the step fails with `SignatureRejected`. The action keeps no bundle id, and "Try again" signs a new bundle. The SDK accepts this proof only for 10 minutes after signing. Some wallets get the bundle status from a remote service, and that service can forget an old bundle.

If a wallet sends a bundle and then loses its record of it within 10 minutes of signing, "Try again" can sign a second bundle. Examples are "Clear activity" or "Reset account" in MetaMask, or a remote status service that forgets the bundle.

When the wallet has no record of the bundle at its first answer, the step fails with the new code `LiFiErrorCode.CallBundleNotFound`. A page reload after the reject is an example. The step also fails with this code when the wallet loses the bundle 10 minutes or more after signing. The SDK cannot know if the wallet sent this bundle. Thus the action keeps the bundle id, and "Try again" waits for the bundle again and does not sign. A route that is stuck after a reject on 4.11.0 fails with `CallBundleNotFound` on its next "Try again".
