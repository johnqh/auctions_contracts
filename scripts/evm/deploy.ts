import { ethers, upgrades, run } from "hardhat";
import * as fs from "fs";

// Parse command line args for verification flag
const args = process.argv.slice(2);
const shouldVerify = args.includes("--verify");
const skipVerify = args.includes("--no-verify");

async function verifyContract(address: string, constructorArguments: unknown[] = []): Promise<boolean> {
  console.log(`\nVerifying contract at ${address}...`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("Contract verified successfully!");
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Already Verified")) {
      console.log("Contract already verified");
      return true;
    }
    console.error("Verification failed:", errorMessage);
    return false;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Deploying AuctionRegistry with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
  console.log("Network:", network.name, `(chainId: ${network.chainId})`);

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
    network: network.name,
    chainId: network.chainId.toString(),
    proxy: proxyAddress,
    implementation: implAddress,
    owner: deployer.address,
    feeRecipient: feeRecipient,
    feeRate: feeRate,
    deployedAt: new Date().toISOString(),
    verified: false,
  };

  // Verify contracts on block explorer (if not local and not skipped)
  const isLocalNetwork = network.chainId === 1337n || network.chainId === 31337n;

  if (!isLocalNetwork && !skipVerify) {
    // Wait for block confirmations before verifying
    console.log("\nWaiting for block confirmations before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    if (shouldVerify || process.env.AUTO_VERIFY === "true") {
      // Verify implementation contract
      const implVerified = await verifyContract(implAddress);

      // Verify proxy contract (OpenZeppelin proxies auto-verify on most explorers)
      // The proxy points to the implementation, so verifying impl is usually sufficient

      deploymentInfo.verified = implVerified;
    } else {
      console.log("\nSkipping verification. Run with --verify flag to verify contracts.");
      console.log(`Or verify manually: npx hardhat verify --network ${network.name} ${implAddress}`);
    }
  }

  console.log("\nDeployment Info:", JSON.stringify(deploymentInfo, null, 2));

  // Save deployment info to file
  const outputDir = "deployments";
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/evm-${network.name}-${network.chainId}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nSaved deployment info to:", outputPath);

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
