# LI.FI SDK - Node Demo

The demo of [our SDK](https://github.com/lifinance/sdk) executes a simple cross chain transfer of 1 USDT from Polygon to xDai using the best bridge it can find.

It needs access to an actual wallet and makes real transactions on chain.

1. First you need to specify your `MNEMONIC` in your enviroment, e.g.
```bash
export MNEMONIC="..."
```

2. Execute the script.

Either the TypeScript version:
```bash
ts-node index.ts
```
Or the Javascript version:
```bash
node index.js
```

3. Sit back, relax and watch the show.

First a route is searched and the script prints out what it found. The property `toAmount` will tell you how much USDT will end up on xDAI.
 Then the SDK will execute all nessesarry steps to do the transfer (approval, send Transaction, wait the bridge, claim, ... ). It prints out status updates for each of these steps
 
Sample output:
```bash
{
  route: {
    id: '0xcae9da9a53573ee1b5f81f6fe7ebfcb49945a082455fa2be3662b44434cd156b',
    fromChainId: 137,
    fromAmountUSD: '1.00',
    fromAmount: '1000000',
    fromToken: {
      id: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      symbol: 'USDT',
      decimals: 6,
      chainId: 137,
      name: '(PoS) Tether USD',
      chainKey: 'pol',
      key: 'USDT',
      priceUSD: '1',
      logoURI: 'https://static.debank.com/image/matic_token/logo_url/0xc2132d05d31c914a87c6611c10748aeb04b58e8f/66eadee7b7bb16b75e02b570ab8d5c01.png'
    },
    toChainId: 100,
    toAmountUSD: '0.85',
    toAmount: '851698',
    toAmountMin: '851698',
    toToken: {
      id: '0x4ecaba5870353805a9f068101a40e0f32ed605c6',
      symbol: 'USDT',
      decimals: 6,
      chainId: 100,
      name: 'Tether USD on xDai',
      chainKey: 'dai',
      key: 'USDT',
      priceUSD: '1',
      logoURI: 'https://static.debank.com/image/xdai_token/logo_url/0x4ecaba5870353805a9f068101a40e0f32ed605c6/66eadee7b7bb16b75e02b570ab8d5c01.png'
    },
    gasCostUSD: '0.01',
    steps: [ [Object] ]
  }
}

{ status: 'NOT_STARTED', process: [] }
{
  status: 'PENDING',
  process: [
    {
      id: 'allowanceProcess',
      startedAt: 1638960397132,
      message: 'Set Allowance for USDT',
      status: 'PENDING'
    }
  ]
}
...
{
  status: 'DONE',
  process: [
    {
      id: 'allowanceProcess',
      startedAt: 1638960397132,
      message: 'Already Approved',
      status: 'DONE',
      doneAt: 1638960397438
    },
    {
      id: 'crossProcess',
      startedAt: 1638960397438,
      message: 'Transfer started: ',
      status: 'DONE',
      txHash: '0xfc8f43109ccdd7ea6446b770e99b0e3e449ebb13b0d07aae3553bb10994ac24d',
      txLink: 'https://polygonscan.com/tx/0xfc8f43109ccdd7ea6446b770e99b0e3e449ebb13b0d07aae3553bb10994ac24d',
      doneAt: 1638960430378
    },
    {
      id: 'claimProcess',
      startedAt: 1638960430378,
      message: 'Swapped:',
      status: 'DONE',
      txHash: '0x55b2472502a6e7768eea47add832d06f5c7083ff2a808e5648985197bd84ed04',
      txLink: 'https://blockscout.com/xdai/mainnet/tx/0x55b2472502a6e7768eea47add832d06f5c7083ff2a808e5648985197bd84ed04',
      doneAt: 1638960852668
    }
  ],
  fromAmount: '1000000',
  toAmount: '851698'
}
DONE
```
