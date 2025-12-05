pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ModelMarketFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchOpen;
    mapping(uint256 => euint32) public encryptedModelWeights; // Placeholder for model data
    mapping(uint256 => euint32) public encryptedModelOutputs; // Placeholder for model outputs

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event ModelSubmitted(uint256 indexed batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 result);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();
    error InvalidRequestId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier respectDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        require(newCooldownSeconds > 0, "Cooldown must be positive");
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (isBatchOpen[currentBatchId]) revert BatchAlreadyOpen();
        currentBatchId++;
        isBatchOpen[currentBatchId] = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!isBatchOpen[currentBatchId]) revert BatchNotOpen();
        isBatchOpen[currentBatchId] = false;
        emit BatchClosed(currentBatchId);
    }

    function submitModel(uint32 encryptedWeight) external onlyProvider whenNotPaused respectCooldown {
        if (!isBatchOpen[currentBatchId]) revert BatchNotOpen();
        _initIfNeeded(encryptedModelWeights[currentBatchId]);
        encryptedModelWeights[currentBatchId] = encryptedModelWeights[currentBatchId].add(FHE.asEuint32(encryptedWeight));
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit ModelSubmitted(currentBatchId, msg.sender);
    }

    function runEncryptedInference(uint256 batchId, uint32 encryptedInput) external onlyProvider whenNotPaused {
        if (!isBatchOpen[batchId]) revert InvalidBatchId();
        _initIfNeeded(encryptedModelWeights[batchId]);
        _initIfNeeded(encryptedModelOutputs[batchId]);
        euint32 memory encryptedWeight = encryptedModelWeights[batchId];
        euint32 memory encryptedInputEUint = FHE.asEuint32(encryptedInput);
        encryptedModelOutputs[batchId] = encryptedWeight.mul(encryptedInputEUint);
    }

    function requestModelOutputDecryption(uint256 batchId) external onlyProvider whenNotPaused respectDecryptionCooldown {
        if (!isBatchOpen[batchId]) revert InvalidBatchId();
        _initIfNeeded(encryptedModelOutputs[batchId]);
        euint32 memory encryptedOutput = encryptedModelOutputs[batchId];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedOutput);
        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection prevents processing the same decryption request multiple times.

        uint256 batchId = decryptionContexts[requestId].batchId;
        euint32 memory encryptedOutput = encryptedModelOutputs[batchId];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedOutput);
        bytes32 currentHash = _hashCiphertexts(cts);

        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }
        // Security: State hash verification ensures that the contract's state related to the ciphertexts
        // has not changed since the decryption was requested. This prevents scenarios where an attacker
        // might alter the state after a request is made but before it's processed, leading to inconsistent results.

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 result = abi.decode(cleartexts, (uint32));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, result);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage x) internal {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage x) internal view {
        if (!FHE.isInitialized(x)) {
            revert("FHE variable not initialized");
        }
    }
}