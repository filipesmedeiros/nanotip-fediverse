export interface AccountInfoResponse {
  frontier: string
  open_block: string
  representative_block: string
  balance: string
  confirmed_balance: string
  modified_timestamp: string
  block_count: string
  account_version: string
  confirmed_height: string
  confirmed_frontier: string
  representative: string
  confirmed_representative: string
}

export interface NanotoPowResponse {
  difficulty: string
  multiplier: string
  work: string
  credits: number
}
