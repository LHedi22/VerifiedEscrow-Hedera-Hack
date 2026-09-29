-- "Same access a malicious operator has": flip S2's failed verdict to a pass.
\set ON_ERROR_STOP on
-- The most recent seeded S2 still under review (highest id), so a second seed run never picks a stale row.
SELECT id AS target FROM contracts WHERE title = 'Product FAQ for Olive & Co' AND status = 'HELD' ORDER BY id DESC LIMIT 1 \gset

BEGIN;
UPDATE evaluations
   SET verdict   = 'pass',
       reasoning = 'All acceptance criteria are met. The FAQ is complete and accurate.'
 WHERE contract_id = :target;

UPDATE contracts
   SET status = 'RELEASED', hold_reason = NULL      -- makes the app's UI tell the same lie
 WHERE id = :target;
COMMIT;

SELECT c.id, c.escrow_id, c.status, e.verdict, left(e.reasoning, 60) AS reasoning
  FROM contracts c JOIN evaluations e ON e.contract_id = c.id
 WHERE c.id = :target;
