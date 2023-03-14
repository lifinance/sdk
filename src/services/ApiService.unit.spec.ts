import {
  Action,
  ChainId,
  CoinKey,
  Estimate,
  findDefaultToken,
  RoutesRequest,
  Step,
  StepTool,
  StepType,
} from '@lifi/types'
import { rest } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { requestSettings } from '../helpers'
import { ServerError, SlippageError, ValidationError } from '../utils/errors'
import ApiService from './ApiService'
import { handlers } from './ApiService.unit.handlers'
import ConfigService from './ConfigService'

const mockedFetch = vi.spyOn(globalThis, 'fetch')

describe('ApiService', () => {
  const config = ConfigService.getInstance().getConfig()
  const server = setupServer(...handlers)
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
    // server.use(...handlers)
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => server.resetHandlers())
  afterAll(() => {
    requestSettings.retries = 1
    server.close()
  })

  describe('getRoutes', () => {
    const getRoutesRequest = ({
      fromChainId = ChainId.BSC,
      fromAmount = '10000000000000',
      fromTokenAddress = findDefaultToken(CoinKey.USDC, ChainId.BSC).address,
      toChainId = ChainId.DAI,
      toTokenAddress = findDefaultToken(CoinKey.USDC, ChainId.DAI).address,
      options = { slippage: 0.03 },
    }: {
      fromChainId?: ChainId
      fromAmount?: string
      fromTokenAddress?: string
      toChainId?: ChainId
      toTokenAddress?: string
      options?: { slippage: number }
    }): RoutesRequest => ({
      fromChainId,
      fromAmount,
      fromTokenAddress,
      toChainId,
      toTokenAddress,
      options,
    })

    describe('user input is invalid', () => {
      it('should throw Error because of invalid fromChainId type', async () => {
        const request = getRoutesRequest({
          fromChainId: 'xxx' as unknown as ChainId,
        })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid fromAmount type', async () => {
        const request = getRoutesRequest({
          fromAmount: 10000000000000 as unknown as string,
        })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid fromTokenAddress type', async () => {
        const request = getRoutesRequest({
          fromTokenAddress: 1234 as unknown as string,
        })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid toChainId type', async () => {
        const request = getRoutesRequest({
          toChainId: 'xxx' as unknown as ChainId,
        })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid toTokenAddress type', async () => {
        const request = getRoutesRequest({ toTokenAddress: '' })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid options type', async () => {
        const request = getRoutesRequest({
          options: { slippage: 'not a number' as unknown as number },
        })

        await expect(ApiService.getRoutes(request)).rejects.toThrow(
          'Invalid routes request.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call fails', () => {
        it('throw a the error', async () => {
          const request = getRoutesRequest({ fromAmount: 'failed' })
          await expect(ApiService.getRoutes(request)).rejects.toThrowError(
            new ServerError('Oops')
          )
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          const request = getRoutesRequest({})
          await ApiService.getRoutes(request)
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('getPossibilities', () => {
    describe('user input is valid', () => {
      describe('and the backend call fails with 500', () => {
        beforeEach(() => {
          requestSettings.retries = 1
        })

        afterEach(() => {
          requestSettings.retries = 0
        })

        it('throw a the error after retrying once', async () => {
          server.use(
            rest.post(
              `${config.apiUrl}/advanced/possibilities`,
              async (_, response, context) =>
                response(context.status(500), context.json({ message: 'Oops' }))
            )
          )

          await expect(ApiService.getPossibilities()).rejects.toThrowError(
            new ServerError('Oops')
          )
          expect(mockedFetch).toHaveBeenCalledTimes(2)
        })
      })

      describe('and the backend call fails with 409', () => {
        it('throw a the error without retrying', async () => {
          server.use(
            rest.post(
              `${config.apiUrl}/advanced/possibilities`,
              async (_, response, context) =>
                response(
                  context.status(409),
                  context.json({
                    message: 'Slippage error',
                  })
                )
            )
          )

          await expect(ApiService.getPossibilities()).rejects.toThrowError(
            new SlippageError('Slippage error')
          )
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          await ApiService.getPossibilities()

          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      // TODO write tests for the correct application of default values for bridges & exchanges
    })
  })

  describe('getToken', () => {
    describe('user input is invalid', () => {
      it('throw an error', async () => {
        await expect(
          ApiService.getToken(undefined as unknown as ChainId, 'DAI')
        ).rejects.toThrowError(
          new ValidationError('Required parameter "chain" is missing.')
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)

        await expect(
          ApiService.getToken(ChainId.ETH, undefined as unknown as string)
        ).rejects.toThrowError(
          new ValidationError('Required parameter "token" is missing.')
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call fails', () => {
        it('throw an error', async () => {
          server.use(
            rest.get(`${config.apiUrl}/token`, async (_, response, context) =>
              response(context.status(500), context.json({ message: 'Oops' }))
            )
          )

          await expect(
            ApiService.getToken(ChainId.DAI, 'DAI')
          ).rejects.toThrowError(new ServerError('Oops'))
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          await ApiService.getToken(ChainId.DAI, 'DAI')

          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('getQuote', () => {
    const fromChain = ChainId.DAI
    const fromToken = 'DAI'
    const fromAddress = 'Some wallet address'
    const fromAmount = '1000'
    const toChain = ChainId.POL
    const toToken = 'MATIC'

    describe('user input is invalid', () => {
      it('throw an error', async () => {
        await expect(
          ApiService.getQuote({
            fromChain: undefined as unknown as ChainId,
            fromToken,
            fromAddress,
            fromAmount,
            toChain,
            toToken,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "fromChain" is missing.')
        )

        await expect(
          ApiService.getQuote({
            fromChain,
            fromToken: undefined as unknown as string,
            fromAddress,
            fromAmount,
            toChain,
            toToken,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "fromToken" is missing.')
        )

        await expect(
          ApiService.getQuote({
            fromChain,
            fromToken,
            fromAddress: undefined as unknown as string,
            fromAmount,
            toChain,
            toToken,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "fromAddress" is missing.')
        )

        await expect(
          ApiService.getQuote({
            fromChain,
            fromToken,
            fromAddress,
            fromAmount: undefined as unknown as string,
            toChain,
            toToken,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "fromAmount" is missing.')
        )

        await expect(
          ApiService.getQuote({
            fromChain,
            fromToken,
            fromAddress,
            fromAmount,
            toChain: undefined as unknown as ChainId,
            toToken,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "toChain" is missing.')
        )

        await expect(
          ApiService.getQuote({
            fromChain,
            fromToken,
            fromAddress,
            fromAmount,
            toChain,
            toToken: undefined as unknown as string,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "toToken" is missing.')
        )

        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call fails', () => {
        it('throw an error', async () => {
          server.use(
            rest.get(`${config.apiUrl}/quote`, async (_, response, context) =>
              response(context.status(500), context.json({ message: 'Oops' }))
            )
          )

          await expect(
            ApiService.getQuote({
              fromChain,
              fromToken,
              fromAddress,
              fromAmount,
              toChain,
              toToken,
            })
          ).rejects.toThrowError(new ServerError('Oops'))
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          await ApiService.getQuote({
            fromChain,
            fromToken,
            fromAddress,
            fromAmount,
            toChain,
            toToken,
          })

          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('getStatus', () => {
    const fromChain = ChainId.DAI
    const toChain = ChainId.POL
    const txHash = 'some tx hash'
    const bridge = 'some bridge tool'

    describe('user input is invalid', () => {
      it('throw an error', async () => {
        await expect(
          ApiService.getStatus({
            bridge: undefined as unknown as string,
            fromChain,
            toChain,
            txHash,
          })
        ).rejects.toThrowError(
          new ValidationError(
            'Parameter "bridge" is required for cross chain transfers.'
          )
        )

        await expect(
          ApiService.getStatus({
            bridge,
            fromChain: undefined as unknown as ChainId,
            toChain,
            txHash,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "fromChain" is missing.')
        )

        await expect(
          ApiService.getStatus({
            bridge,
            fromChain,
            toChain: undefined as unknown as ChainId,
            txHash,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "toChain" is missing.')
        )

        await expect(
          ApiService.getStatus({
            bridge,
            fromChain,
            toChain,
            txHash: undefined as unknown as string,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "txHash" is missing.')
        )

        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call fails', () => {
        it('throw an error', async () => {
          server.use(
            rest.get(`${config.apiUrl}/status`, async (_, response, context) =>
              response(context.status(500), context.json({ message: 'Oops' }))
            )
          )

          await expect(
            ApiService.getStatus({ bridge, fromChain, toChain, txHash })
          ).rejects.toThrowError(new ServerError('Oops'))
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          await ApiService.getStatus({ bridge, fromChain, toChain, txHash })

          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('getChains', () => {
    describe('and the backend call fails', () => {
      it('throw an error', async () => {
        server.use(
          rest.get(`${config.apiUrl}/chains`, async (_, response, context) =>
            response(context.status(500), context.json({ message: 'Oops' }))
          )
        )

        await expect(ApiService.getChains()).rejects.toThrowError(
          new ServerError('Oops')
        )
        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })

    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        const chains = await ApiService.getChains()

        expect(chains[0]?.id).toEqual(1)
        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('getTools', () => {
    describe('and the backend succeeds', () => {
      it('returns the tools', async () => {
        const tools = await ApiService.getTools({
          chains: [ChainId.ETH, ChainId.POL],
        })

        expect(tools).toBeDefined()
        expect(tools.bridges).toBeDefined()
        expect(tools.exchanges).toBeDefined()
      })
    })
  })

  describe('getTokens', () => {
    it('return the tokens', async () => {
      const result = await ApiService.getTokens({
        chains: [ChainId.ETH, ChainId.POL],
      })
      expect(result).toBeDefined()
      expect(result.tokens[ChainId.ETH]).toBeDefined()
    })
  })

  describe('getStepTransaction', () => {
    const getAction = ({
      fromChainId = ChainId.BSC,
      fromAmount = '10000000000000',
      fromToken = findDefaultToken(CoinKey.USDC, ChainId.BSC),
      fromAddress = 'some from address', // we don't validate the format of addresses atm
      toChainId = ChainId.DAI,
      toToken = findDefaultToken(CoinKey.USDC, ChainId.DAI),
      toAddress = 'some to address',
      slippage = 0.03,
    }): Action => ({
      fromChainId,
      fromAmount,
      fromToken,
      fromAddress,
      toChainId,
      toToken,
      toAddress,
      slippage,
    })

    const getEstimate = ({
      fromAmount = '10000000000000',
      toAmount = '10000000000000',
      toAmountMin = '999999999999',
      approvalAddress = 'some approval address', // we don't validate the format of addresses atm;
      executionDuration = 300,
    }): Estimate => ({
      fromAmount,
      toAmount,
      toAmountMin,
      approvalAddress,
      executionDuration,
    })

    const getStep = ({
      id = 'some random id',
      type = 'swap',
      tool = 'some swap tool',
      action = getAction({}),
      estimate = getEstimate({}),
    }: {
      id?: string
      type?: StepType
      tool?: StepTool
      action?: Action
      estimate?: Estimate
    }): Step =>
      ({
        id,
        type,
        tool,
        toolDetails: {
          key: tool,
          name: tool,
          logoURI: '',
        },
        action,
        estimate,
        includedSteps: [],
      } as Step)

    describe('with a swap step', () => {
      // While the validation fails for some users we should not enforce it
      describe.skip('user input is invalid', () => {
        it('should throw Error because of invalid id', async () => {
          const step = getStep({ id: null as unknown as string })

          await expect(ApiService.getStepTransaction(step)).rejects.toThrow(
            'Invalid step.'
          )
          expect(mockedFetch).toHaveBeenCalledTimes(0)
        })

        it('should throw Error because of invalid type', async () => {
          const step = getStep({ type: 42 as unknown as StepType })

          await expect(ApiService.getStepTransaction(step)).rejects.toThrow(
            'Invalid Step'
          )
          expect(mockedFetch).toHaveBeenCalledTimes(0)
        })

        it('should throw Error because of invalid tool', async () => {
          const step = getStep({ tool: null as unknown as StepTool })

          await expect(ApiService.getStepTransaction(step)).rejects.toThrow(
            'Invalid step.'
          )
          expect(mockedFetch).toHaveBeenCalledTimes(0)
        })

        // more indepth checks for the action type should be done once we have real schema validation
        it('should throw Error because of invalid action', async () => {
          const step = getStep({ action: 'xxx' as unknown as Action })

          await expect(ApiService.getStepTransaction(step)).rejects.toThrow(
            'Invalid step.'
          )
          expect(mockedFetch).toHaveBeenCalledTimes(0)
        })

        // more indepth checks for the estimate type should be done once we have real schema validation
        it('should throw Error because of invalid estimate', async () => {
          const step = getStep({
            estimate: 'Is this really an estimate?' as unknown as Estimate,
          })

          await expect(ApiService.getStepTransaction(step)).rejects.toThrow(
            'Invalid step.'
          )
          expect(mockedFetch).toHaveBeenCalledTimes(0)
        })
      })

      describe('user input is valid', () => {
        describe('and the backend call fails', () => {
          it('throw a the error', async () => {
            const step = getStep({})
            server.use(
              rest.post(
                `${config.apiUrl}/advanced/stepTransaction`,
                async (_, response, context) =>
                  response(
                    context.status(500),
                    context.json({ message: 'Oops' })
                  )
              )
            )

            await expect(
              ApiService.getStepTransaction(step)
            ).rejects.toThrowError(new ServerError('Oops'))
            expect(mockedFetch).toHaveBeenCalledTimes(1)
          })
        })

        describe('and the backend call is successful', () => {
          it('call the server once', async () => {
            const step = getStep({})

            await ApiService.getStepTransaction(step)
            expect(mockedFetch).toHaveBeenCalledTimes(1)
          })
        })
      })
    })
  })

  describe('getGasRecommendation', () => {
    describe('user input is invalid', () => {
      it('throw an error', async () => {
        await expect(
          ApiService.getGasRecommendation({
            chainId: undefined as unknown as number,
          })
        ).rejects.toThrowError(
          new ValidationError('Required parameter "chainId" is missing.')
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call fails', () => {
        it('throw an error', async () => {
          server.use(
            rest.get(
              `${config.apiUrl}/gas/suggestion/${ChainId.OPT}`,
              async (_, response, context) =>
                response(context.status(500), context.json({ message: 'Oops' }))
            )
          )

          await expect(
            ApiService.getGasRecommendation({
              chainId: ChainId.OPT,
            })
          ).rejects.toThrowError(new ServerError('Oops'))
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })

      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          await ApiService.getGasRecommendation({
            chainId: ChainId.OPT,
          })

          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })
})
