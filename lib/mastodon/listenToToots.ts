import { MessageEvent, WebSocket } from "ws";
import { hashtag, mastodonStreamingBaseUrlWithToken } from "../constants";
import { Toot } from "./types";

const listenToToots = (onToot: (toot: Toot) => void, tag?: string) => {
    const wsUrl = tag
        ? `${mastodonStreamingBaseUrlWithToken}&stream=hashtag&tag=${hashtag}`
        : `${mastodonStreamingBaseUrlWithToken}&stream=public`;
    let ws = new WebSocket(wsUrl);

    const messageHandler = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return;

        const data = JSON.parse(ev.data as string);
        if (data.event !== "update") return;

        const toot = JSON.parse(data.payload);

        onToot(toot);
    };

    ws.onclose = () => (ws = new WebSocket(wsUrl));

    ws.onopen = () => ws.addEventListener("message", messageHandler);
};

export default listenToToots;
