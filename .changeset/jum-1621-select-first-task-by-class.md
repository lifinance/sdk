---
'@lifi/sdk-provider-bitcoin': patch
'@lifi/sdk-provider-ethereum': patch
'@lifi/sdk-provider-solana': patch
'@lifi/sdk-provider-stellar': patch
'@lifi/sdk-provider-sui': patch
'@lifi/sdk-provider-tron': patch
---

Pick the first pipeline task by class reference instead of by class name. In builds that mangle class names, a step could start or resume at the wrong task — for example, an unneeded `approve()` before a native-token swap.
