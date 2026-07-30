import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

export type Verdict = "CLEAN" | "GREY" | "DARK_PATTERN" | "";

export interface FlowCaseView {
  reporter: string;
  service: string;
  flowText: string;
  bond: string;
  status: number; // 0 FILED, 1 ANALYZED, 2 RULED, 3 SETTLED
  verdict: Verdict;
  obstacleCount: number;
  rationale: string;
}
export interface FlowRow extends FlowCaseView { id: number; }

function readClient() { return createClient({ chain: studionet, account: createAccount() }); }
function writeClient(account: Hex) { return createClient({ chain: studionet, account }); }

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS); });
  try { await Promise.race([client.waitForTransactionReceipt({ hash: hash as never, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 64 }), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

export async function submitFlow(account: Hex, f: { service: string; flowText: string; bondWei: bigint }): Promise<number> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "submit_flow", args: [f.service.trim(), f.flowText.trim()], value: f.bondWei })) as Hex;
  await waitAccepted(wc, h);
  const c = await getCounts();
  return c.next - 1;
}
export async function analyzeFlow(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "analyze", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function adjudicate(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "adjudicate", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function flagOrClear(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "flag_or_clear", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function getCase(caseId: number): Promise<FlowCaseView> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_case", args: [caseId] });
  return {
    reporter: String(pick(r, "reporter", 0) ?? ""),
    service: String(pick(r, "service", 1) ?? ""),
    flowText: String(pick(r, "flow_text", 2) ?? ""),
    bond: String(pick(r, "bond", 3) ?? "0"),
    status: Number(pick(r, "status", 4) ?? 0),
    verdict: String(pick(r, "verdict", 5) ?? "") as Verdict,
    obstacleCount: Number(pick(r, "obstacle_count", 6) ?? 0),
    rationale: String(pick(r, "rationale", 7) ?? ""),
  };
}
export async function getCounts(): Promise<{ next: number; ruled: number; dark: number }> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_counts", args: [] });
  const parts = String(r).split("||").map((x) => Number(x) || 0);
  return { next: parts[0] || 0, ruled: parts[1] || 0, dark: parts[2] || 0 };
}
export async function getPoolBalance(): Promise<string> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_pool_balance", args: [] });
  return String(r ?? "0");
}
export async function listAll(maxRows = 50): Promise<FlowRow[]> {
  const { next } = await getCounts();
  if (next === 0) return [];
  const ids: number[] = [];
  for (let i = next - 1; i >= 0 && i >= next - maxRows; i--) ids.push(i);
  const rows = await Promise.all(ids.map(async (id) => { try { const c = await getCase(id); return { id, ...c }; } catch { return null; } }));
  return rows.filter((r): r is FlowRow => r !== null);
}
