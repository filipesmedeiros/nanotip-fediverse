import { mastodonRestBaseUrl } from "../constants";
import { Account } from "./types";
import fetch from "node-fetch";

const url = (id: string) => `${mastodonRestBaseUrl}/accounts/${id}`;

const getMastodonAccount = async (id: string) => {
    const accountRes = await fetch(url(id));

    if (!accountRes.ok) throw new Error(accountRes.statusText);

    return accountRes.json() as Promise<Account>;
};

export default getMastodonAccount;
