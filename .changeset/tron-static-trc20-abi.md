---
'@lifi/sdk-provider-tron': patch
---

TRC-20 balance and allowance reads now use a static TRC-20 ABI instead of fetching the token contract from the node. This saves one request per read, stops TronWeb from keeping the ABI and bytecode of every token read (which grew memory without a limit), and makes the reads also work for a token whose on-chain ABI is empty or holds only a proxy's functions.
