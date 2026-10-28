import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Database,
  Download,
  RotateCcw,
  Plus,
  ShieldCheck,
  Calendar,
  HardDrive,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Upload,
  Clock,
  Sparkles,
  Loader2,
  MoreVertical,
  Eye,
  X,
  Monitor
} from 'lucide-react';
import {
  fetchBackups,
  createFullBackup,
  downloadBackupToDisk,
  restoreBackupData
} from '../lib/backups';
import Skeleton from './common/Skeleton';
import '../styles/backups.css';

export default function BackupsView({ currentUser }) {
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedBackupToRestore, setSelectedBackupToRestore] = useState(null);
  const [selectedBackupForDetails, setSelectedBackupForDetails] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownCoords, setDropdownCoords] = useState(null);
  const [activeDropdownBackup, setActiveDropdownBackup] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  const getCleanBackupName = (b) => {
    if (!b?.backup_name) return b?.backup_type === 'auto' ? 'Daily Auto-Backup' : 'Manual Snapshot';
    return b.backup_name.replace(/\s*-\s*[A-Za-z]{3}\s*\d{1,2}.*$/, '');
  };

  const closeDropdown = () => {
    setOpenDropdownId(null);
    setDropdownCoords(null);
    setActiveDropdownBackup(null);
  };

  const handleToggleDropdown = (e, b) => {
    e.stopPropagation();
    const backupKey = b.id || b.created_at;
    if (openDropdownId === backupKey) {
      closeDropdown();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 125;
    const spaceBelow = window.innerHeight - rect.bottom;
    const isUp = spaceBelow < menuHeight + 10;

    setDropdownCoords({
      top: isUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
    setOpenDropdownId(backupKey);
    setActiveDropdownBackup(b);
  };

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.backup-dropdown-menu') && !e.target.closest('.backup-more-btn')) {
        closeDropdown();
      }
    };
    const handleScrollOrResize = () => {
      closeDropdown();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, []);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const data = await fetchBackups();
      setBackups(data);
    } catch (err) {
      console.warn('Error fetching backups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    setErrorMsg('');
    try {
      await createFullBackup({
        type: 'manual',
        createdBy: currentUser?.name || 'Admin'
      });
      await loadBackups();
    } catch (err) {
      console.error('Failed to create backup:', err);
      setErrorMsg('Failed to create backup snapshot. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDownload = async (backup) => {
    try {
      await downloadBackupToDisk(backup);
    } catch (err) {
      console.error('Download error:', err);
      alert('Could not download backup file: ' + err.message);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupToRestore) return;
    setIsRestoring(true);
    setErrorMsg('');
    try {
      const payload = selectedBackupToRestore.payload;
      const res = await restoreBackupData(payload);
      setRestoreSuccess(res);
      setSelectedBackupToRestore(null);
      // Trigger update event across tabs
      window.dispatchEvent(new CustomEvent('crm-followups-updated'));
    } catch (err) {
      console.error('Restore error:', err);
      setErrorMsg('Failed to restore backup: ' + err.message);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleUploadFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed.data || !parsed.version) {
          alert('Invalid SimpleCRM backup file structure.');
          return;
        }
        setSelectedBackupToRestore({
          backup_name: file.name,
          created_at: parsed.created_at || new Date().toISOString(),
          record_counts: parsed.record_counts || {},
          payload: parsed
        });
      } catch (err) {
        alert('Invalid JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    const kb = (bytes / 1024).toFixed(1);
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const latestBackup = backups[0];

  return (
    <div className="backups-view-container">
      {/* Mobile Overview View (Strictly visible on mobile <= 900px) */}
      <div className="backups-mobile-overview-view">
        <div className="backups-mobile-overview-card">
          <div className="backups-mobile-overview-table-header">
            <span className="backups-overview-th-left">Snapshot</span>
            <span className="backups-overview-th-right">Status</span>
          </div>

          <div className="backups-mobile-overview-table-body">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="backups-mobile-overview-row">
                  <div className="backups-mobile-overview-left">
                    <Skeleton width="38px" height="38px" borderRadius="10px" />
                    <div className="backups-mobile-overview-info">
                      <Skeleton width="130px" height="15px" borderRadius="4px" />
                      <Skeleton width="90px" height="11px" borderRadius="3px" />
                    </div>
                  </div>
                  <div className="backups-mobile-overview-right">
                    <Skeleton width="48px" height="20px" borderRadius="5px" />
                  </div>
                </div>
              ))
            ) : backups.length === 0 ? (
              <div className="backups-mobile-empty">
                <Database size={28} strokeWidth={1.5} color="#94a3b8" />
                <span>No snapshots available</span>
              </div>
            ) : (
              backups.map((b) => {
                const dateFormatted = new Date(b.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                });

                return (
                  <div key={b.id || b.created_at} className="backups-mobile-overview-row">
                    <div className="backups-mobile-overview-left">
                      <div className="backups-mobile-overview-icon-box">
                        <Database size={18} style={{ color: '#0f172a' }} />
                      </div>
                      <div className="backups-mobile-overview-info">
                        <span className="backups-mobile-overview-name">{getCleanBackupName(b)}</span>
                        <span className="backups-mobile-overview-sub">
                          {dateFormatted} · {formatFileSize(b.file_size_bytes)}
                        </span>
                      </div>
                    </div>

                    <div className="backups-mobile-overview-right">
                      <span className="backups-mobile-status-badge">
                        READY
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Clean Desktop Notice Banner */}
        <div className="backups-mobile-desktop-notice">
          <div className="backups-notice-icon-box">
            <Monitor size={17} strokeWidth={1.75} />
          </div>
          <div className="backups-notice-text-col">
            <span className="backups-notice-title">Desktop Management</span>
            <span className="backups-notice-desc">
              To create manual snapshots, download backups, or restore database files, open simplecrm on your computer.
            </span>
          </div>
        </div>

        {/* Minimal App Version indicator */}
        <div className="backups-mobile-version-tag">
          simplecrm v1.0.13 (Build 14)
        </div>
      </div>

      {/* Desktop Full-Featured View (Hidden on mobile <= 900px) */}
      <div className="backups-desktop-full-view">
        <div className="backups-view-inner">
        {/* Master Header */}
        <div className="backups-master-header">
          <div className="backups-master-title-group">
            <h1 className="backups-master-title">Backups</h1>
            <span className="backups-master-count">{backups.length}</span>
          </div>

          <div className="backups-header-actions">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUploadFile}
              accept=".json"
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="backups-secondary-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Restore from an external .json backup file"
            >
              <Upload size={14} strokeWidth={2} />
              <span>Upload & Restore</span>
            </button>

            <button
              type="button"
              className="backups-primary-btn"
              onClick={handleCreateBackup}
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 size={15} className="spin-animate" />
                  <span>Creating Snapshot...</span>
                </>
              ) : (
                <>
                  <Plus size={15} strokeWidth={2} />
                  <span>Create Backup Now</span>
                </>
              )}
            </button>
          </div>
        </div>

      {/* Success / Error Messages */}
      {restoreSuccess && (
        <div className="backups-alert-box success">
          <CheckCircle2 size={16} />
          <div>
            <strong>Backup Restored Successfully!</strong> Restored{' '}
            {restoreSuccess.leadsRestored} leads and {restoreSuccess.followUpsRestored} follow-ups.
          </div>
          <button
            type="button"
            className="backups-alert-dismiss"
            onClick={() => setRestoreSuccess(null)}
          >
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="backups-alert-box error">
          <AlertTriangle size={16} />
          <div>{errorMsg}</div>
          <button
            type="button"
            className="backups-alert-dismiss"
            onClick={() => setErrorMsg('')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Metric Strip */}
      <div className="backups-metric-strip">
        <div className="backups-metric-item">
          <div className="backups-metric-top">
            <ShieldCheck size={16} strokeWidth={2} className="backups-metric-icon" />
            <span className="backups-metric-label">Retention Policy</span>
          </div>
          <div className="backups-metric-value">7-Day Rolling</div>
          <div className="backups-metric-hint">Older snapshots automatically pruned</div>
        </div>

        <div className="backups-metric-divider" />

        <div className="backups-metric-item">
          <div className="backups-metric-top">
            <Clock size={16} strokeWidth={2} className="backups-metric-icon" />
            <span className="backups-metric-label">Latest Snapshot</span>
          </div>
          <div className="backups-metric-value">
            {latestBackup ? new Date(latestBackup.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No Snapshots Yet'}
          </div>
          <div className="backups-metric-hint">
            {latestBackup ? `${formatFileSize(latestBackup.file_size_bytes)} total size` : 'Take your first backup today'}
          </div>
        </div>

        <div className="backups-metric-divider" />

        <div className="backups-metric-item">
          <div className="backups-metric-top">
            <HardDrive size={16} strokeWidth={2} className="backups-metric-icon" />
            <span className="backups-metric-label">Snapshots Stored</span>
          </div>
          <div className="backups-metric-value">{backups.length} / 7 Days</div>
          <div className="backups-metric-hint">Dual-layer (Supabase + Local disk ready)</div>
        </div>
      </div>

      {/* Snapshots Table Section */}
      <div className="backups-table-section">
        <div className="backups-table-toolbar">
          <div className="backups-table-title-group">
            <h2 className="backups-table-title">Available Snapshots</h2>
            <span className="backups-count-badge">
              {isLoading ? (
                <Skeleton width="55px" height="12px" borderRadius="999px" />
              ) : (
                `${backups.length} available`
              )}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="backups-table-wrapper">
            <table className="backups-table">
              <thead>
                <tr>
                  <th>Snapshot / Date</th>
                  <th>Records Protected</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right', width: '60px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td>
                      <div className="backup-col-name" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Skeleton width={i % 2 === 0 ? '160px' : '190px'} height="15px" borderRadius="4px" />
                        <Skeleton width="120px" height="11px" borderRadius="3px" />
                      </div>
                    </td>
                    <td>
                      <Skeleton width="130px" height="20px" borderRadius="4px" />
                    </td>
                    <td>
                      <Skeleton width="48px" height="13px" borderRadius="3px" />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="backup-row-actions" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <Skeleton width="26px" height="26px" borderRadius="6px" />
                        <Skeleton width="26px" height="26px" borderRadius="6px" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : backups.length === 0 ? (
          <div className="backups-empty-state">
            <Database size={36} strokeWidth={1.5} />
            <h3>No Backup Snapshots Available</h3>
            <p>Click "Create Backup Now" above to capture your first full CRM disk snapshot.</p>
          </div>
        ) : (
          <div className="backups-table-wrapper">
            <table className="backups-table">
              <thead>
                <tr>
                  <th>Snapshot / Date</th>
                  <th>Records Protected</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right', width: '60px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => {
                  const counts = b.record_counts || {};
                  const dateFormatted = new Date(b.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  return (
                    <tr key={b.id || b.created_at}>
                      <td className="backup-col-name">
                        <div className="backup-name-title">{getCleanBackupName(b)}</div>
                        <div className="backup-name-date">{dateFormatted}</div>
                      </td>
                      <td>
                        <div className="backup-counts-cluster">
                          <span className="backup-count-tag" title="Leads">
                            <strong>{counts.leads || 0}</strong> Leads
                          </span>
                          <span className="backup-count-tag" title="Follow-ups">
                            <strong>{counts.follow_ups || 0}</strong> Follow-ups
                          </span>
                          <span className="backup-count-tag" title="Users">
                            <strong>{counts.users || 0}</strong> Users
                          </span>
                        </div>
                      </td>
                      <td className="backup-col-size">{formatFileSize(b.file_size_bytes)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="backup-actions-dropdown-wrapper">
                          <button
                            type="button"
                            className={`backup-more-btn ${openDropdownId === (b.id || b.created_at) ? 'active' : ''}`}
                            onClick={(e) => handleToggleDropdown(e, b)}
                            title="Snapshot actions"
                            aria-label="Actions"
                          >
                            <MoreVertical size={16} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
      </div>

      {/* Snapshot Details Modal */}
      {selectedBackupForDetails && (
        <div className="lead-modal-backdrop" onClick={() => setSelectedBackupForDetails(null)}>
          <div className="backups-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="backups-details-modal-header">
              <div className="backups-details-title-row">
                <Database size={18} strokeWidth={2} className="modal-db-icon" />
                <h3>{getCleanBackupName(selectedBackupForDetails)}</h3>
                <span className={`backup-type-pill ${selectedBackupForDetails.backup_type === 'auto' ? 'auto' : 'manual'}`}>
                  {selectedBackupForDetails.backup_type === 'auto' ? 'Automated' : 'Manual'}
                </span>
              </div>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setSelectedBackupForDetails(null)}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="backups-details-modal-body">
              <div className="backup-details-meta-grid">
                <div className="backup-details-meta-item">
                  <span className="backup-details-label">Created At</span>
                  <span className="backup-details-value">
                    {new Date(selectedBackupForDetails.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="backup-details-meta-item">
                  <span className="backup-details-label">Created By</span>
                  <span className="backup-details-value">
                    {selectedBackupForDetails.created_by || 'System'}
                  </span>
                </div>
                <div className="backup-details-meta-item">
                  <span className="backup-details-label">File Size</span>
                  <span className="backup-details-value">
                    {formatFileSize(selectedBackupForDetails.file_size_bytes)}
                  </span>
                </div>
                <div className="backup-details-meta-item">
                  <span className="backup-details-label">Retention Policy</span>
                  <span className="backup-details-value">7 Days Rolling</span>
                </div>
              </div>

              <div className="backup-details-breakdown-section">
                <h4>Records Included in Snapshot</h4>
                <div className="backup-details-breakdown-grid">
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.leads || 0}</span>
                    <span className="chip-label">Leads</span>
                  </div>
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.follow_ups || 0}</span>
                    <span className="chip-label">Follow-ups</span>
                  </div>
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.users || 0}</span>
                    <span className="chip-label">Users</span>
                  </div>
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.activities || 0}</span>
                    <span className="chip-label">Activities</span>
                  </div>
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.pipelines || 1}</span>
                    <span className="chip-label">Pipelines</span>
                  </div>
                  <div className="backup-breakdown-chip">
                    <span className="chip-count">{selectedBackupForDetails.record_counts?.todos || 0}</span>
                    <span className="chip-label">To-Do Tasks</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="backups-details-modal-footer">
              <button
                type="button"
                className="backups-details-download-btn"
                onClick={() => {
                  handleDownload(selectedBackupForDetails);
                }}
              >
                <Download size={14} strokeWidth={2} />
                <span>Download to Disk</span>
              </button>
              <button
                type="button"
                className="backups-details-restore-btn"
                onClick={() => {
                  setSelectedBackupToRestore(selectedBackupForDetails);
                  setSelectedBackupForDetails(null);
                }}
              >
                <RotateCcw size={14} strokeWidth={2} />
                <span>Restore Snapshot</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {selectedBackupToRestore && (
        <div className="lead-modal-backdrop" onClick={() => !isRestoring && setSelectedBackupToRestore(null)}>
          <div className="backups-restore-modal" onClick={(e) => e.stopPropagation()}>
            <div className="backups-modal-icon-wrap">
              <AlertTriangle size={24} className="modal-warning-icon" />
            </div>
            <h3>Confirm Snapshot Restoration</h3>
            <p>
              You are about to restore CRM data from{' '}
              <strong>"{getCleanBackupName(selectedBackupToRestore)}"</strong>. Existing leads and follow-ups will be updated with snapshot data.
            </p>

            <div className="backup-restore-summary-box">
              <div className="restore-summary-row">
                <span>Leads in Snapshot:</span>
                <strong>{selectedBackupToRestore.record_counts?.leads || 'All'}</strong>
              </div>
              <div className="restore-summary-row">
                <span>Follow-ups in Snapshot:</span>
                <strong>{selectedBackupToRestore.record_counts?.follow_ups || 'All'}</strong>
              </div>
              <div className="restore-summary-row">
                <span>Snapshot Date:</span>
                <strong>
                  {new Date(selectedBackupToRestore.created_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </strong>
              </div>
            </div>

            <div className="backups-modal-actions">
              <button
                type="button"
                className="lead-modal-cancel-btn"
                onClick={() => setSelectedBackupToRestore(null)}
                disabled={isRestoring}
              >
                Cancel
              </button>
              <button
                type="button"
                className="backups-confirm-restore-btn"
                onClick={handleConfirmRestore}
                disabled={isRestoring}
              >
                {isRestoring ? (
                  <>
                    <Loader2 size={14} className="spin-animate" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} strokeWidth={2} />
                    <span>Restore Snapshot</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating 3-Dots Dropdown Portal */}
      {openDropdownId && dropdownCoords && activeDropdownBackup && createPortal(
        <div
          className="backup-dropdown-menu portal-menu"
          style={{
            position: 'fixed',
            top: `${dropdownCoords.top}px`,
            right: `${dropdownCoords.right}px`,
            zIndex: 99999
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="backup-dropdown-item"
            onClick={() => {
              setSelectedBackupForDetails(activeDropdownBackup);
              closeDropdown();
            }}
          >
            <Eye size={14} strokeWidth={1.8} />
            <span>View Details</span>
          </button>

          <button
            type="button"
            className="backup-dropdown-item"
            onClick={() => {
              handleDownload(activeDropdownBackup);
              closeDropdown();
            }}
          >
            <Download size={14} strokeWidth={1.8} />
            <span>Download to Disk</span>
          </button>

          <button
            type="button"
            className="backup-dropdown-item restore"
            onClick={() => {
              setSelectedBackupToRestore(activeDropdownBackup);
              closeDropdown();
            }}
          >
            <RotateCcw size={14} strokeWidth={1.8} />
            <span>Restore Snapshot</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
