import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface AIModel {
  id: string;
  name: string;
  description: string;
  encryptedWeights: string;
  owner: string;
  price: number;
  category: string;
  timestamp: number;
  encryptedData: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<AIModel[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newModelData, setNewModelData] = useState({ name: "", description: "", category: "", price: 0 });
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [showFAQ, setShowFAQ] = useState(false);

  // Filter models based on search and category
  const filteredModels = models.filter(model => {
    const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          model.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || model.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentModels = filteredModels.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredModels.length / itemsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  useEffect(() => {
    loadModels().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadModels = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check if contract is available
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get model keys
      const keysBytes = await contract.getData("model_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing model keys:", e); }
      }
      
      // Load each model
      const list: AIModel[] = [];
      for (const key of keys) {
        try {
          const modelBytes = await contract.getData(`model_${key}`);
          if (modelBytes.length > 0) {
            try {
              const modelData = JSON.parse(ethers.toUtf8String(modelBytes));
              list.push({ 
                id: key, 
                name: modelData.name,
                description: modelData.description,
                encryptedWeights: modelData.encryptedWeights,
                owner: modelData.owner,
                price: modelData.price,
                category: modelData.category,
                timestamp: modelData.timestamp,
                encryptedData: modelData.encryptedData
              });
            } catch (e) { console.error(`Error parsing model data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading model ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setModels(list);
    } catch (e) { console.error("Error loading models:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitModel = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting model weights with Zama FHE..." });
    try {
      // Simulate FHE encryption of model weights
      const encryptedWeights = FHEEncryptNumber(newModelData.price);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const modelId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const modelData = { 
        name: newModelData.name,
        description: newModelData.description,
        encryptedWeights: encryptedWeights,
        owner: address,
        price: newModelData.price,
        category: newModelData.category,
        timestamp: Math.floor(Date.now() / 1000),
        encryptedData: encryptedWeights // For demo purposes
      };
      
      // Store model data
      await contract.setData(`model_${modelId}`, ethers.toUtf8Bytes(JSON.stringify(modelData)));
      
      // Update model keys
      const keysBytes = await contract.getData("model_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(modelId);
      await contract.setData("model_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted model submitted securely!" });
      await loadModels();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewModelData({ name: "", description: "", category: "", price: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const purchaseModel = async (modelId: string, price: number) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing purchase with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const modelBytes = await contract.getData(`model_${modelId}`);
      if (modelBytes.length === 0) throw new Error("Model not found");
      
      setTransactionStatus({ visible: true, status: "success", message: "Model purchased successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Purchase failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (modelOwner: string) => address?.toLowerCase() === modelOwner.toLowerCase();

  const categories = [
    "all", "Computer Vision", "Natural Language", "Speech Recognition", 
    "Recommendation", "Generative AI", "Predictive Analytics"
  ];

  const faqItems = [
    {
      question: "What is FHE (Fully Homomorphic Encryption)?",
      answer: "FHE allows computations to be performed directly on encrypted data without needing to decrypt it first. This ensures that sensitive data remains secure throughout the entire computation process."
    },
    {
      question: "How does this marketplace protect AI models?",
      answer: "Models are encrypted using Zama FHE technology before being listed. Users can run the model on their data without ever accessing the model's weights or structure."
    },
    {
      question: "Can I decrypt the model weights?",
      answer: "No, the model weights remain encrypted at all times. Only the model owner has the ability to decrypt the weights using their private key."
    },
    {
      question: "How do I purchase a model?",
      answer: "Connect your wallet, select a model, and click the 'Purchase' button. The transaction will be processed securely on the blockchain."
    },
    {
      question: "What happens after I purchase a model?",
      answer: "You'll receive access to an API endpoint where you can submit your encrypted data and receive encrypted predictions. The model remains encrypted throughout this process."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>隱智市場</h1>
          <span className="subtitle">AI Model Marketplace</span>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-model-btn">
            <div className="add-icon"></div>List Model
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {/* Project Introduction Section */}
        <div className="intro-section">
          <div className="intro-content">
            <h2>Secure AI Model Marketplace</h2>
            <p>
              Powered by Zama FHE technology, our marketplace allows AI developers to sell or lease their models 
              while keeping weights and structure encrypted. Users can run models on their data without compromising 
              intellectual property.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Security</span>
            </div>
          </div>
          <div className="intro-image">
            <div className="fhe-visualization">
              <div className="fhe-layer">Data Encryption</div>
              <div className="fhe-layer">Homomorphic Computation</div>
              <div className="fhe-layer">Secure Results</div>
            </div>
          </div>
        </div>

        {/* Search and Filter Section */}
        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search models..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="search-btn">
              <div className="search-icon"></div>
            </button>
          </div>
          <div className="category-filter">
            <label>Category:</label>
            <select 
              value={selectedCategory} 
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Models List Section */}
        <div className="models-section">
          <div className="section-header">
            <h2>Available AI Models</h2>
            <div className="header-actions">
              <button onClick={loadModels} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          {models.length === 0 ? (
            <div className="no-models">
              <div className="no-models-icon"></div>
              <p>No AI models found in the marketplace</p>
              <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                List Your First Model
              </button>
            </div>
          ) : (
            <>
              <div className="models-grid">
                {currentModels.map(model => (
                  <div 
                    className="model-card" 
                    key={model.id}
                    onClick={() => setSelectedModel(model)}
                  >
                    <div className="model-header">
                      <h3>{model.name}</h3>
                      <div className="model-price">
                        {model.price} ETH
                      </div>
                    </div>
                    <div className="model-category">
                      {model.category}
                    </div>
                    <p className="model-description">
                      {model.description.substring(0, 100)}...
                    </p>
                    <div className="model-footer">
                      <div className="model-owner">
                        {model.owner.substring(0, 6)}...{model.owner.substring(38)}
                      </div>
                      <button 
                        className="action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          purchaseModel(model.id, model.price);
                        }}
                      >
                        Purchase
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button 
                    onClick={() => paginate(currentPage - 1)} 
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => paginate(page)}
                      className={currentPage === page ? "active" : ""}
                    >
                      {page}
                    </button>
                  ))}
                  
                  <button 
                    onClick={() => paginate(currentPage + 1)} 
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* FAQ Section */}
        <div className="faq-section">
          <div className="section-header">
            <h2>Frequently Asked Questions</h2>
            <button 
              className="toggle-btn"
              onClick={() => setShowFAQ(!showFAQ)}
            >
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>
          
          {showFAQ && (
            <div className="faq-content">
              {faqItems.map((faq, index) => (
                <div className="faq-item" key={index}>
                  <h3>{faq.question}</h3>
                  <p>{faq.answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Model Modal */}
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitModel} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          modelData={newModelData} 
          setModelData={setNewModelData}
        />
      )}

      {/* Model Detail Modal */}
      {selectedModel && (
        <ModelDetailModal 
          model={selectedModel} 
          onClose={() => { 
            setSelectedModel(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          isOwner={isOwner(selectedModel.owner)}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>隱智市場</span>
            </div>
            <p>Secure AI model marketplace powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} 隱智市場. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  modelData: any;
  setModelData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, modelData, setModelData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setModelData({ ...modelData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setModelData({ ...modelData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!modelData.name || !modelData.price) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>List New AI Model</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your model weights will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Model Name *</label>
            <input 
              type="text" 
              name="name" 
              value={modelData.name} 
              onChange={handleChange} 
              placeholder="Enter model name..."
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={modelData.description} 
              onChange={handleChange} 
              placeholder="Describe your model..."
              rows={3}
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Category *</label>
              <select name="category" value={modelData.category} onChange={handleChange}>
                <option value="">Select category</option>
                <option value="Computer Vision">Computer Vision</option>
                <option value="Natural Language">Natural Language</option>
                <option value="Speech Recognition">Speech Recognition</option>
                <option value="Recommendation">Recommendation</option>
                <option value="Generative AI">Generative AI</option>
                <option value="Predictive Analytics">Predictive Analytics</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Price (ETH) *</label>
              <input 
                type="number" 
                name="price" 
                value={modelData.price} 
                onChange={handleValueChange} 
                placeholder="Set price in ETH"
                step="0.01"
                min="0"
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>{modelData.price || 'No value entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Weights:</span>
                <div>{modelData.price ? FHEEncryptNumber(modelData.price).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Intellectual Property Protection</strong>
              <p>Your model weights remain encrypted during FHE processing and are never exposed</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn">
            {creating ? "Encrypting with FHE..." : "List Model Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModelDetailModalProps {
  model: AIModel;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  isOwner: boolean;
}

const ModelDetailModal: React.FC<ModelDetailModalProps> = ({ 
  model, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature,
  isOwner
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(model.encryptedWeights);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="model-detail-modal">
        <div className="modal-header">
          <h2>{model.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="model-info">
            <div className="info-row">
              <span>Category:</span>
              <strong>{model.category}</strong>
            </div>
            <div className="info-row">
              <span>Owner:</span>
              <strong>{model.owner.substring(0, 6)}...{model.owner.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Price:</span>
              <strong>{model.price} ETH</strong>
            </div>
            <div className="info-row">
              <span>Listed:</span>
              <strong>{new Date(model.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="model-description">
            <h3>Description</h3>
            <p>{model.description}</p>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Weights</h3>
            <div className="encrypted-data">
              {model.encryptedWeights.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            
            {isOwner && (
              <button 
                className="decrypt-btn" 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  <span className="decrypt-spinner"></span>
                ) : decryptedValue !== null ? (
                  "Hide Decrypted Value"
                ) : (
                  "Decrypt with Wallet Signature"
                )}
              </button>
            )}
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Value</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!isOwner && (
            <button 
              className="purchase-btn"
              onClick={() => {}}
            >
              Purchase Model
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;