import { PrismaClient } from "@prisma/client";

let clientInstance: PrismaClient;

const client = () => {
    if (!clientInstance) clientInstance = new PrismaClient();
    return clientInstance;
};

export default client;
