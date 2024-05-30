# LI.FI SDK - Node Demo Examples

This project presents a number of demos for [our SDK](https://github.com/lifinance/sdk) examples that you can run from the command line.

They use our SDK (along with viem) to execute common work flows in node.js

These scripts need to be provided access to an actual wallet and will make real transactions on chains.

To run these examples you will need a private key for your wallet and enough funds for the tokens and chains that they use

Take look at the scrips in the `./examples` folder

## Setting up the scripts to use your wallet

- First you will need to obtain the private key for your wallet
- Then duplicate the `.env-template` file renaming it to `.env`
- Add your private key to your `.env` file - replacing the text in quote marks with your private key

NOTE: it's important to keep your private key safe and secure. Don't share it with anyone and make sure you never commit it to git repo.

## Executing the scripts

First install the dependencies

```
yarn install
```

Each of the scripts are referenced in scripts section of the package.json file.
To run each example you can use the following commands

- `yarn example:swap` will run `examples/swap.ts`
- `yarn example:bridge` will run `examples/bridge.ts`
- `yarn example:multihop` will run `examples/multihop`
- `yarn example:klima` will run `examples/klimaRetireExactCarbon.ts`
- `yarn example:polynomial` will run `examples/polynomialDeposit.ts`




