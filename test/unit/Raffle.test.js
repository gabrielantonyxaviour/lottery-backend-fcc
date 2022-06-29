const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit tests", async function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, interval
          let deployer

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture("all")
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await ethers.utils.parseEther("0.01")
              interval = (await raffle.getInterval()).toString()
          })

          describe("constructor", async function () {
              it("initializes raffle correctly", async function () {
                  const raffleState = (await raffle.getRaffleState()).toString()
                  assert.equal(raffleState, "0")
                  assert.equal(interval, networkConfig[network.config.chainId]["interval"])
              })
          })

          describe("enterRaffle", async function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(
                      raffle.enterRaffle({ value: ethers.utils.parseEther("0.005") })
                  ).to.be.revertedWith("Raffle__NotEnoughETHEntered")
              })

              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  assert.equal((await raffle.getNumberOfPlayers()).toString(), "1")
                  assert.equal((await raffle.getPlayer(0)).toString(), deployer)
              })

              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })

              it("doesnt allow entrance when calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
                  // Pretending to be chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle_NotOpen"
                  )
              })
          })

          describe("checkUpkeep", async function () {
              it("returns false if people have not sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if it is not OPEN", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  // Pretending to be chainlink keeper
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal((await raffle.getRaffleState()).toString(), "1")
                  assert(!upkeepNeeded)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) - 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", async function () {
              it("run only when checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      `Raffle__UpkeepNotNeeded(0, 0, 0)`
                  )
              })
              it("updates the raffle state, emits an event and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId // The first event (index 0) is emitted by VRFCoordinator
                  assert(parseInt(requestId, 10) > 0)
                  assert.equal((await raffle.getRaffleState()).toString(), "1")
              })
          })

          describe("fullfillRandomWords", async function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [parseInt(interval, 10) + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              it("picks winner, resets the lottery and sends the winner", async function () {
                  const additionalEntrants = 5
                  const startingAccountIndex = 1
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      raffle.connect(accounts[i])
                      await raffle.enterRaffle({ value: raffleEntranceFee })
                  }

                  const startingTimestamp = await raffle.getLatestTimeStamp()

                  await new Promise(async function (resolve, reject) {
                      raffle.once("WinnerPicked", async function () {
                          console.log("Event fired!!!!!!")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              const winnerEndingBalance = (await accounts[0].getBalance()).add(
                                  gasCost
                              )
                              const raffleState = await raffle.getRaffleState()
                              const endingTimestamp = await raffle.getLatestTimeStamp()
                              await expect(raffle.getPlayer(0)).to.be.reverted
                              assert.equal(raffleState, 0)
                              console.log(winnerEndingBalance.toString())
                              console.log(winnnerStartingBalance.toString())
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnnerStartingBalance
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString()
                              )
                              assert.equal(recentWinner, accounts[0].address)
                              assert(endingTimestamp > startingTimestamp)
                          } catch (e) {
                              console.log(e.toString())
                              reject()
                          }
                          resolve()
                      })

                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnnerStartingBalance = await accounts[0].getBalance()
                      const { gasUsed, effectiveGasPrice } = txReceipt
                      const gasCost = gasUsed.mul(effectiveGasPrice)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txResponse.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
