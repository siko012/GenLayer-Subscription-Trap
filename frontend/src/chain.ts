import { defineChain } from "viem";

export const GENLAYER_CHAIN_ID = 61999;
export const GENLAYER_RPC_URL = "https://studio.genlayer.com/api";

// subscription-trap (Offramp) - 
export const CONTRACT_ADDRESS = "0x0110E50C8c5fB1b90DD5329F620DA3CC8d02225F" as const;

export const genLayerStudionet = defineChain({
  id: GENLAYER_CHAIN_ID,
  name: "GenLayer Studionet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: [GENLAYER_RPC_URL] },
    public: { http: [GENLAYER_RPC_URL] },
  },
  testnet: true,
});
