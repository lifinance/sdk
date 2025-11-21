export enum ErrorName {
  RPCError = 'RPCError',
  ProviderError = 'ProviderError',
  ServerError = 'ServerError',
  TransactionError = 'TransactionError',
  ValidationError = 'ValidationError',
  BalanceError = 'BalanceError',
  NotFoundError = 'NotFoundError',
  UnknownError = 'UnknownError',
  SlippageError = 'SlippageError',
  HTTPError = 'HTTPError',
}

export type ErrorCode = LiFiErrorCode

export enum LiFiErrorCode {
  InternalError = 1000,
  ValidationError = 1001,
  TransactionUnderpriced = 1002,
  TransactionFailed = 1003,
  Timeout = 1004,
  ProviderUnavailable = 1005,
  NotFound = 1006,
  ChainSwitchError = 1007,
  TransactionUnprepared = 1008,
  GasLimitError = 1009,
  TransactionCanceled = 1010,
  SlippageError = 1011,
  SignatureRejected = 1012,
  BalanceError = 1013,
  AllowanceRequired = 1014,
  InsufficientFunds = 1015,
  ExchangeRateUpdateCanceled = 1016,
  WalletChangedDuringExecution = 1017,
  TransactionExpired = 1018,
  TransactionSimulationFailed = 1019,
  TransactionConflict = 1020,
  TransactionNotFound = 1021,
  TransactionRejected = 1022,
  RateLimitExceeded = 1023,
  ThirdPartyError = 1024,
  InsufficientGas = 1025,
}

export enum ErrorMessage {
  UnknownError = 'Unknown error occurred.',
  SlippageError = 'The slippage is larger than the defined threshold. Please request a new route to get a fresh quote.',
  GasLimitLow = 'Gas limit is too low.',
  TransactionUnderpriced = 'Transaction is underpriced.',
  TransactionReverted = 'Transaction was reverted.',
}
