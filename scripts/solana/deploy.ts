/**
 * Solana Auction Program Deployment Script
 *
 * Usage:
 *   npx ts-node scripts/solana/deploy.ts --network devnet
 *   npx ts-node scripts/solana/deploy.ts --network mainnet-beta
 *
 * Environment variables:
 *   SOLANA_KEYPAIR_PATH - Path to deployer keypair JSON file (default: ~/.config/solana/id.json)
 *   SOLANA_PROGRAM_PATH - Path to compiled .so file (default: target/deploy/auctions.so)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line args
const args = process.argv.slice(2);
const networkIndex = args.indexOf('--network');
const network = networkIndex !== -1 ? args[networkIndex + 1] : 'devnet';

// Configuration
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH ||
  path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');

const PROGRAM_PATH =
  process.env.SOLANA_PROGRAM_PATH || 'target/deploy/auctions.so';

// Program state PDA seed
const PROGRAM_STATE_SEED = Buffer.from('auction_state');

// Instruction discriminators (must match Rust program)
enum InstructionType {
  Initialize = 0,
  SetPaused = 1,
  TransferOwnership = 2,
}

interface DeploymentInfo {
  network: string;
  programId: string;
  programStatePDA: string;
  owner: string;
  deployedAt: string;
  transactionSignature?: string;
}

async function loadKeypair(keypairPath: string): Promise<Keypair> {
  const resolvedPath = keypairPath.replace('~', process.env.HOME || '');
  const keypairData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

function deriveProgramStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROGRAM_STATE_SEED], programId);
}

function buildInitializeInstruction(
  programId: PublicKey,
  authority: PublicKey,
  programStatePDA: PublicKey
): TransactionInstruction {
  // Borsh serialization: 1 byte discriminator
  const data = Buffer.alloc(1);
  data.writeUInt8(InstructionType.Initialize, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function checkProgramDeployed(
  connection: Connection,
  programId: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(programId);
  return accountInfo !== null && accountInfo.executable;
}

async function checkProgramInitialized(
  connection: Connection,
  programStatePDA: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(programStatePDA);
  if (!accountInfo) return false;

  // Check if initialized (last byte should be 1)
  // ProgramState: owner (32) + paused (1) + auction_count (8) + bump (1) + is_initialized (1) = 43 bytes
  if (accountInfo.data.length >= 43) {
    return accountInfo.data[42] === 1;
  }

  return false;
}

async function initializeProgram(
  connection: Connection,
  programId: PublicKey,
  authority: Keypair
): Promise<string> {
  const [programStatePDA] = deriveProgramStatePDA(programId);

  // Check if already initialized
  const initialized = await checkProgramInitialized(connection, programStatePDA);
  if (initialized) {
    console.log('Program already initialized');
    return 'already_initialized';
  }

  console.log('\nInitializing program state...');
  console.log('Program State PDA:', programStatePDA.toBase58());

  const instruction = buildInitializeInstruction(
    programId,
    authority.publicKey,
    programStatePDA
  );

  const transaction = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    authority,
  ]);

  console.log('Initialization transaction:', signature);
  return signature;
}

async function main() {
  console.log('=== Solana Auction Program Deployment ===\n');
  console.log('Network:', network);

  // Load keypair
  console.log('\nLoading keypair from:', KEYPAIR_PATH);
  let authority: Keypair;
  try {
    authority = await loadKeypair(KEYPAIR_PATH);
    console.log('Authority:', authority.publicKey.toBase58());
  } catch (error) {
    console.error('Failed to load keypair:', error);
    console.error('\nMake sure you have a keypair at:', KEYPAIR_PATH);
    console.error('Or set SOLANA_KEYPAIR_PATH environment variable');
    process.exit(1);
  }

  // Connect to network
  const rpcUrl =
    network === 'localnet'
      ? 'http://localhost:8899'
      : clusterApiUrl(network as 'devnet' | 'mainnet-beta' | 'testnet');

  console.log('\nConnecting to:', rpcUrl);
  const connection = new Connection(rpcUrl, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Authority balance:', balance / 1e9, 'SOL');

  if (balance < 0.1 * 1e9) {
    console.error('\nInsufficient balance! Need at least 0.1 SOL');
    if (network === 'devnet') {
      console.log('Request airdrop: solana airdrop 2 --url devnet');
    }
    process.exit(1);
  }

  // Load program ID from keypair file
  const programKeypairPath = 'target/deploy/auctions-keypair.json';
  let programId: PublicKey;

  try {
    if (fs.existsSync(programKeypairPath)) {
      const programKeypair = await loadKeypair(programKeypairPath);
      programId = programKeypair.publicKey;
      console.log('\nProgram ID (from keypair):', programId.toBase58());
    } else {
      console.error('\nProgram keypair not found at:', programKeypairPath);
      console.error('Build the program first: cargo build-bpf');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to load program keypair:', error);
    process.exit(1);
  }

  // Check if program is deployed
  const isDeployed = await checkProgramDeployed(connection, programId);

  if (!isDeployed) {
    console.log('\nProgram not deployed yet.');
    console.log('Deploy using:');
    console.log(`  solana program deploy ${PROGRAM_PATH} --url ${network}`);
    console.log('\nAfter deploying, run this script again to initialize.');

    // Still output partial deployment info
    const [programStatePDA] = deriveProgramStatePDA(programId);
    const deploymentInfo: DeploymentInfo = {
      network,
      programId: programId.toBase58(),
      programStatePDA: programStatePDA.toBase58(),
      owner: authority.publicKey.toBase58(),
      deployedAt: new Date().toISOString(),
    };

    console.log('\n=== Deployment Info (Pre-deploy) ===');
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // Save to file
    const outputPath = `deployments/solana-${network}.json`;
    fs.mkdirSync('deployments', { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log('\nSaved to:', outputPath);

    process.exit(0);
  }

  console.log('\nProgram is deployed!');

  // Initialize program
  const txSignature = await initializeProgram(connection, programId, authority);

  // Generate deployment info
  const [programStatePDA] = deriveProgramStatePDA(programId);
  const deploymentInfo: DeploymentInfo = {
    network,
    programId: programId.toBase58(),
    programStatePDA: programStatePDA.toBase58(),
    owner: authority.publicKey.toBase58(),
    deployedAt: new Date().toISOString(),
    transactionSignature:
      txSignature !== 'already_initialized' ? txSignature : undefined,
  };

  console.log('\n=== Deployment Complete ===');
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Save deployment info
  const outputPath = `deployments/solana-${network}.json`;
  fs.mkdirSync('deployments', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('\nSaved deployment info to:', outputPath);

  // Print usage instructions
  console.log('\n=== Next Steps ===');
  console.log('1. Update your client with the program ID:');
  console.log(`   const programId = '${programId.toBase58()}';`);
  console.log('\n2. Verify the program:');
  console.log(`   solana program show ${programId.toBase58()} --url ${network}`);
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
