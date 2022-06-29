const { run, ethers } = require("hardhat")

const verify = async (contractAddress, args) => {
    console.log("Verifying contract...")
    try {
        await run("verify:verify", {
            address: contractAddress,
            constructorArguments: args,
            /*   [
                (await ethers.getContract("VRFCoordinatorV2Mock")).address,
                ethers.utils.parseEther("0.01"),
                "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc",
                7488,
                500000,
                30,
            ], */
        })
    } catch (e) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("Already verified!")
        } else {
            console.log(e)
        }
    }
}

module.exports = {
    verify,
}
