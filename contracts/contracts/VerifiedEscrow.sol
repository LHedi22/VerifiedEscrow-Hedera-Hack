// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract VerifiedEscrow {
    enum Status { None, Funded, Released, Held, Refunded }

    struct Escrow {
        address client;
        address freelancer;
        address arbitrator;
        bytes32 sowHash;
        bytes32 verdictHash;
        bool verdictPassed;  // what the oracle claimed; checked publicly against the HCS record
        uint256 amount;      // tinybars on Hedera (see 7.3)
        Status status;
    }

    address public immutable oracle;
    uint256 public nextId = 1;
    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed id, address client, address freelancer, address arbitrator, uint256 amount, bytes32 sowHash);
    event VerdictSubmitted(uint256 indexed id, bool passed, bytes32 verdictHash);
    event Released(uint256 indexed id, address to, uint256 amount);
    event HeldForReview(uint256 indexed id, bytes32 verdictHash);
    event DisputeResolved(uint256 indexed id, bool released);
    event Refunded(uint256 indexed id, address to, uint256 amount);

    modifier onlyOracle() { require(msg.sender == oracle, "not oracle"); _; }

    constructor(address _oracle) {
        require(_oracle != address(0), "bad oracle");
        oracle = _oracle;
    }

    function createEscrow(address freelancer, address arbitrator, bytes32 sowHash)
        external payable returns (uint256 id)
    {
        require(msg.value > 0, "no funds");
        require(freelancer != address(0) && arbitrator != address(0), "bad party");
        require(freelancer != msg.sender && arbitrator != msg.sender && arbitrator != freelancer, "parties not distinct");
        id = nextId++;
        escrows[id] = Escrow(msg.sender, freelancer, arbitrator, sowHash, bytes32(0), false, msg.value, Status.Funded);
        emit EscrowCreated(id, msg.sender, freelancer, arbitrator, msg.value, sowHash);
    }

    function submitVerdict(uint256 id, bool passed, bytes32 verdictHash, bytes32 sowHashCheck)
        external onlyOracle
    {
        Escrow storage e = escrows[id];
        require(e.status == Status.Funded, "not funded");
        require(sowHashCheck == e.sowHash, "SOW mismatch");
        require(verdictHash != bytes32(0), "empty verdict hash");
        e.verdictHash = verdictHash;
        e.verdictPassed = passed;
        emit VerdictSubmitted(id, passed, verdictHash);
        if (passed) {
            _pay(id, e.freelancer, Status.Released);
            emit Released(id, e.freelancer, e.amount);
        } else {
            e.status = Status.Held;
            emit HeldForReview(id, verdictHash);
        }
    }

    function resolveDispute(uint256 id, bool release) external {
        Escrow storage e = escrows[id];
        require(msg.sender == e.arbitrator, "not arbitrator");
        require(e.status == Status.Held, "not under review");
        emit DisputeResolved(id, release);
        if (release) {
            _pay(id, e.freelancer, Status.Released);
            emit Released(id, e.freelancer, e.amount);
        } else {
            _pay(id, e.client, Status.Refunded);
            emit Refunded(id, e.client, e.amount);
        }
    }

    function _pay(uint256 id, address to, Status next) private {
        Escrow storage e = escrows[id];
        uint256 amt = e.amount;
        e.status = next;                     // effects before interaction
        (bool ok, ) = payable(to).call{value: amt}("");
        require(ok, "transfer failed");
    }
}
