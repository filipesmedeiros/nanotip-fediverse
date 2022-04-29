import { PrismaClient } from "@prisma/client";
import { MessageEvent, WebSocket } from "ws";

const accessToken = process.env.MASTODON_ACCESS_TOKEN;
const hashtag = "xnotip";
const baseUrl = "wss://social.filipesm.com";
const endpoint = "/api/v1/streaming";
const url = `${baseUrl}${endpoint}?access_token=${accessToken}&stream=hashtag&tag=${hashtag}`;

const prisma = new PrismaClient();

const start = () => {
    const ws = new WebSocket(url);

    const messageHandler = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return;

        const data = JSON.parse(ev.data as string);

        if (data.event !== "update") return;

        data.payload = JSON.parse(data.payload);
    };

    ws.addEventListener("message", messageHandler);
};

start();
