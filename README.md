# nanotip-fediverse

## How to use

### Single tip to a person

To tip someone out of the blue, you just need to include "#xnotip", the amount to tip (in nano) and their handle, in a toot. The order doesn't matter.

So

> "#xnotip @filipe 1"

and

> "@filipe #xnotip 1"

would both work.

### Single tip to the person you're replying to

To tip the person you're replying to, just do the same, without a handle.

So (in a reply)

> "@filipe #xnotip 1"

**Note:** mentioning another person in a reply will override the original tip recipient.

So (in a reply)

> "@filipe #xnotip @john 1"

will tip @john and _not_ @filipe.

### Multi tip

Mentioning multiple people will tip all of them.

So

> "#xnotip @filipe @john 1"

will tip @filipe Ӿ1 and @john Ӿ1.

**Note:** Multi tip doesn't support non-custodial tips (yet? 👀)

### Split multi tip

Add "split" to the toot to split the amount by everyone.

So

> #xnotip @filipe @john 1 split

will tip @filipe Ӿ0.5 and @john Ӿ0.5.

### Auto detect nano accounts

If the bots sees that the recepient has one of "Ӿ", "XNO" or "nano" (all case insensitive) as a field in their accounts, it will tip that address instead of the custodial, tipper managed address. Yay for non-custodial stuff 🥳

### Non-custodial tips

If you wanna use the bot to tip someone without having an account with the tipper, use "non-custodial". The tipper will create a block and give you a hash to sign, for the address found in your account. Then, you just have to reply with the signature and the bot will tip the person for you. This way the bot never touched the money. Yay for non-custodial stuff 🥳

It will look something like this:

You:

> "#xnotip @filipe 1 non-custodial"

The tip bot:

> "Please sign this hash: 1234567...ABCD Tip info: {some tip data}"

You:

> "@nanotipper 1234567...ABCD"

**Note:** This will only work if you specify a nano address in your account, using a field "Ӿ", "XNO" or "nano" (all case insensitive).

### Your address

DM the bot "address" and it will reply with your address (a link to [Nanolooker](https://nanolooker.com))

### Withdraw nano

DM the bot "withdraw" and a nano address and it will send nano there. You can specify an amount.

So (in a direct toot)

> "@nanotipper withdraw 1 nano\_..."

will withdraw 1 nano to that adress.

You can leave the amount empty to withdraw all of the nano.

You can leave the account empty to send the nano to the address specified in your account using a field "Ӿ", "XNO" or "nano" (all case insensitive)

## Deployment

I use [Render](https://render.com), but anything that connects to a Github repo, just do `pnpm i`, `pnpm build` and `pnpm start:prod` (or use any package manager you want, really)

This is only tested on [Mastodon](https://joinmastodon.org), but might work on other fediverse stuff, no idea!

## Development

Just `pnpm dev` after creating a local `.env` file.

There are no tests yet.

## Necessary config

### Bot permissions

- read:accounts
- read:notifications
- read:statuses
- write:favourites (only if in silent mode, see below)
- write:follows
- write:statuses

### Env vars

- `NANO_RPC_URL` -> The URL of the nano node
- `NANO_SEED` -> The nano seed to derive all accounts from
- `NANO_REPRESENTATIVE` -> the rep of your tipper accounts
- `MASTODON_ACCESS_TOKEN` -> Your Mastodon `access_token` for the API
- `MASTODON_STREAMING_BASE_URL` -> The Mastodon streaming API URL
- `MASTODON_REST_BASE_URL` -> The Mastodon REST API URL
- `MASTODON_TRIGGER_HASHTAG` -> The hashtag you want to watch and to trigger tips
- `DATABASE_URL` -> The MySQL connection string (currently I use [PlanetScale](https://planetscale.com/))
- `SILENT` -> `"true"` if you want the bot to only toot the strictly necessary (defaults to `"false"`)
