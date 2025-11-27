import { ethers, upgrades } from "hardhat";

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;

  if (!proxyAddress) {
    throw new Error("PROXY_ADDRESS environment variable is required");
  }

  const [deployer] = await ethers.getSigners();

  console.log("Upgrading AuctionRegistry with account:", deployer.address);
  console.log("Proxy address:", proxyAddress);

  // Get current implementation
  const currentImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Current implementation:", currentImpl);

  // Deploy new implementation and upgrade
  console.log("\nUpgrading to new implementation...");

  const AuctionRegistry = await ethers.getContractFactory("AuctionRegistry");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, AuctionRegistry);

  await upgraded.waitForDeployment();

  // Get new implementation
  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("New implementation:", newImpl);

  console.log("\n=== Upgrade Complete ===");
  console.log("Proxy:", proxyAddress);
  console.log("Old Implementation:", currentImpl);
  console.log("New Implementation:", newImpl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
