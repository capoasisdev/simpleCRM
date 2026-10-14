import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Scale,
  User,
  Inbox,
  Check,
  Play,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Skeleton from './common/Skeleton';
import '../styles/leadRouting.css';

// Sleek high-contrast shades for distribution visualization
const SHADES = [
  '#0f172a', // Deep slate black
  '#2563eb', // Royal blue
  '#059669', // Emerald
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#475569'  // Slate
];

const getMemberShade = (member, index) => {
  return member?.shade || SHADES[index % SHADES.length] || '#0f172a';
};

export default function LeadRoutingView() {
  const [userRules, setUserRules] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_lead_routing_rules');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_lead_routing_rules');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch (e) {}
    return true;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [configId, setConfigId] = useState(null);
  const [mode, setMode] = useState('round_robin'); // 'round_robin' | 'weighted' | 'single' | 'unassigned'
  const [defaultAssignee, setDefaultAssignee] = useState('pranav');
  const [roundRobinIndex, setRoundRobinIndex] = useState(0);
  const [toast, setToast] = useState(null);
  const [simulation, setSimulation] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (userRules.length === 0) {
        setIsLoading(true);
      }
      try {
        const { data: usersData, error: usersErr } = await supabase
          .from('crm_users')
          .select('id, name, email, role')
          .order('name', { ascending: true });

        if (usersErr) throw usersErr;

        const { data: configData, error: configErr } = await supabase
          .from('lead_routing_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (configErr && configErr.code !== 'PGRST116') {
          console.warn('Error fetching config:', configErr);
        }

        if (isMounted) {
          const rawRules = configData?.user_rules || [];
          const usersList = usersData || [];

          const mergedRules = usersList.map((user, idx) => {
            const existing = rawRules.find(
              (r) => r.id === user.id || r.email === user.email || r.name === user.name
            );
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role || 'member',
              enabled: existing ? existing.enabled !== false : true,
              weight: existing ? Number(existing.weight) || 50 : 50,
              shade: SHADES[idx % SHADES.length]
            };
          });

          setUserRules(mergedRules);
          try {
            localStorage.setItem('crm_cached_lead_routing_rules', JSON.stringify(mergedRules));
          } catch (e) {}
          if (configData) {
            setConfigId(configData.id);
            setMode(configData.mode || 'round_robin');
            setDefaultAssignee(configData.default_assignee || (mergedRules[0]?.name || 'pranav'));
            setRoundRobinIndex(configData.round_robin_index || 0);
          } else if (mergedRules.length > 0) {
            setDefaultAssignee(mergedRules[0].name);
          }
        }
      } catch (err) {
        console.error('Failed to load routing configuration:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeMembers = useMemo(() => {
    return userRules.filter((u) => u.enabled);
  }, [userRules]);

  const totalWeight = useMemo(() => {
    return activeMembers.reduce((sum, u) => sum + (Number(u.weight) || 0), 0);
  }, [activeMembers]);

  // Safe share percentage calculation
  const calculateShare = (member) => {
    if (!member.enabled) return '0.0';
    if (mode === 'round_robin') {
      return activeMembers.length > 0 ? (100 / activeMembers.length).toFixed(1) : '0.0';
    }
    if (mode === 'weighted') {
      if (totalWeight <= 0) {
        return activeMembers.length > 0 ? (100 / activeMembers.length).toFixed(1) : '0.0';
      }
      return (((Number(member.weight) || 0) / totalWeight) * 100).toFixed(1);
    }
    return '0.0';
  };

  const handleToggleUser = (userId) => {
    setUserRules((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, enabled: !u.enabled } : u))
    );
  };

  const handleWeightChange = (userId, newWeight) => {
    const parsed = Math.max(0, Math.min(100, parseInt(newWeight, 10) || 0));
    setUserRules((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, weight: parsed } : u))
    );
  };

  const handleDistributeEvenly = () => {
    if (activeMembers.length === 0) return;
    const share = Math.round(100 / activeMembers.length);
    setUserRules((prev) =>
      prev.map((u) => {
        if (!u.enabled) return u;
        return { ...u, weight: share };
      })
    );
    showToast('Weights balanced evenly');
  };

  const handleRunSimulation = () => {
    const results = [];
    if (mode === 'unassigned') {
      for (let i = 1; i <= 10; i++) {
        results.push({ leadNum: i, assignee: 'Unassigned Pool' });
      }
    } else if (mode === 'single') {
      for (let i = 1; i <= 10; i++) {
        results.push({ leadNum: i, assignee: defaultAssignee });
      }
    } else if (mode === 'round_robin') {
      if (activeMembers.length === 0) {
        for (let i = 1; i <= 10; i++) {
          results.push({ leadNum: i, assignee: `${defaultAssignee} (Fallback)` });
        }
      } else {
        for (let i = 1; i <= 10; i++) {
          const idx = (roundRobinIndex + i - 1) % activeMembers.length;
          results.push({ leadNum: i, assignee: activeMembers[idx].name });
        }
      }
    } else if (mode === 'weighted') {
      if (activeMembers.length === 0 || totalWeight === 0) {
        for (let i = 1; i <= 10; i++) {
          results.push({ leadNum: i, assignee: `${defaultAssignee} (Fallback)` });
        }
      } else {
        for (let i = 1; i <= 10; i++) {
          const rand = Math.random() * totalWeight;
          let running = 0;
          let chosen = activeMembers[0];
          for (const m of activeMembers) {
            running += Number(m.weight) || 0;
            if (rand <= running) {
              chosen = m;
              break;
            }
          }
          results.push({ leadNum: i, assignee: chosen.name });
        }
      }
    }
    setSimulation(results);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        mode,
        default_assignee: defaultAssignee,
        user_rules: userRules.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          enabled: u.enabled,
          weight: u.weight
        })),
        updated_at: new Date().toISOString()
      };

      if (configId) {
        const { error } = await supabase
          .from('lead_routing_config')
          .update(payload)
          .eq('id', configId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('lead_routing_config')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        if (data) setConfigId(data.id);
      }

      showToast('Lead distribution rules saved');
    } catch (err) {
      console.error('Failed to save routing configuration:', err);
      showToast('Error saving rules');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="lead-routing-container">
        <div className="lead-routing-toolbar">
          <Skeleton width="180px" height="20px" />
          <Skeleton width="140px" height="32px" borderRadius="6px" />
        </div>
        <div className="lead-routing-content">
          <Skeleton width="100%" height="42px" borderRadius="8px" />
          <Skeleton width="100%" height="200px" borderRadius="8px" />
        </div>
      </div>
    );
  }

  return (
    <div className="lead-routing-container">
      {/* Header Toolbar */}
      <div className="lead-routing-toolbar">
        <div className="lead-routing-title-group">
          <h1 className="lead-routing-main-title">Lead Routing</h1>
        </div>

        <div className="lead-routing-actions">
          <button
            type="button"
            className="btn-minimal-secondary"
            onClick={handleRunSimulation}
            title="Preview assignment sequence"
          >
            <Play size={13} />
            <span>Simulate</span>
          </button>
          <button
            type="button"
            className="btn-minimal-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <RefreshCw size={13} className="meta-loading-spinner" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check size={13} />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="lead-routing-content">
        {/* Segmented Mode Control */}
        <div className="routing-segmented-container">
          <div className="routing-segmented-bar">
            <button
              type="button"
              className={`routing-segment-btn ${mode === 'round_robin' ? 'active' : ''}`}
              onClick={() => setMode('round_robin')}
            >
              <RefreshCw size={13} />
              <span>Round Robin</span>
            </button>
            <button
              type="button"
              className={`routing-segment-btn ${mode === 'weighted' ? 'active' : ''}`}
              onClick={() => setMode('weighted')}
            >
              <Scale size={13} />
              <span>Weighted Split</span>
            </button>
            <button
              type="button"
              className={`routing-segment-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              <User size={13} />
              <span>Single Assignee</span>
            </button>
            <button
              type="button"
              className={`routing-segment-btn ${mode === 'unassigned' ? 'active' : ''}`}
              onClick={() => setMode('unassigned')}
            >
              <Inbox size={13} />
              <span>Unassigned Queue</span>
            </button>
          </div>

          <div className="routing-mode-hint">
            {mode === 'round_robin' &&
              'Incoming leads are distributed 1-by-1 sequentially across active members.'}
            {mode === 'weighted' &&
              'Leads are assigned proportionally based on capacity weight ratios.'}
            {mode === 'single' &&
              '100% of incoming leads route to the chosen team member.'}
            {mode === 'unassigned' &&
              'Leads land in the unassigned triage pool for reps to manually claim.'}
          </div>
        </div>

        {/* Proportional Distribution Bar (visible in Round Robin & Weighted) */}
        {(mode === 'round_robin' || mode === 'weighted') && activeMembers.length > 0 && (
          <div className="minimal-dist-wrapper">
            <div className="minimal-dist-header">
              <span>Allocation Breakdown</span>
              {mode === 'weighted' && (
                <button
                  type="button"
                  className="btn-minimal-secondary"
                  style={{ height: '22px', padding: '0 8px', fontSize: '11px' }}
                  onClick={handleDistributeEvenly}
                >
                  <RotateCcw size={10} />
                  <span>Equalize</span>
                </button>
              )}
            </div>

            <div className="minimal-dist-bar">
              {activeMembers.map((member, idx) => {
                const percent = calculateShare(member);
                const shade = getMemberShade(member, idx);

                return (
                  <div
                    key={member.id}
                    className="minimal-dist-segment"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: shade
                    }}
                    title={`${member.name}: ${percent}%`}
                  />
                );
              })}
            </div>

            <div className="minimal-dist-legend">
              {activeMembers.map((member, idx) => {
                const percent = calculateShare(member);
                const shade = getMemberShade(member, idx);

                return (
                  <div key={member.id} className="minimal-legend-item">
                    <span
                      className="minimal-legend-dot"
                      style={{ backgroundColor: shade }}
                    />
                    <span>
                      {member.name} <strong>{percent}%</strong>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Member Roster or Single Selector */}
        {mode === 'single' ? (
          <div>
            <div className="minimal-section-header">
              <h2 className="minimal-section-title">Designated Assignee</h2>
            </div>
            <select
              value={defaultAssignee}
              onChange={(e) => setDefaultAssignee(e.target.value)}
              className="minimal-select-box"
            >
              {userRules.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>
        ) : mode !== 'unassigned' ? (
          <div>
            <div className="minimal-section-header">
              <h2 className="minimal-section-title">Team Roster</h2>
              <span className="minimal-section-desc">
                {activeMembers.length} of {userRules.length} members eligible
              </span>
            </div>

            <div className="minimal-roster-card">
              {userRules.map((member, idx) => {
                const effectiveShare = calculateShare(member);
                const shade = getMemberShade(member, idx);

                return (
                  <div
                    key={member.id}
                    className={`minimal-roster-row ${!member.enabled ? 'inactive' : ''}`}
                  >
                    <div className="roster-col-left">
                      <label className="sleek-switch">
                        <input
                          type="checkbox"
                          checked={member.enabled}
                          onChange={() => handleToggleUser(member.id)}
                        />
                        <span className="sleek-switch-slider" />
                      </label>

                      <div className="roster-avatar-mini">
                        {(member.name || 'U').slice(0, 2).toUpperCase()}
                      </div>

                      <div className="roster-user-details">
                        <div className="roster-user-name">
                          <span>{member.name}</span>
                          <span
                            className={`roster-role-chip ${
                              member.role === 'admin' ? 'admin' : ''
                            }`}
                          >
                            {member.role || 'member'}
                          </span>
                        </div>
                        <span className="roster-user-email">{member.email}</span>
                      </div>
                    </div>

                    <div className="roster-col-controls">
                      {mode === 'weighted' && (
                        <div className="roster-weight-cluster">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            value={member.weight}
                            disabled={!member.enabled}
                            onChange={(e) =>
                              handleWeightChange(member.id, e.target.value)
                            }
                            className="minimal-slider"
                          />
                          <span className="roster-weight-chip">
                            {member.weight} pts
                          </span>
                        </div>
                      )}

                      <span
                        className={`roster-share-badge ${
                          !member.enabled ? 'muted' : ''
                        }`}
                      >
                        {effectiveShare}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Fallback Option */}
        <div className="minimal-fallback-row">
          <div>
            <div className="minimal-section-title">Fallback Assignee</div>
            <div className="minimal-section-desc">
              Used if active roster is unavailable or empty.
            </div>
          </div>
          <select
            value={defaultAssignee}
            onChange={(e) => setDefaultAssignee(e.target.value)}
            className="minimal-select-box"
            style={{ maxWidth: '240px' }}
          >
            {userRules.map((u) => (
              <option key={u.id} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        {/* Minimal Simulation Output */}
        {simulation && (
          <div className="minimal-sim-drawer">
            <div className="minimal-sim-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={13} color="#0f172a" />
                <span>Simulation: Next 10 Leads</span>
              </div>
              <button
                type="button"
                className="btn-minimal-secondary"
                style={{ height: '22px', padding: '0 6px', fontSize: '11px' }}
                onClick={() => setSimulation(null)}
              >
                <X size={12} />
              </button>
            </div>
            <div className="minimal-sim-grid">
              {simulation.map((item) => (
                <div key={item.leadNum} className="minimal-sim-pill">
                  <span className="minimal-sim-idx">#{String(item.leadNum).padStart(2, '0')}</span>
                  <span className="minimal-sim-name">{item.assignee}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="minimal-toast">
          <Check size={14} color="#10b981" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
