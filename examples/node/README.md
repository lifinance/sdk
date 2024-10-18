# LI.FI SDK - Node Demo Examples

This project presents a number of demos for [our SDK](https://github.com/lifinance/sdk) that you can run from the command line.

They use our SDK, along with [viem](https://viem.sh/), to execute common work flows in node.js

These scripts need to be provided access to an actual wallet and will make real transactions on chains.

To run these examples you will need a private key for your wallet and enough funds for the tokens and chains that these scripts use.

Take a look at the scripts in the `./examples` folder.

## Setting up the scripts to use your wallet

- First you will need to obtain the private key for your wallet
- Then duplicate the `.env-template` file renaming it to `.env`
- Add your private key to your `.env` file - replacing the text in quote marks with your private key

NOTE: it's important to keep your private key safe and secure. Don't share it with anyone and make sure you never commit it to a git repository.

## Executing the scripts

First install the dependencies

```
pnpm i
```

Each of the scripts is referenced in the scripts section of the package.json file.
To run each example you can use the following commands

- `pnpm example:swap` will run `examples/swap.ts`
- `pnpm example:bridge` will run `examples/bridge.ts`
- `pnpm example:multihop` will run `examples/multihop.ts`
- `pnpm example:klima` will run `examples/klimaRetireExactCarbon.ts`
- `pnpm example:polynomial` will run `examples/polynomialDeposit.ts`

Be sure to take a look inside the scripts to find out what they do.
