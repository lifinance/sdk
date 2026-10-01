---
'@lifi/sdk-provider-bitcoin': patch
'@lifi/sdk-provider-ethereum': patch
'@lifi/sdk-provider-solana': patch
'@lifi/sdk-provider-stellar': patch
'@lifi/sdk-provider-sui': patch
'@lifi/sdk-provider-tron': patch
---

Select the first pipeline task by class reference instead of by class name, so a step
resumes at the right task in minified builds that rename classes. An unknown first task
now throws instead of running only the last task.
