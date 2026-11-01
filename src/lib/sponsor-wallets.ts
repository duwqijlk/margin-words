/**
 * The project's receiving addresses, for the sponsor dialog. Browser only: it imports the QR images,
 * so the server and the Node tests read src/lib/sponsor.ts and never this file.
 *
 * Changing an address is a code change, reviewed like any other: a wrong address loses the gift.
 * Each QR code in src/assets/sponsor/qr-*.svg encodes exactly its address. Make a new one with the
 * address and decode it back before release.
 *
 * The QR files are imported, not served from public/: the build names each by its content hash, so a
 * new address gets a new QR address at once. A file in public/ keeps one name and is cached for 4 hours,
 * which could show a new address beside the old address's QR code. `?url&no-inline` keeps each a file.
 */
import qrEvm from "../assets/sponsor/qr-evm.svg?url&no-inline";
import qrSolana from "../assets/sponsor/qr-solana.svg?url&no-inline";
import qrTron from "../assets/sponsor/qr-tron.svg?url&no-inline";

/** One EVM address works on Ethereum and every EVM chain (L2s and BNB Chain alike). Tron (TRC-20) has its own. */
export const SPONSOR_WALLETS = [
  { id: "evm", address: "0xedc2cf33eff4a303ddac8c2f28835a3de1206054", qr: qrEvm },
  { id: "solana", address: "GFbfgAkccBzqfAZX9Edtpm7xuoQrniTUKnnxANegDSD2", qr: qrSolana },
  { id: "tron", address: "TN6mPkPgWH1pvJYiWXX7pwBVbUPSRvnXFy", qr: qrTron },
] as const;
export type SponsorWallet = (typeof SPONSOR_WALLETS)[number];

/** EVM chains the one EVM address receives on. Icons: public/sponsor/<icon>.svg (web3icons, MIT). */
export const EVM_CHAINS = [
  { icon: "ethereum", name: "Ethereum" },
  { icon: "bnb", name: "BNB Chain" },
  { icon: "arbitrum", name: "Arbitrum" },
  { icon: "optimism", name: "OP Mainnet" },
  { icon: "base", name: "Base" },
  { icon: "polygon", name: "Polygon" },
  { icon: "plasma", name: "Plasma" },
] as const;
