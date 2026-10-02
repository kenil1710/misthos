// Generated from packages/contracts/out/MisthosVault.sol by export-abi.mjs. Do not edit.
export const misthosVaultAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "token_",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DAY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_PAYOUTS_PER_ROUND",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "agent",
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
    name: "approveRound",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balance",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "cancelRound",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeRound",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getRound",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct MisthosVault.Round",
        components: [
          {
            name: "status",
            type: "uint8",
            internalType: "enum MisthosVault.RoundStatus",
          },
          {
            name: "proposedAt",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "total",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "decisionRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoundPayouts",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        internalType: "struct MisthosVault.Payout[]",
        components: [
          {
            name: "payoutId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "contributorId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "to",
            type: "address",
            internalType: "address",
          },
          {
            name: "amount",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "guardian",
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
    name: "initialize",
    inputs: [
      {
        name: "programId_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "owner_",
        type: "address",
        internalType: "address",
      },
      {
        name: "agent_",
        type: "address",
        internalType: "address",
      },
      {
        name: "guardian_",
        type: "address",
        internalType: "address",
      },
      {
        name: "limits_",
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
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "limits",
    inputs: [],
    outputs: [
      {
        name: "",
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
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
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
    name: "paid",
    inputs: [
      {
        name: "payoutId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "payeeOf",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct MisthosVault.Payee",
        components: [
          {
            name: "wallet",
            type: "address",
            internalType: "address",
          },
          {
            name: "payableAfter",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "programId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposeRound",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "payouts",
        type: "tuple[]",
        internalType: "struct MisthosVault.Payout[]",
        components: [
          {
            name: "payoutId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "contributorId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "to",
            type: "address",
            internalType: "address",
          },
          {
            name: "amount",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "decisionHash",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "decisionRoot",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerPayee",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "wallet",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAgent",
    inputs: [
      {
        name: "agent_",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setGuardian",
    inputs: [
      {
        name: "guardian_",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLimits",
    inputs: [
      {
        name: "limits_",
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
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "spentInWindow",
    inputs: [],
    outputs: [
      {
        name: "sum",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDeposited",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalPaid",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalWithdrawn",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [
      {
        name: "owner_",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "AgentUpdated",
    inputs: [
      {
        name: "oldAgent",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newAgent",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GuardianUpdated",
    inputs: [
      {
        name: "oldGuardian",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newGuardian",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LimitsUpdated",
    inputs: [
      {
        name: "limits",
        type: "tuple",
        indexed: false,
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
    anonymous: false,
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "oldOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Paused",
    inputs: [
      {
        name: "by",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayeeChanged",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "oldWallet",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newWallet",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "payableAfter",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayeeRegistered",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "wallet",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "payableAfter",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayoutExecuted",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "payoutId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "decisionHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoundApproved",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "by",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoundCancelled",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "by",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoundExecuted",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "total",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoundProposed",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "total",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "payoutCount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "decisionRoot",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Unpaused",
    inputs: [
      {
        name: "by",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VaultInitialized",
    inputs: [
      {
        name: "programId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
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
        indexed: true,
        internalType: "address",
      },
      {
        name: "guardian",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyPaid",
    inputs: [
      {
        name: "payoutId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "ApprovalRequired",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "total",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "threshold",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "DailyCapExceeded",
    inputs: [
      {
        name: "wouldBe",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "max",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "DuplicatePayout",
    inputs: [
      {
        name: "payoutId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "EmptyRound",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidInitialization",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidLimits",
    inputs: [],
  },
  {
    type: "error",
    name: "IsPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "NotAgent",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "NotOwner",
    inputs: [],
  },
  {
    type: "error",
    name: "NotOwnerOrAgent",
    inputs: [],
  },
  {
    type: "error",
    name: "NotOwnerOrGuardian",
    inputs: [],
  },
  {
    type: "error",
    name: "PayeeInCooldown",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "payableAfter",
        type: "uint64",
        internalType: "uint64",
      },
    ],
  },
  {
    type: "error",
    name: "PayeeMismatch",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "expected",
        type: "address",
        internalType: "address",
      },
      {
        name: "got",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "PayeeNotRegistered",
    inputs: [
      {
        name: "contributorId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "PayoutTooLarge",
    inputs: [
      {
        name: "payoutId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "max",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "RoundExists",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "RoundNotExecutable",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "RoundNotProposed",
    inputs: [
      {
        name: "roundId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "RoundTooLarge",
    inputs: [
      {
        name: "total",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "max",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "TooManyPayouts",
    inputs: [
      {
        name: "count",
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
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
  },
] as const;
