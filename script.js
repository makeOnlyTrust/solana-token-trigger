require("dotenv").config();

const fs = require("fs");

const {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  Transaction,
} = require("@solana/web3.js");
const { Program, AnchorProvider, utils, Wallet } = require("@coral-xyz/anchor");

const IDL = require("./lib/bio_swap.json");

const programId = new PublicKey("Eru327okZdfAagxjoxsY8pkSKhkvpV9mRx1sUhurSNVr");
const connection = new Connection(
  "https://solana-devnet.g.alchemy.com/v2/uHpiiRKcfmnm-rohpLpr04m4HJxOvVP2"
);

const privateKeyJson = JSON.parse(
  fs.readFileSync("./lib/keypair.json", "utf8")
);
const privateKeyUint8Array = Uint8Array.from(privateKeyJson);
const keypair = Keypair.fromSecretKey(privateKeyUint8Array);

const getAmmConfig = async () => {
  const provider = new AnchorProvider(connection, {
    publicKey: keypair.publicKey,
  });
  const program = new Program(IDL, programId, provider);

  const [ammConfigPubkey] = PublicKey.findProgramAddressSync(
    [utils.bytes.utf8.encode("amm_config")],
    programId
  );

  const result = await program.account.ammConfig.fetch(ammConfigPubkey);

  console.log(result);
};
getAmmConfig();
