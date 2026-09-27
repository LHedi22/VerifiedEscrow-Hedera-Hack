"""Reassembly rules (TRD §6.1) against synthetic mirror-node messages."""
import base64
import hashlib

import pytest

from app.services.mirror import check, parse_tx_id, reassemble

TX = "0.0.1001@1759501329.481234567"
FOREIGN_TX = {"account_id": "0.0.2002", "nonce": 0, "scheduled": False, "transaction_valid_start": "1759501329.999999999"}
OURS = {"account_id": "0.0.1001", "nonce": 0, "scheduled": False, "transaction_valid_start": "1759501329.481234567"}
RECORD = ('{"contract_id":"dev-1","deliverable":"café ا ' + "x" * 2500 + '"}').encode("utf-8")


def msgs(data: bytes, initial: dict, seq0: int, size: int = 1024) -> list[dict]:
    parts = [data[i:i + size] for i in range(0, len(data), size)]
    return [
        {
            "sequence_number": seq0 + n,
            "consensus_timestamp": f"17595013{30 + n}.000000001",
            "message": base64.b64encode(p).decode(),
            "chunk_info": {"initial_transaction_id": initial, "number": n + 1, "total": len(parts)},
        }
        for n, p in enumerate(parts)
    ]


def test_parse_tx_id_pads_nanos():
    assert parse_tx_id("0.0.5@1759501329.48123") == ("0.0.5", "1759501329.481230000")
    assert parse_tx_id(TX) == ("0.0.1001", "1759501329.481234567")
    with pytest.raises(ValueError):
        parse_tx_id("garbage")


def test_reassembles_three_chunks_and_confirms_by_hash():
    m = msgs(RECORD, OURS, 10)
    assert len(m) == 3
    c = check(m, "0.0.77", TX, hashlib.sha256(RECORD).hexdigest())
    assert c and c.record_bytes == RECORD
    assert (c.sequence_first, c.sequence_last, c.chunk_count) == (10, 12, 3)
    assert c.consensus_timestamp == m[-1]["consensus_timestamp"]


def test_foreign_chunk_mixed_in_is_ignored():
    ours = msgs(RECORD, OURS, 10)
    foreign = msgs(b"X" * 1500, FOREIGN_TX, 11)[:1]  # interleaved message from another transaction
    mixed = [ours[0], foreign[0], *ours[1:]]
    assert check(mixed, "0.0.77", TX, hashlib.sha256(RECORD).hexdigest())


def test_out_of_order_chunks_are_sorted():
    m = msgs(RECORD, OURS, 10)
    assert reassemble(list(reversed(m)), TX)[0] == RECORD


def test_missing_chunk_is_incomplete():
    m = msgs(RECORD, OURS, 10)
    assert reassemble([m[0], m[2]], TX) is None


def test_null_chunk_info_is_one_of_one():
    one = [{"sequence_number": 5, "consensus_timestamp": "1.2", "message": base64.b64encode(b"abc").decode(),
            "chunk_info": None}]
    assert check(one, "0.0.77", TX, hashlib.sha256(b"abc").hexdigest()).chunk_count == 1


def test_hash_mismatch_is_not_confirmed():
    assert check(msgs(RECORD, OURS, 10), "0.0.77", TX, "0" * 64) is None
