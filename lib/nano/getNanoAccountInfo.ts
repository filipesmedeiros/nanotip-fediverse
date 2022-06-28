import { nanoRpcUrl } from "../constants";
import { AccountInfoResponse } from "./types";
import fetch from "node-fetch";

const getNanoAccountInfo = async (account: string) => {
    const accountRes = await fetch(nanoRpcUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "account_info",
            account,
            include_confirmed: "true",
        }),
    });

    if (!accountRes.ok) throw new Error(accountRes.statusText);

    const info = await (accountRes.json() as Promise<AccountInfoResponse>);

    return {
        balance: info.confirmed_balance,
        frontier: info.confirmed_frontier,
    };
};

export default getNanoAccountInfo;
