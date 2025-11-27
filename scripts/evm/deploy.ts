import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying AuctionRegistry with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy parameters
  const feeRecipient = deployer.address; // Use deployer as fee recipient initially
  const feeRate = 50; // 0.5%

  console.log("\nDeploying AuctionRegistry as UUPS proxy...");

  const AuctionRegistry = await ethers.getContractFactory("AuctionRegistry");
  const auctionRegistry = await upgrades.deployProxy(
    AuctionRegistry,
    [deployer.address, feeRecipient, feeRate],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );

  await auctionRegistry.waitForDeployment();
  const proxyAddress = await auctionRegistry.getAddress();

  console.log("\n=== Deployment Complete ===");
  console.log("AuctionRegistry Proxy:", proxyAddress);
  console.log("Owner:", deployer.address);
  console.log("Fee Recipient:", feeRecipient);
  console.log("Fee Rate:", feeRate, "basis points (0.5%)");

  // Get implementation address
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Implementation:", implAddress);

  // Save deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    proxy: proxyAddress,
    implementation: implAddress,
    owner: deployer.address,
    feeRecipient: feeRecipient,
    feeRate: feeRate,
    deployedAt: new Date().toISOString(),
  };

  console.log("\nDeployment Info:", JSON.stringify(deploymentInfo, null, 2));

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
