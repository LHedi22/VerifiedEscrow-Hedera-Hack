import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { accountsSummary } from "./accounts.js";
import { config, deployment } from "./config.js";
import { HttpError, submitRecord } from "./hcs.js";

const app = express();
app.use(express.json({ limit: "64kb" }));

// Every call needs X-Internal-Token (TRD §4, Schema §6).
const expected = Buffer.from(config.internalToken);
app.use((req: Request, res: Response, next: NextFunction) => {
  const got = Buffer.from(req.header("X-Internal-Token") ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "missing or wrong X-Internal-Token" } });
    return;
  }
  next();
});

app.post("/hcs/submit", async (req, res, next) => {
  try {
    res.json(await submitRecord(req.body?.messageBase64, req.body?.expectedHash));
  } catch (e) {
    next(e);
  }
});

app.get("/accounts", async (_req, res, next) => {
  try {
    res.json(await accountsSummary());
  } catch (e) {
    next(e);
  }
});

// Error shape: { error: { code, message, reason? } }. Messages never include keys.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, reason: err.reason } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`hedera-svc error: ${message}`);
  res.status(502).json({ error: { code: "CHAIN_ERROR", message } });
});

app.listen(config.port, config.host, () => {
  console.log(`hedera-svc listening on http://${config.host}:${config.port}`);
  const d = deployment();
  if (d.topicId) console.log(`HCS topic: ${d.topicId} (demo topic from deployment.json)`);
  else if (d.devTopicId) console.log(`HCS topic: ${d.devTopicId} (DEV topic: no demo topicId yet, Day 1-2 only)`);
  else console.log("HCS topic: none configured; /hcs/submit will fail");
});
