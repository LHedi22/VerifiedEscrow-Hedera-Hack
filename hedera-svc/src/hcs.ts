import { TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { bytesHash } from "canonical";
import { oracleSdkClient } from "./accounts.js";
import { hcsTopicId } from "./config.js";
import { hcsQueue } from "./queue.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public reason?: string) {
    super(message);
  }
}

export type SubmitResult = { txId: string; topicId: string; sequenceFirst: number; sequenceLast: number; chunks: number };

/** POST /hcs/submit (TRD §6.1): raw canonical bytes, hash-checked, executeAll, one submission at a time. */
export async function submitRecord(messageBase64: string, expectedHash: string): Promise<SubmitResult> {
  if (typeof messageBase64 !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash ?? "")) {
    throw new HttpError(400, "BAD_REQUEST", "messageBase64 and a lowercase 64-hex expectedHash are required");
  }
  const bytes = new Uint8Array(Buffer.from(messageBase64, "base64"));
  if (bytesHash(bytes) !== expectedHash) {
    throw new HttpError(400, "HASH_MISMATCH", "sha256(decoded bytes) does not equal expectedHash");
  }
  if (bytes.length > 18_000) throw new HttpError(422, "RECORD_TOO_LARGE", `record is ${bytes.length} bytes (max 18,000)`);

  return hcsQueue.run(async () => {
    const client = oracleSdkClient();
    const topicId = hcsTopicId();
    const responses = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(bytes) // raw bytes, never a string
      .setMaxChunks(20)
      .executeAll(client); // execute() would return only chunk 1
    const first = await responses[0].getReceipt(client);
    const last = responses.length === 1 ? first : await responses[responses.length - 1].getReceipt(client);
    return {
      txId: responses[0].transactionId.toString(),
      topicId,
      sequenceFirst: Number(first.topicSequenceNumber),
      sequenceLast: Number(last.topicSequenceNumber),
      chunks: responses.length,
    };
  });
}
