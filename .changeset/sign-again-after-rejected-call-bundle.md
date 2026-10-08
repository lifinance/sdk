---
"@lifi/sdk": minor
"@lifi/sdk-provider-ethereum": patch
---

After a user rejected a single-call EIP-5792 bundle in MetaMask, every "Try again" failed with "This bundle id is unknown". The wallet showed no new prompt. MetaMask returns the bundle ID before the user approves the bundle. When the user rejects the bundle, MetaMask removes it.

Now, when the wallet reports the bundle and then has no record of it in the same wait, the step fails with `SignatureRejected`. The action keeps no bundle ID, and "Try again" signs a new bundle. The SDK accepts this proof only for 10 minutes after signing. Some wallets get the bundle status from a remote service, and that service can forget an old bundle.

The new code `LiFiErrorCode.CallBundleNotFound` (1028) is for a bundle that the wallet has no record of at its first answer. A page reload after the reject is an example. The code is also for a bundle that the wallet loses 10 minutes or more after signing. The SDK cannot know if the wallet sent this bundle. Thus the action keeps the bundle ID, and "Try again" waits for the bundle again and does not sign. A route that is stuck after a reject on 4.11.0 fails with `CallBundleNotFound` on its next "Try again".
