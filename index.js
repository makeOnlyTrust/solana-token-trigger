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

// const TOKEN_ADDRESS = new PublicKey(process.env.TOKEN_PAIR_ADDRESS);
const programId = new PublicKey(process.env.PROGRAMID);
const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
const connection = new Connection(
    process.env.RPC_URL == "mainnet-beta"
        ? clusterApiUrl(process.env.RPC_URL)
        : process.env.RPC_URL
);

const decimal = 1000000000; // 9 of 10

// Get Price in Pool after transaction is complete
const getQuote = async (sourceMint, destinationMint) => {
    try {
        const provider = new AnchorProvider(connection, {
            publicKey: new PublicKey("FUg6vdQyauSKCWffzyj8H1k8snSao4TC3oKqUFoRDZQE"),
        });
        const program = new Program(IDL, programId, provider);

        const tokenA = new PublicKey(sourceMint);
        const tokenB = new PublicKey(destinationMint);

        const mintA = tokenA > tokenB ? tokenA : tokenB;
        const mintB = tokenA > tokenB ? tokenB : tokenA;
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

        console.log(tokenMintA.decimals, "Token A mint");
        console.log(tokenMintB.decimals, "Token B mint");

        const realBalanceA = String(balanceA.amount) / tokenMintA.decimals;
        const realBalanceB = String(balanceB.amount) / tokenMintB.decimals;

        return realBalanceA / realBalanceB;
    } catch (e) {
        console.log(e);
    }
};

// Get the transaction details with signature
async function fetchTransaction(tx) {
    try {
        const key = `${tx}`;

        if (txIndexMap.has(key)) {
            console.log('has key******************')
            return;
        }

        storeData(key, 60000);

        const transaction = await connection.getTransaction(tx, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 1,
        });

        const { postTokenBalances, preTokenBalances, status } = transaction.meta;
        console.log('status : ', status)
        console.log('postTokenBalances, preTokenBalances', postTokenBalances, preTokenBalances)
        

        if (status.Err) {
            return true;
        }

        const balanceData = [];

        for (let i = 0; i < postTokenBalances.length; i++) {
            if (
                postTokenBalances[i].mint == WSOL_ADDRESS &&
                postTokenBalances[i].uiTokenAmount.amount == 0
            ) {
                continue;
            }
            if (
                postTokenBalances[i].mint ==
                "CGKtv3vELziHAjrDj919yymXxyyhJury37TDQJHuXjSF"
            ) {
                continue;
            }
            const matchedPre = preTokenBalances.find(
                (t) => t.accountIndex == postTokenBalances[i].accountIndex
            );
            // console.log("matchedPre : ",matchedPre)
            balanceData.push({
                mint: postTokenBalances[i].mint,
                owner: postTokenBalances[i].owner,
                postamount: postTokenBalances[i].uiTokenAmount.amount,
                preamount: matchedPre.uiTokenAmount.amount,
            });
        }

        // If First token change amount is minus, it is buy, otherwise it is sell
        const type =
            balanceData[0].postamount - balanceData[0].preamount > 0 ? "buy" : "sell";

        const quoteToken = balanceData.find((t) => t.mint == WSOL_ADDRESS);
        const baseAmount = Math.abs(
            balanceData[0].postamount - balanceData[0].preamount
        );
        const quoteAmount = Math.abs(quoteToken.postamount - quoteToken.preamount);
        const price = quoteAmount / baseAmount;

        const isSell = type === "sell";
        const baseToken = isSell ? balanceData[0].mint : quoteToken.mint;
        const quoteTokenAddress = isSell ? quoteToken.mint : balanceData[0].mint;
        const amountIn = isSell ? baseAmount / decimal : quoteAmount / decimal;
        const amountOut = isSell ? quoteAmount / decimal : baseAmount / decimal;

        // const baseUsdPrice = await getPairUsdPrice(bscSolUsdtAddress); // wsol-usdt to get sol usdPrice
        // const baseUsdPrice = await getSolTokenPrice(WSOL_ADDRESS);

        // const currentPrice = await getQuote(baseToken, quoteTokenAddress);

        const saveData = {
            eventDisplayType: type,
            hash: tx,
            signer: balanceData[0].owner,
            baseToken,
            quoteToken: quoteTokenAddress,
            amountInUsd: 0,
            amountOutUsd: 0,
            // amountInUsd: isSell
            //     ? price * baseUsdPrice?.priceUSD
            //     : Number(baseUsdPrice?.priceUSD),
            // amountOutUsd: isSell
            //     ? Number(baseUsdPrice?.priceUSD)
            //     : price * baseUsdPrice?.priceUSD,
            amountIn,
            amountOut,
            poolAddress: quoteToken.owner,
            price,
        };
        console.log("baseToken : ", baseToken);
        console.log("quoteTokenAddress : ", quoteTokenAddress);
        
        process.exit();

        if (baseToken.toLocaleLowerCase() == "bllbatshfpgksaugmsqnjafnhebt8xpncaeyrpegwovk" && quoteTokenAddress.toLocaleLowerCase() == "gpsyuulmgphsqtyswmgshxw6fhmrjxc3gy2881h3rcuf") {

            console.log("baseToken_____________ : ", baseToken);
            console.log('saveData : ', saveData);
            return;
        }


        const prevTrx = await SolTrxHistory.findOne({ hash: tx });

        if (!prevTrx) {
            await SolTrxHistory.create(saveData);
            // await axios.post("https://api-solana.biokript.com/txns", {
            //     hash: saveData?.hash,
            //     signer: saveData?.signer,
            //     baseToken: saveData?.baseToken,
            //     quoteToken: saveData?.quoteToken,
            //     amountIn: Number(saveData?.amountIn),
            //     amountOut: Number(saveData?.amountOut),
            //     baseUsdAmount: Number(saveData?.amountInUsd),
            //     quoteUsdAmount: Number(saveData?.amountOutUsd),
            //     poolAddress: "",
            // });
            // const currentUsdPrice = baseUsdPrice?.priceUSD * currentPrice;

            // ohlcv data
            // await handleOrderEvent(
            //   quoteToken.owner,
            //   currentUsdPrice,
            //   isSell
            //     ? amountIn * price * baseUsdPrice?.priceUSD
            //     : amountIn * baseUsdPrice?.priceUSD
            // );
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
async function getRecentTransactions(poolAddress) {
    try {

        // console.log('---------------------------------------------------------------')
        // console.log('---------------------------------------------------------------');
        let requestConfig = {};
        const lastTrx = await SolTrxHistory.findOne({ poolAddress }).sort({
            createdAt: -1,
        });

        if (lastTrx) {
            requestConfig.until = lastTrx.hash;
        } else {
            requestConfig.limit = 15;
        }

        const signatures = await connection.getSignaturesForAddress(
            new PublicKey(poolAddress),
            requestConfig
        );

        for (let i = signatures.length - 1; i >= 0; i--) {
            const { signature } = signatures[i];
            console.log(signature, "signature");
            fetchTransaction(signature);
        }
    } catch (err) {
        console.error(err, "getRecentTransactions Error");
    }
}

// Webhook function to get realtime transactions
function subscribeToTransactions() {
    console.log("Subscribing to transactions...");
    connection.onLogs(
        programId,
        (log) => {
            // console.log("New transaction log:", log);
            fetchTransaction(log.signature);
        },
        "finalized"
    );
}

process.env.PROD === "true" &&
    cron.schedule("*/20 * * * * *", async () => {
        console.log("running every one minute", new Date());
        // const provider = new AnchorProvider(connection, {
        //     publicKey: new PublicKey("FUg6vdQyauSKCWffzyj8H1k8snSao4TC3oKqUFoRDZQE"),
        // });
        // setProvider(provider);
        // const program = new Program(IDL, programId);
        // const swapPools = await program.account.swapPair.all();
        // console.log("swapPools length; ", swapPools.length)

        // for (let i = 0; i < swapPools.length; i++) {
        //     const tokenADetail = await getAccount(
        //         connection,
        //         swapPools[i].account.tokenAAccount
        //     );
        //     if ((tokenADetail.owner.toString()).toLocaleLowerCase() == "5lthp7u9ytnu6vhqufaug834ge6yqgj4isqgfckcjqq3") {
        //         console.log("PoolAddress ; ", tokenADetail.owner.toString())

        //         getRecentTransactions(tokenADetail.owner.toString());
        //     }
        // }
        let a = [
            {
              accountIndex: 1,
              mint: 'GPsYUuLMGPhSQTYSwMgsHXW6FHmrJXc3gY2881h3RCUF',
              owner: 'BZ1KL2JcLA6CF7ZkihqdCCLhL7dKA5p2P3kymjQvMSFw',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '49165292527665',
                decimals: 9,
                uiAmount: 49165.292527665,
                uiAmountString: '49165.292527665'
              }
            },
            {
              accountIndex: 4,
              mint: 'BLLbAtSHFpgkSaUGmSQnjafnhebt8XPncaeYrpEgWoVk',
              owner: 'BZ1KL2JcLA6CF7ZkihqdCCLhL7dKA5p2P3kymjQvMSFw',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '28343104274000',
                decimals: 9,
                uiAmount: 28343.104274,
                uiAmountString: '28343.104274'
              }
            },
            {
              accountIndex: 5,
              mint: 'BLLbAtSHFpgkSaUGmSQnjafnhebt8XPncaeYrpEgWoVk',
              owner: '5LTHP7U9YtnU6VhQUFAug834gE6Yqgj4isqgFckCJQQ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '907787186705629127',
                decimals: 9,
                uiAmount: 907787186.7056292,
                uiAmountString: '907787186.705629127'
              }
            },
            {
              accountIndex: 6,
              mint: 'GPsYUuLMGPhSQTYSwMgsHXW6FHmrJXc3gY2881h3RCUF',
              owner: '5LTHP7U9YtnU6VhQUFAug834gE6Yqgj4isqgFckCJQQ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '164656566535064456',
                decimals: 9,
                uiAmount: 164656566.53506446,
                uiAmountString: '164656566.535064456'
              }
            },
            {
              accountIndex: 7,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '79uyW5Gs5Zs1Eu3dnZSpKDCwLKx1iGusAEM5VBN5fJUu',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '385716574',
                decimals: 2,
                uiAmount: 3857165.74,
                uiAmountString: '3857165.74'
              }
            },
            {
              accountIndex: 8,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '9r6hhTaM5u1qZ5N6jdSm3k5L1fzgGw1Qv8kauyRHkgf4',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1972119089',
                decimals: 2,
                uiAmount: 19721190.89,
                uiAmountString: '19721190.89'
              }
            },
            {
              accountIndex: 9,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'DMFm8UMpyq445VSxNMLJXgvaAKQqPNxd4NJsRnpjnTkN',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '266136939064784',
                decimals: 2,
                uiAmount: 2661369390647.84,
                uiAmountString: '2661369390647.84'
              }
            },
            {
              accountIndex: 10,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'DJrh65GmTwfMDacvBg59pHt4NLPRKeGSBtW788rPS8RU',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1',
                decimals: 2,
                uiAmount: 0.01,
                uiAmountString: '0.01'
              }
            },
            {
              accountIndex: 11,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'Dr8bAcRBFYfRxYgA8YaL4QW4VGgLvDTDNJEViAH7RbnG',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '332765167410',
                decimals: 2,
                uiAmount: 3327651674.1,
                uiAmountString: '3327651674.1'
              }
            },
            {
              accountIndex: 12,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '4aZRGmK8rEJ89CRG9ZAmRtBpev7Q6uC1RZBy165dqaFT',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '5982006817472',
                decimals: 2,
                uiAmount: 59820068174.72,
                uiAmountString: '59820068174.72'
              }
            },
            {
              accountIndex: 13,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'Ba24zK8AkKAkxHGygLM8FaHCx5hUwPvEwuq5EzL19nJ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1982921470966',
                decimals: 2,
                uiAmount: 19829214709.66,
                uiAmountString: '19829214709.66'
              }
            }
          ];
        let b = [
            {
              accountIndex: 4,
              mint: 'BLLbAtSHFpgkSaUGmSQnjafnhebt8XPncaeYrpEgWoVk',
              owner: 'BZ1KL2JcLA6CF7ZkihqdCCLhL7dKA5p2P3kymjQvMSFw',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '300000000000000',
                decimals: 9,
                uiAmount: 300000,
                uiAmountString: '300000'
              }
            },
            {
              accountIndex: 5,
              mint: 'BLLbAtSHFpgkSaUGmSQnjafnhebt8XPncaeYrpEgWoVk',
              owner: '5LTHP7U9YtnU6VhQUFAug834gE6Yqgj4isqgFckCJQQ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '907515529809903127',
                decimals: 9,
                uiAmount: 907515529.8099031,
                uiAmountString: '907515529.809903127'
              }
            },
            {
              accountIndex: 6,
              mint: 'GPsYUuLMGPhSQTYSwMgsHXW6FHmrJXc3gY2881h3RCUF',
              owner: '5LTHP7U9YtnU6VhQUFAug834gE6Yqgj4isqgFckCJQQ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '164705731827592121',
                decimals: 9,
                uiAmount: 164705731.82759213,
                uiAmountString: '164705731.827592121'
              }
            },
            {
              accountIndex: 7,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '79uyW5Gs5Zs1Eu3dnZSpKDCwLKx1iGusAEM5VBN5fJUu',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '334420066',
                decimals: 2,
                uiAmount: 3344200.66,
                uiAmountString: '3344200.66'
              }
            },
            {
              accountIndex: 8,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '9r6hhTaM5u1qZ5N6jdSm3k5L1fzgGw1Qv8kauyRHkgf4',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1972118721',
                decimals: 2,
                uiAmount: 19721187.21,
                uiAmountString: '19721187.21'
              }
            },
            {
              accountIndex: 9,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'DMFm8UMpyq445VSxNMLJXgvaAKQqPNxd4NJsRnpjnTkN',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '266136889319613',
                decimals: 2,
                uiAmount: 2661368893196.13,
                uiAmountString: '2661368893196.13'
              }
            },
            {
              accountIndex: 10,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'DJrh65GmTwfMDacvBg59pHt4NLPRKeGSBtW788rPS8RU',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1',
                decimals: 2,
                uiAmount: 0.01,
                uiAmountString: '0.01'
              }
            },
            {
              accountIndex: 11,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'Dr8bAcRBFYfRxYgA8YaL4QW4VGgLvDTDNJEViAH7RbnG',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '332765105211',
                decimals: 2,
                uiAmount: 3327651052.11,
                uiAmountString: '3327651052.11'
              }
            },
            {
              accountIndex: 12,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: '4aZRGmK8rEJ89CRG9ZAmRtBpev7Q6uC1RZBy165dqaFT',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '5982005699342',
                decimals: 2,
                uiAmount: 59820056993.42,
                uiAmountString: '59820056993.42'
              }
            },
            {
              accountIndex: 13,
              mint: '49bX8qwkJ7X1DygU2KqCfE5DBkw5TDdCANAxdYwjzA5z',
              owner: 'Ba24zK8AkKAkxHGygLM8FaHCx5hUwPvEwuq5EzL19nJ3',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              uiTokenAmount: {
                amount: '1982921100327',
                decimals: 2,
                uiAmount: 19829211003.27,
                uiAmountString: '19829211003.27'
              }
            }
          ]

        for (let i = 0; i < a.length; i++) {
            if (
                a[i].mint == WSOL_ADDRESS &&
                a[i].uiTokenAmount.amount == 0
            ) {
                continue;
            }
            if (
                a[i].mint ==
                "CGKtv3vELziHAjrDj919yymXxyyhJury37TDQJHuXjSF"
            ) {
                continue;
            }
            const matchedPre = b.find(
                (t) => t.accountIndex == a[i].accountIndex
            );
            console.log("matchedPre : ",matchedPre)
           
        }


    });

subscribeToTransactions();
module.exports = { subscribeToTransactions, fetchTransaction };
