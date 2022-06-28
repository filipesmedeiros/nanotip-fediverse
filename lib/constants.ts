import { config } from "dotenv";

config();

export const accessToken = process.env.MASTODON_ACCESS_TOKEN;
export const hashtag = process.env.MASTODON_TRIGGER_HASHTAG;
export const mastodonStreamingBaseUrl = process.env.MASTODON_STREAMING_BASE_URL;
export const mastodonStreamingBaseUrlWithToken = `${mastodonStreamingBaseUrl}?access_token=${accessToken}`;
export const mastodonRestBaseUrl = process.env.MASTODON_REST_BASE_URL;
export const nanoRepresentative = process.env.NANO_REPRESENTATIVE;

export const nanoSeed = process.env.NANO_SEED;
export const nanoRpcUrl = process.env.NANO_RPC_URL;
