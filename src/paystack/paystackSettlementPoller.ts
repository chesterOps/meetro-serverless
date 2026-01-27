import axios from "axios";
import Donation from "../models/donation.model";
import Job from "../models/job.model";
import { connectToDatabase } from "../config/db";

type Settlement = {
  id: number;
  status: "pending" | "success" | "failed" | "processing";
  settlement_date?: Date;
};

type SettlementTxn = {
  id: number;
  reference: string;
  status: string;
  paid_at?: string;
};

if (!process.env.PAYSTACK_SECRET_KEY) {
  throw new Error("PAYSTACK_SECRET_KEY is required");
}

// Default lookback period in days (configurable via env)
const DEFAULT_LOOKBACK_DAYS = parseInt(
  process.env.SETTLEMENT_LOOKBACK_DAYS || "1",
  10,
);

export const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  },
  timeout: 30000,
});

async function listSettlements(params: {
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  perPage?: number;
}) {
  const response = await paystack.get("/settlement", { params });
  return response.data?.data as Settlement[];
}

async function listSettlementTransactions(
  settlementId: number,
  params?: { page?: number; perPage?: number },
) {
  const res = await paystack.get(`/settlement/${settlementId}/transactions`, {
    params,
  });
  return res.data?.data as SettlementTxn[];
}

async function runPaystackSettlementReconcile() {
  console.log("Starting Paystack settlement reconciliation...");

  // Check if job ran in the last hour
  const lastRunAt = await Job.getLastRun("paystack_settlement_reconcile");
  const from = (
    lastRunAt ??
    new Date(Date.now() - 1000 * 60 * 60 * 24 * DEFAULT_LOOKBACK_DAYS)
  ).toISOString();

  console.log(`Fetching settlements since: ${from}`);

  let totalReconciled = 0;
  let page = 1;
  let hasMoreSettlements = true;

  // Paginate through all settlements
  while (hasMoreSettlements) {
    const settlements = await listSettlements({
      from,
      status: "success",
      perPage: 50,
      page,
    });

    if (!settlements || settlements.length === 0) {
      hasMoreSettlements = false;
      break;
    }

    console.log(`Processing page ${page}: ${settlements.length} settlements`);

    for (const settlement of settlements) {
      // Paginate through transactions for this settlement
      let txnPage = 1;
      let hasMoreTxns = true;

      while (hasMoreTxns) {
        const txns = await listSettlementTransactions(settlement.id, {
          perPage: 100,
          page: txnPage,
        });

        if (!txns || txns.length === 0) {
          hasMoreTxns = false;
          break;
        }

        // Collect all valid references
        const references = txns
          .map((t) => t.reference)
          .filter((ref): ref is string => Boolean(ref));

        if (references.length === 0) {
          txnPage++;
          if (txns.length < 100) hasMoreTxns = false;
          continue;
        }

        // Batch query donations by references
        const donations = await Donation.find({
          paymentReference: { $in: references },
          "metadata.gateway": "paystack",
          isPayoutEligible: false,
          payoutStatus: "pending",
          status: "completed",
        });

        // Update donations using bulkWrite for better performance
        if (donations.length > 0) {
          const now = new Date();
          const bulkOps = donations.map((donation) => ({
            updateOne: {
              filter: { _id: donation._id },
              update: {
                settledAt: now,
                isPayoutEligible: true,
              },
            },
          }));
          await Donation.bulkWrite(bulkOps);
          totalReconciled += donations.length;
        }

        // Update tickets or other related models if needed here

        // Next page of transactions
        txnPage++;
        if (txns.length < 100) hasMoreTxns = false;
      }
    }

    page++;
    if (settlements.length < 50) hasMoreSettlements = false;
  }

  console.log(`Reconciliation complete. Total reconciled: ${totalReconciled}`);

  await Job.updateLastRun("paystack_settlement_reconcile");
}

// Export Lambda handler for serverless
export const handler = async (_event: any, _context: any) => {
  try {
    console.log("Lambda triggered for Paystack settlement reconciliation");
    await connectToDatabase();
    await runPaystackSettlementReconcile();
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Settlement reconciliation completed successfully",
      }),
    };
  } catch (error) {
    console.error("Error in Paystack settlement reconciliation:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Settlement reconciliation failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
