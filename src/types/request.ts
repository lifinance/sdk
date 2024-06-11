export interface ExtendedRequestInit extends RequestInit {
  retries?: number
  skipTrackingHeaders?: boolean
  disableLiFiErrorCodes?: boolean
}
