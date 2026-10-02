// Generated from packages/contracts/out/MisthosVaultFactory.sol by export-abi.mjs. Do not edit.
export const misthosVaultFactoryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "implementation_",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createVault",
    inputs: [
      {
        name: "programId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "agent",
        type: "address",
        internalType: "address",
      },
      {
        name: "guardian",
        type: "address",
        internalType: "address",
      },
      {
        name: "limits",
        type: "tuple",
        internalType: "struct MisthosVault.Limits",
        components: [
          {
            name: "maxPerPayout",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "maxPerRound",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "maxPerDay",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "autoApproveThreshold",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "payeeCooldown",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "implementation",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "predictVaultAddress",
    inputs: [
      {
        name: "deployer",
        type: "address",
        internalType: "address",
      },
      {
        name: "programId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      {
        name: "programId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "agent",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "FailedDeployment",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [
      {
        name: "balance",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "needed",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ZeroAddress",
    inputs: [],
  },
] as const;
