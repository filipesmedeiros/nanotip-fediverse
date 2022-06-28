export interface Config {
  NANO_RPC_URL: string
  NANO_SEED: string
  NANO_REPRESENTATIVE: string

  MASTODON_ACCESS_TOKEN: string
  MASTODON_STREAMING_BASE_URL: string
  MASTODON_REST_BASE_URL: string
  MASTODON_TRIGGER_HASHTAG: string

  DATABASE_URL: string
}
