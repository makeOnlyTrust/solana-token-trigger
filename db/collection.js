const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TrxDetailedEventsSchema = new Schema(
  {
    eventDisplayType: String,
    hash: String,
    signer: String,
    baseToken: String,
    quoteToken: String,
    amountInUsd: Number,
    amountOutUsd: Number,
    amountIn: Number,
    amountOut: Number,
    poolAddress: String,
    price: Number,
  },
  { timestamps: true }
);

const TrxEventsSchema = new Schema(
  {
    transactionHash: String,
    rpc: String,
    status: Boolean,
  },
  { timestamps: true }
);

module.exports = {
  SolTrxHistory: mongoose.model(
    "solana_trx_event_details",
    TrxDetailedEventsSchema
  ),
  TrxEvents: mongoose.model("solana_trx_events", TrxEventsSchema),
};
