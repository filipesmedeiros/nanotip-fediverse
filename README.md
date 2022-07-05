# nanotip-fediverse

## Necessary config

Put them as env vars in your deployment :)

- NANO_RPC_URL -> The URL of the nano node
- NANO_SEED -> The nano seed to derive all accounts from
- NANO_REPRESENTATIVE -> the rep of your tipper accounts
- MASTODON_ACCESS_TOKEN -> Your Mastodon `access_token` for the API
- MASTODON_STREAMING_BASE_URL -> The Mastodon streaming API URL
- MASTODON_REST_BASE_URL -> The Mastodon REST API URL
- MASTODON_TRIGGER_HASHTAG -> The hashtag you want to watch and to trigger tips
- DATABASE_URL -> The MySQL connection string (currently I use [PlanetScale](https://planetscale.com/))
