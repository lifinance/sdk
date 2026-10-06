---
'@lifi/sdk-provider-sui': patch
---

Sui calls and `getSuiBalance` now use only the RPC URLs of their own SDK client. A call no longer tries every Sui RPC URL that any SDK client in the process has used, and two SDK clients no longer share an in-flight balance read; either could send a request to another tenant's URL and API key. The Sui client cache now holds at most 64 clients.
