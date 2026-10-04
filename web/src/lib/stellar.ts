import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const EXPLORER = import.meta.env.VITE_EXPLORER ?? "https://stellar.expert/explorer/testnet";
/** Native XLM's Stellar Asset Contract on testnet. */
export const XLM_SAC = import.meta.env.VITE_XLM_SAC ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const server = new rpc.Server(RPC_URL);

export class WalletError extends Error {}
export class ContractError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** Connect Freighter and make sure it's on the network this app targets. */
export async function connectWallet(): Promise<string> {
  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    throw new WalletError("Freighter isn't installed. Get it at freighter.app, then reload.");
  }
  const access = await requestAccess();
  if (access.error || !access.address) throw new WalletError(access.error?.message ?? "Wallet access was denied.");
  const net = await getNetworkDetails();
  if (!net.error && net.networkPassphrase !== NETWORK_PASSPHRASE) {
    throw new WalletError("Switch Freighter to Testnet to use this app.");
  }
  return access.address;
}

/** Address of an already-authorized wallet, or null (no popup). */
export async function currentAddress(): Promise<string | null> {
  const res = await getAddress();
  return res.error || !res.address ? null : res.address;
}

/** Turn "Error(Contract, #3)" into a friendly message using the contract's error table. */
export function contractError(raw: string, messages: Record<number, string>): ContractError {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  const code = m ? Number(m[1]) : undefined;
  if (code !== undefined && messages[code]) return new ContractError(messages[code], code);
  if (/insufficient|underfunded|balance/i.test(raw)) return new ContractError("Insufficient balance for this transaction.");
  if (/trustline/i.test(raw)) return new ContractError("The account needs a trustline for this asset first.");
  return new ContractError(raw.split("\n")[0].slice(0, 200), code);
}

export interface Client {
  contractId: string;
  read<T>(method: string, args?: xdr.ScVal[]): Promise<T>;
  invoke<T = unknown>(source: string, method: string, args?: xdr.ScVal[]): Promise<{ hash: string; result: T }>;
}

export function client(contractId: string, errors: Record<number, string> = {}): Client {
  const contract = new Contract(contractId);

  async function simulate(source: string, method: string, args: xdr.ScVal[], account?: Account) {
    const tx = new TransactionBuilder(account ?? new Account(source, "0"), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(120)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw contractError(sim.error, errors);
    return { tx, sim };
  }

  return {
    contractId,
    async read<T>(method: string, args: xdr.ScVal[] = []): Promise<T> {
      const { sim } = await simulate(Keypair.random().publicKey(), method, args);
      const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
      return (retval ? scValToNative(retval) : undefined) as T;
    },
    async invoke<T>(source: string, method: string, args: xdr.ScVal[] = []) {
      const account = await server.getAccount(source);
      const { tx, sim } = await simulate(source, method, args, account);
      const prepared = rpc.assembleTransaction(tx, sim).build();
      const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address: source });
      if (signed.error || !signed.signedTxXdr) throw new WalletError(signed.error?.message ?? "Signing was cancelled.");
      const result = await submit(signed.signedTxXdr, errors);
      return result as { hash: string; result: T };
    },
  };
}

/** Submit a signed envelope and wait for it to settle (up to ~45s). */
export async function submit(signedXdr: string, errors: Record<number, string> = {}) {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw contractError(JSON.stringify(sent.errorResult ?? "rejected"), errors);
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, result: res.returnValue ? scValToNative(res.returnValue) : undefined };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new ContractError(`Transaction failed on-chain (${sent.hash.slice(0, 8)}…)`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new ContractError("Still waiting for the network. Check the explorer before retrying.");
}

// ScVal helpers
export const addr = (a: string) => new Address(a).toScVal();
export const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
export const u64 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" });
export const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
export const bool = (v: boolean) => nativeToScVal(v, { type: "bool" });
export const str = (v: string) => nativeToScVal(v, { type: "string" });
export const none = () => xdr.ScVal.scvVoid();

export const txLink = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const contractLink = (id: string) => `${EXPLORER}/contract/${id}`;
export const accountLink = (id: string) => `${EXPLORER}/account/${id}`;

/**
 * Deploy a new instance of an already-uploaded contract (by wasm hash) from
 * the connected wallet. Returns the new contract id.
 */
export async function deployContract(source: string, wasmHashHex: string): Promise<{ hash: string; contractId: string }> {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(source),
        wasmHash: Buffer.from(wasmHashHex, "hex"),
        salt: Buffer.from(salt),
      }),
    )
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address: source });
  if (signed.error || !signed.signedTxXdr) throw new WalletError(signed.error?.message ?? "Signing was cancelled.");
  const { hash, result } = await submit(signed.signedTxXdr);
  return { hash, contractId: String(result) };
}
