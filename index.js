require("dotenv").config();

const cron = require("node-cron");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const { getAccount, getMint } = require("@solana/spl-token");
const { Program, AnchorProvider, setProvider } = require("@coral-xyz/anchor");
const axios = require("axios");

const { SolTrxHistory } = require("./db/collection");
const IDL = require("./lib/bio_swap.json");
const { getSolTokenPrice } = require("./getPrice");
const { storeData, txIndexMap } = require("./timer");

require("./db");

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";

const programId = new PublicKey(process.env.PROGRAMID);
const connection = new Connection(
  process.env.RPC_URL == "mainnet-beta"
    ? clusterApiUrl(process.env.RPC_URL)
    : process.env.RPC_URL
);

// Get Price in Pool after transaction is complete
const getQuote = async (sourceMint, destinationMint) => {
  try {
    const provider = new AnchorProvider(connection, {
      publicKey: new PublicKey("FUg6vdQyauSKCWffzyj8H1k8snSao4TC3oKqUFoRDZQE"),
    });
    const program = new Program(IDL, programId, provider);

    const mintA = new PublicKey(sourceMint);
    const mintB = new PublicKey(destinationMint);

    const swapPair = PublicKey.findProgramAddressSync(
      [Buffer.from("swap-pair", "utf-8"), mintA.toBuffer(), mintB.toBuffer()],
      programId
    )[0];

    const swapPairObject = await program.account.swapPair.fetch(swapPair);
    const tokenAAccount = swapPairObject.tokenAAccount;
    const tokenBAccount = swapPairObject.tokenBAccount;

    const balanceA = await getAccount(connection, tokenAAccount);
    const balanceB = await getAccount(connection, tokenBAccount);

    const tokenMintA = await getMint(connection, mintA);
    const tokenMintB = await getMint(connection, mintB);

    const realBalanceA = String(balanceA.amount) / tokenMintA.decimals;
    const realBalanceB = String(balanceB.amount) / tokenMintB.decimals;

    const price = [sourceMint, destinationMint].includes(SOL_ADDRESS)
      ? realBalanceA / realBalanceB
      : realBalanceB / realBalanceA;

    return price;
  } catch (e) {
    console.log(e);
  }
};

// Get the transaction details with signature
async function fetchTransaction(tx, tokenPair) {
  try {
    const key = `${tx}`;

    if (txIndexMap.has(key)) return;

    storeData(key, 60000);

    const transaction = await connection.getTransaction(tx, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 1,
    });

    if (!transaction || !transaction.meta) {
      console.log("Trx Error 1");
      return true;
    }

    const { postTokenBalances, preTokenBalances, status, logMessages } =
      transaction.meta;

    if (status.Err) {
      console.log("Trx Error 2");
      return true;
    }
    if (JSON.stringify(logMessages).includes("CreatePool")) {
      console.log("CreatePool");
      return true;
    }
    if (JSON.stringify(logMessages).includes("DepositAll")) {
      console.log("DepositAll");
      return true;
    }
    if (JSON.stringify(logMessages).includes("WithdrawAll")) {
      console.log("WithdrawAll");
      return true;
    }

    const balanceData = [];
    let signer = "";

    for (let i = 0; i < postTokenBalances.length; i++) {
      if (
        postTokenBalances[i].mint !== tokenPair.tokenAMint &&
        postTokenBalances[i].mint !== tokenPair.tokenBMint
      ) {
        continue;
      }
      if (postTokenBalances[i].owner !== tokenPair.owner) {
        signer = postTokenBalances[i].owner;
        continue;
      }
      const matchedPre = preTokenBalances.find(
        (t) => t.accountIndex == postTokenBalances[i].accountIndex
      );

      balanceData.push({
        mint: postTokenBalances[i].mint,
        owner: postTokenBalances[i].owner,
        postamount: postTokenBalances[i].uiTokenAmount.amount,
        preamount: matchedPre.uiTokenAmount.amount,
      });
    }

    const isBaseSmall =
      new PublicKey(balanceData[0].mint)
        .toBuffer()
        .compare(new PublicKey(balanceData[1].mint).toBuffer()) < 0;

    const tokenA = isBaseSmall ? balanceData[0] : balanceData[1];
    const tokenB = isBaseSmall ? balanceData[1] : balanceData[0];

    const baseAmount = tokenA.postamount - tokenA.preamount;
    const quoteAmount = tokenB.postamount - tokenB.preamount;
    const price = [tokenA.mint, tokenB.mint].includes(SOL_ADDRESS)
      ? Math.abs(baseAmount / quoteAmount)
      : Math.abs(quoteAmount / baseAmount);

    const type = baseAmount > 0 ? "buy" : "sell";

    const amountIn = Math.abs(baseAmount) / 10 ** tokenPair.tokenADecimals;
    const amountOut = Math.abs(quoteAmount) / 10 ** tokenPair.tokenBDecimals;

    const saveData = {
      eventDisplayType: type,
      hash: tx,
      signer: signer,
      baseToken: type === "buy" ? tokenA.mint : tokenB.mint,
      quoteToken: type === "buy" ? tokenB.mint : tokenA.mint,
      amountInUsd: 0,
      amountOutUsd: 0,
      amountIn: type === "buy" ? amountIn : amountOut,
      amountOut: type === "buy" ? amountOut : amountIn,
      poolAddress: tokenPair.owner,
      price,
    };

    const prevTrx = await SolTrxHistory.findOne({ hash: tx });

    if (!prevTrx) {
      await SolTrxHistory.create(saveData);
      const result = await getQuote(tokenA.mint, tokenB.mint);
      console.log(result, "result");

      // await axios.post("https://api-solana.biokript.com/txns", {
      //   hash: saveData?.hash,
      //   signer: saveData?.signer,
      //   baseToken: saveData?.baseToken,
      //   quoteToken: saveData?.quoteToken,
      //   amountIn: Number(saveData?.amountIn),
      //   amountOut: Number(saveData?.amountOut),
      //   baseUsdAmount: Number(saveData?.amountInUsd),
      //   quoteUsdAmount: Number(saveData?.amountOutUsd),
      //   poolAddress: "",
      // });
    }
  } catch (err) {
    console.error(err, "fetchTransaction Error");
  }
}

// async function updateTransactionDetails() {
//   const pendingTransactions = await TrxEvents.find({ status: false });
//   for (const i in pendingTransactions) {
//     console.log(pendingTransactions[i]);
//     const flag = await fetchTransaction(pendingTransactions[i].transactionHash);
//     if (flag) {
//       await TrxEvents.findOneAndUpdate(
//         { _id: pendingTransactions[i]._id },
//         { status: true }
//       );
//     }
//   }
// }

// Get the latest finalized transactions
async function getRecentTransactions(tokenPair) {
  try {
    let requestConfig = {};
    const lastTrx = await SolTrxHistory.findOne({
      poolAddress: tokenPair.owner,
    }).sort({
      createdAt: -1,
    });

    if (lastTrx) {
      requestConfig.until = lastTrx.hash;
    } else {
      requestConfig.limit = 100;
    }

    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(tokenPair.owner),
      requestConfig
    );

    console.log(tokenPair.owner, signatures.length, "signatures.length");

    for (let i = signatures.length - 1; i >= 0; i--) {
      const { signature } = signatures[i];
      console.log(signature, "signature");
      await fetchTransaction(signature, tokenPair);
    }
    console.log("Done");
  } catch (err) {
    console.error(err, "getRecentTransactions Error");
  }
}

const init = async () => {
  const oneItem = {
    publicKey: "5fkRfeHExWja6BXJorL53zuts4RHWZbQMYHmeHe8Moca",
    owner: "JDmDxzRjVcBcGbqvjNWmu34ZgbMrLmYrTLcren5YosRQ",
    tokenAAccount: "AbN6FShAFMrXXWCKZYkNobFrFvhiYw9thJYrsFmyY6SG",
    tokenBAccount: "AEsSXdz58FemwBHxu6yvGrWt747ACu8Xx9Ma1ieyG2Y2",
    poolMint: "79YZPR4V41cfpguH7F5tiEnpZ8f1qvQQUNe6oKvBddLB",
    tokenAMint: "So11111111111111111111111111111111111111112",
    tokenBMint: "BLLbAtSHFpgkSaUGmSQnjafnhebt8XPncaeYrpEgWoVk",
    poolFeeAccount: "Gd3ymr5G2w1NSgNThRyq6LkjBJUSze9Z6Y6j6LiKSmeL",
  };

  const tokenMintA = await getMint(
    connection,
    new PublicKey(oneItem.tokenAMint)
  );
  const tokenMintB = await getMint(
    connection,
    new PublicKey(oneItem.tokenBMint)
  );
  oneItem.tokenADecimals = tokenMintA.decimals;
  oneItem.tokenBDecimals = tokenMintB.decimals;

  getRecentTransactions(oneItem);

  // fetchTransaction('2HW5yNvJRqmrvcvNRqxaW4BCa8tWmd4L9P7p9mB2bCwbkNft3Wfn4qk72BLPxkgRo9jD6HUwmLzeZx47FgMzHg1z', oneItem);

  // Above Code is for testing
  // ----------------------------------------------------------
  // Here, We will start with real one

  // const provider = new AnchorProvider(connection, {
  //   publicKey: new PublicKey("FUg6vdQyauSKCWffzyj8H1k8snSao4TC3oKqUFoRDZQE"),
  // });
  // setProvider(provider);
  // const program = new Program(IDL, programId);
  // const swapPools = await program.account.swapPair.all();

  // for (let i = 0; i < swapPools.length; i++) {
  //   const tokenADetail = await getAccount(
  //     connection,
  //     swapPools[i].account.tokenAAccount
  //   );
  //   const oneItem = {
  //     publicKey: swapPools[i].publicKey.toString(),
  //     owner: tokenADetail.owner.toString(),
  //     tokenAAccount: swapPools[i].account.tokenAAccount.toString(),
  //     tokenBAccount: swapPools[i].account.tokenBAccount.toString(),
  //     poolMint: swapPools[i].account.poolMint.toString(),
  //     tokenAMint: swapPools[i].account.tokenAMint.toString(),
  //     tokenBMint: swapPools[i].account.tokenBMint.toString(),
  //     poolFeeAccount: swapPools[i].account.poolFeeAccount.toString(),
  //   };

  //   const tokenMintA = await getMint(
  //     connection,
  //     new PublicKey(oneItem.tokenAMint)
  //   );
  //   const tokenMintB = await getMint(
  //     connection,
  //     new PublicKey(oneItem.tokenBMint)
  //   );
  //   oneItem.tokenADecimals = tokenMintA.decimals
  //   oneItem.tokenBDecimals = tokenMintB.decimals

  //   getRecentTransactions(oneItem);
  // }
};
init();
