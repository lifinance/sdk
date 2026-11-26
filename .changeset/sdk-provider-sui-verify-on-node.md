---
"@lifi/sdk-provider-sui": minor
---

A resumed Sui transaction now verifies its stored signature on a node. zkLogin signatures (for example Slush social login) and address-alias signatures now pass, so the SDK can send the stored transaction again after a page reload.
