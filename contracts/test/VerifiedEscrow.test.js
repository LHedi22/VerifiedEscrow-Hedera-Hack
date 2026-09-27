const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VerifiedEscrow", function () {
  const SOW = ethers.keccak256(ethers.toUtf8Bytes("sow"));    // any bytes32 works in tests
  const REC = ethers.keccak256(ethers.toUtf8Bytes("record"));
  const AMT = ethers.parseEther("5");
  let c, oracle, client, freelancer, arbitrator, stranger;

  beforeEach(async () => {
    [oracle, client, freelancer, arbitrator, stranger] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("VerifiedEscrow")).deploy(oracle.address);
    await c.connect(client).createEscrow(freelancer.address, arbitrator.address, SOW, { value: AMT });
  });

  it("1 pass releases to freelancer and stores the claim", async () => {
    await expect(c.connect(oracle).submitVerdict(1, true, REC, SOW))
      .to.changeEtherBalances([freelancer, c], [AMT, -AMT]);
    const e = await c.escrows(1);
    expect(e.status).to.equal(2); expect(e.verdictPassed).to.equal(true); expect(e.verdictHash).to.equal(REC);
  });
  it("2 fail holds, arbitrator release pays freelancer", async () => {
    await expect(c.connect(oracle).submitVerdict(1, false, REC, SOW)).to.emit(c, "HeldForReview").withArgs(1, REC);
    expect((await c.escrows(1)).verdictPassed).to.equal(false);
    await expect(c.connect(arbitrator).resolveDispute(1, true)).to.changeEtherBalance(freelancer, AMT);
    expect((await c.escrows(1)).status).to.equal(2);
  });
  it("3 fail holds, arbitrator refund pays client", async () => {
    await c.connect(oracle).submitVerdict(1, false, REC, SOW);
    await expect(c.connect(arbitrator).resolveDispute(1, false)).to.changeEtherBalance(client, AMT);
    expect((await c.escrows(1)).status).to.equal(4);
  });
  it("4 non-oracle submitVerdict reverts", async () => {
    await expect(c.connect(stranger).submitVerdict(1, true, REC, SOW)).to.be.revertedWith("not oracle");
  });
  it("5 wrong sowHash reverts", async () => {
    await expect(c.connect(oracle).submitVerdict(1, true, REC, REC)).to.be.revertedWith("SOW mismatch");
  });
  it("6 double submission reverts", async () => {
    await c.connect(oracle).submitVerdict(1, false, REC, SOW);
    await expect(c.connect(oracle).submitVerdict(1, true, REC, SOW)).to.be.revertedWith("not funded");
  });
  it("7 non-arbitrator resolve reverts; resolve before a verdict reverts", async () => {
    await expect(c.connect(arbitrator).resolveDispute(1, true)).to.be.revertedWith("not under review");
    await c.connect(oracle).submitVerdict(1, false, REC, SOW);
    await expect(c.connect(client).resolveDispute(1, true)).to.be.revertedWith("not arbitrator");
  });
  it("8 parties must be distinct; empty verdict hash rejected", async () => {
    await expect(c.connect(client).createEscrow(client.address, arbitrator.address, SOW, { value: AMT }))
      .to.be.revertedWith("parties not distinct");
    await expect(c.connect(client).createEscrow(freelancer.address, freelancer.address, SOW, { value: AMT }))
      .to.be.revertedWith("parties not distinct");
    await expect(c.connect(oracle).submitVerdict(1, true, ethers.ZeroHash, SOW)).to.be.revertedWith("empty verdict hash");
  });
});
