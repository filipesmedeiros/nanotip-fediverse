import fetch from "node-fetch";
import { accessToken, mastodonRestBaseUrl } from "../constants";
import { Toot } from "./types";

const url = `${mastodonRestBaseUrl}/statuses`;

const toot = async (status: string, inReplyTo?: string) => {
    const tootRes = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            status,
            in_reply_to_id: inReplyTo,
        }),
    });

    if (!tootRes.ok) throw new Error(tootRes.statusText);

    return tootRes.json() as Promise<Toot>;
};

export default toot;
