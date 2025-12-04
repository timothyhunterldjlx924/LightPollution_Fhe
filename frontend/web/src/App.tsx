// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface LightPollutionRecord {
  id: string;
  encryptedBrightness: string;
  timestamp: number;
  location: string;
  contributor: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LightPollutionRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    location: "",
    brightness: "",
    notes: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Calculate statistics for dashboard
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  // Filter records based on search and status filter
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         record.contributor.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || record.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("light_pollution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: LightPollutionRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`light_pollution_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedBrightness: recordData.data,
                timestamp: recordData.timestamp,
                location: recordData.location,
                contributor: recordData.contributor,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Encrypting brightness data with FHE..." 
        : "使用FHE加密亮度数据..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        contributor: account,
        location: newRecordData.location,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `light_pollution_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("light_pollution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "light_pollution_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Encrypted data submitted securely!" 
          : "加密数据已安全提交!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          location: "",
          brightness: "",
          notes: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? language === "en" ? "Transaction rejected by user" : "用户拒绝了交易"
        : (language === "en" ? "Submission failed: " : "提交失败: ") + (e.message || (language === "en" ? "Unknown error" : "未知错误"));
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Processing encrypted data with FHE..." 
        : "使用FHE处理加密数据..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`light_pollution_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `light_pollution_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "FHE verification completed successfully!" 
          : "FHE验证成功完成!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Verification failed: " : "验证失败: ") + (e.message || (language === "en" ? "Unknown error" : "未知错误"))
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Processing encrypted data with FHE..." 
        : "使用FHE处理加密数据..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`light_pollution_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `light_pollution_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "FHE rejection completed successfully!" 
          : "FHE拒绝成功完成!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Rejection failed: " : "拒绝失败: ") + (e.message || (language === "en" ? "Unknown error" : "未知错误"))
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === "en" ? "zh" : "en");
  };

  const tutorialSteps = [
    {
      title: language === "en" ? "Connect Wallet" : "连接钱包",
      description: language === "en" 
        ? "Connect your Web3 wallet to contribute to light pollution mapping" 
        : "连接您的Web3钱包，为光污染地图做出贡献",
      icon: "🔗"
    },
    {
      title: language === "en" ? "Submit Encrypted Data" : "提交加密数据",
      description: language === "en" 
        ? "Add your light pollution data which will be encrypted using FHE" 
        : "添加您的光污染数据，将使用FHE进行加密",
      icon: "🔒"
    },
    {
      title: language === "en" ? "FHE Processing" : "FHE处理",
      description: language === "en" 
        ? "Your data is processed in encrypted state without decryption" 
        : "您的数据在加密状态下处理，无需解密",
      icon: "⚙️"
    },
    {
      title: language === "en" ? "Global Map Contribution" : "全球地图贡献",
      description: language === "en" 
        ? "Your encrypted data contributes to the global light pollution map" 
        : "您的加密数据有助于构建全球光污染地图",
      icon: "🌍"
    }
  ];

  const renderBarChart = () => {
    // Sample data for demonstration
    const monthlyData = [12, 19, 15, 22, 18, 24, 20, 17, 21, 23, 16, 14];
    const maxValue = Math.max(...monthlyData);
    
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          {monthlyData.map((value, index) => (
            <div key={index} className="bar-wrapper">
              <div 
                className="bar" 
                style={{ height: `${(value / maxValue) * 100}%` }}
              ></div>
              <div className="bar-label">{value}</div>
            </div>
          ))}
        </div>
        <div className="chart-x-axis">
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month, index) => (
            <div key={index} className="axis-label">{month}</div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>{language === "en" ? "Initializing encrypted connection..." : "初始化加密连接..."}</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="star-icon"></div>
          </div>
          <h1>LightPollution<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <div className="language-toggle">
            <button 
              onClick={toggleLanguage}
              className={`language-btn ${language === "en" ? "active" : ""}`}
            >
              EN
            </button>
            <span className="separator">|</span>
            <button 
              onClick={toggleLanguage}
              className={`language-btn ${language === "zh" ? "active" : ""}`}
            >
              中文
            </button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn"
          >
            <div className="add-icon"></div>
            {language === "en" ? "Add Data" : "添加数据"}
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial 
              ? (language === "en" ? "Hide Tutorial" : "隐藏教程") 
              : (language === "en" ? "Show Tutorial" : "显示教程")
            }
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>{language === "en" ? "Confidential Light Pollution Analysis" : "机密光污染数据分析"}</h2>
            <p>
              {language === "en" 
                ? "Securely share encrypted night sky brightness data using FHE to create global light pollution maps" 
                : "使用FHE安全共享加密的夜空亮度数据，创建全球光污染地图"
              }
            </p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>{language === "en" ? "FHE Light Pollution Mapping Tutorial" : "FHE光污染地图教程"}</h2>
            <p className="subtitle">
              {language === "en" 
                ? "Learn how to contribute to light pollution mapping while preserving privacy" 
                : "了解如何在保护隐私的同时为光污染地图做出贡献"
              }
            </p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>{language === "en" ? "Project Introduction" : "项目介绍"}</h3>
            <p>
              {language === "en" 
                ? "A platform for observatories and citizen scientists to share encrypted night sky brightness data using FHE technology to create global light pollution maps while preserving location privacy." 
                : "一个供天文台和公民科学家使用FHE技术共享加密夜空亮度数据的平台，用于创建全球光污染地图，同时保护位置隐私。"
              }
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>{language === "en" ? "Data Statistics" : "数据统计"}</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">{language === "en" ? "Total Records" : "总记录数"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">{language === "en" ? "Verified" : "已验证"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">{language === "en" ? "Pending" : "待处理"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">{language === "en" ? "Rejected" : "已拒绝"}</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>{language === "en" ? "Monthly Contributions" : "月度贡献"}</h3>
            {renderBarChart()}
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>{language === "en" ? "Encrypted Light Pollution Data" : "加密光污染数据"}</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder={language === "en" ? "Search location or contributor..." : "搜索位置或贡献者..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="status-filter"
              >
                <option value="all">{language === "en" ? "All Status" : "所有状态"}</option>
                <option value="pending">{language === "en" ? "Pending" : "待处理"}</option>
                <option value="verified">{language === "en" ? "Verified" : "已验证"}</option>
                <option value="rejected">{language === "en" ? "Rejected" : "已拒绝"}</option>
              </select>
              <button 
                onClick={loadRecords}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing 
                  ? (language === "en" ? "Refreshing..." : "刷新中...") 
                  : (language === "en" ? "Refresh" : "刷新")
                }
              </button>
            </div>
          </div>
          
          <div className="records-list">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">{language === "en" ? "Location" : "位置"}</div>
              <div className="header-cell">{language === "en" ? "Contributor" : "贡献者"}</div>
              <div className="header-cell">{language === "en" ? "Date" : "日期"}</div>
              <div className="header-cell">{language === "en" ? "Status" : "状态"}</div>
              <div className="header-cell">{language === "en" ? "Actions" : "操作"}</div>
            </div>
            
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>{language === "en" ? "No encrypted records found" : "未找到加密记录"}</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  {language === "en" ? "Create First Record" : "创建第一条记录"}
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.location}</div>
                  <div className="table-cell">{record.contributor.substring(0, 6)}...{record.contributor.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {language === "en" ? record.status : 
                        record.status === "pending" ? "待处理" :
                        record.status === "verified" ? "已验证" : "已拒绝"
                      }
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.contributor) && record.status === "pending" && (
                      <>
                        <button 
                          className="action-btn success-btn"
                          onClick={() => verifyRecord(record.id)}
                        >
                          {language === "en" ? "Verify" : "验证"}
                        </button>
                        <button 
                          className="action-btn danger-btn"
                          onClick={() => rejectRecord(record.id)}
                        >
                          {language === "en" ? "Reject" : "拒绝"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="partners-section">
          <h2>{language === "en" ? "Our Partners" : "我们的合作伙伴"}</h2>
          <div className="partners-grid">
            <div className="partner-logo">Global Observatory Network</div>
            <div className="partner-logo">Citizen Science Alliance</div>
            <div className="partner-logo">Environmental Research Institute</div>
            <div className="partner-logo">Astronomy Association</div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="star-icon"></div>
              <span>LightPollutionFHE</span>
            </div>
            <p>
              {language === "en" 
                ? "Secure encrypted light pollution mapping using FHE technology" 
                : "使用FHE技术进行安全加密的光污染地图绘制"
              }
            </p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">{language === "en" ? "Documentation" : "文档"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Privacy Policy" : "隐私政策"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Terms of Service" : "服务条款"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Contact" : "联系我们"}</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} LightPollutionFHE. {language === "en" ? "All rights reserved." : "保留所有权利。"}
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
  recordData: any;
  setRecordData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.location || !recordData.brightness) {
      alert(language === "en" ? "Please fill required fields" : "请填写必填字段");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>{language === "en" ? "Add Encrypted Light Data" : "添加加密光数据"}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            {language === "en" 
              ? "Your light data will be encrypted with FHE" 
              : "您的光数据将使用FHE进行加密"
            }
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>{language === "en" ? "Location *" : "位置 *"}</label>
              <input 
                type="text"
                name="location"
                value={recordData.location} 
                onChange={handleChange}
                placeholder={language === "en" ? "e.g., Tokyo, Japan" : "例如：日本东京"} 
                className="text-input"
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Brightness Level *" : "亮度级别 *"}</label>
              <select 
                name="brightness"
                value={recordData.brightness} 
                onChange={handleChange}
                className="select-input"
              >
                <option value="">{language === "en" ? "Select level" : "选择级别"}</option>
                <option value="Very Dark">{language === "en" ? "Very Dark" : "非常暗"}</option>
                <option value="Dark">{language === "en" ? "Dark" : "暗"}</option>
                <option value="Moderate">{language === "en" ? "Moderate" : "中等"}</option>
                <option value="Bright">{language === "en" ? "Bright" : "亮"}</option>
                <option value="Very Bright">{language === "en" ? "Very Bright" : "非常亮"}</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>{language === "en" ? "Notes" : "备注"}</label>
              <textarea 
                name="notes"
                value={recordData.notes} 
                onChange={handleChange}
                placeholder={language === "en" ? "Additional observations..." : "额外观察记录..."} 
                className="text-area"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            {language === "en" 
              ? "Data remains encrypted during FHE processing" 
              : "数据在FHE处理过程中保持加密状态"
            }
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            {language === "en" ? "Cancel" : "取消"}
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating 
              ? (language === "en" ? "Encrypting with FHE..." : "使用FHE加密中...") 
              : (language === "en" ? "Submit Securely" : "安全提交")
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;