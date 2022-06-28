import Big from "big.js";
import { hashBlock, signBlock } from "nanocurrency";
import { nanoRepresentative, nanoRpcUrl } from "../constants";
import getNanoAccountInfo from "./getNanoAccountInfo";
import { NanotoPowResponse } from "./types";
import fetch from "node-fetch";

Big.PE = 50;

const sendFromCustodialAccount = async ({
    from,
    to,
    amount,
    privateKey,
}: {
    from: string;
    to: string;
    amount: string;
    privateKey: string;
}) => {
    const { frontier, balance } = await getNanoAccountInfo(from);
    const powRes = fetch(`https://nano.to/${frontier}/pow`);

    const newBalance = Big(balance).minus(amount).toString();

    const hash = hashBlock({
        account: from,
        previous: frontier,
        representative: nanoRepresentative!,
        balance: newBalance,
        link: to,
    });

    const signature = signBlock({ secretKey: privateKey, hash });

    const { work } = (await (await powRes).json()) as NanotoPowResponse;
    const processRes = await fetch(nanoRpcUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "process",
            json_block: "true",
            subtype: "send",
            block: {
                type: "state",
                account: from,
                previous: frontier,
                representative: nanoRepresentative,
                balance: newBalance,
                link: to,
                signature,
                work,
            },
        }),
    });

    return ((await processRes.json()) as { hash: string }).hash;
};

export default sendFromCustodialAccount;
