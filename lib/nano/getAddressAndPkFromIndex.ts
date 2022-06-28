import { deriveAddress, derivePublicKey, deriveSecretKey } from "nanocurrency";
import { nanoSeed } from "../constants";

const getAddressAndPkFromIndex = (index: number) => {
    const seed = nanoSeed!;
    const privateKey = deriveSecretKey(seed, index);
    const publicKey = derivePublicKey(privateKey);
    const address = deriveAddress(publicKey, { useNanoPrefix: true });

    return { address, privateKey };
};

export default getAddressAndPkFromIndex;
