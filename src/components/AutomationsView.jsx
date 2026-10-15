import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  UserPlus,
  RefreshCw,
  MessageCircle,
  Mail,
  Send,
  Check,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
  Phone,
  Video,
  MoreVertical,
  Paperclip,
  Mic,
  Smile,
  ChevronDown,
  ChevronRight,
  Sliders,
  GitBranch,
  Scale,
  User,
  Users,
  Play,
  Pause,
  Zap,
  RotateCcw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage } from '../lib/whatsapp';
import Skeleton from './common/Skeleton';
import '../styles/automations.css';

export default function AutomationsView({ currentUser }) {
  const [currentView, setCurrentView] = useState('hub'); // 'hub' | 'whatsapp' | 'lead_routing'
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // --------------------------------------------------------------------------
  // WhatsApp Welcome Automation States
  // --------------------------------------------------------------------------
  const [waStep, setWaStep] = useState(3);
  const [waName, setWaName] = useState('Meta WhatsApp Welcome Flow');
  const [waTrigger, setWaTrigger] = useState('new_lead');
  const [waAction, setWaAction] = useState('whatsapp');
  const [waConfigId, setWaConfigId] = useState(null);
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [templateName, setTemplateName] = useState('salado_lead_welcome');
  const [isWaActive, setIsWaActive] = useState(false);
  const [isSavingWa, setIsSavingWa] = useState(false);
  const [showCredentialsDrawer, setShowCredentialsDrawer] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testLeadName, setTestLeadName] = useState('Pranav');
  const [isTestingWa, setIsTestingWa] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Email fallback action states
  const [emailSubject, setEmailSubject] = useState('Welcome to our platform!');
  const [emailBody, setEmailBody] = useState('Hi {{name}}, thanks for reaching out! We received your request.');

  // --------------------------------------------------------------------------
  // Lead Routing Automation States (Two Independent Simultaneous Flows)
  // --------------------------------------------------------------------------
  const [lrStep, setLrStep] = useState(3);
  const [lrName, setLrName] = useState('Inbound Lead Routing Engine');
  const [isNewLeadFlowActive, setIsNewLeadFlowActive] = useState(true);
  const [isUnassignedFlowActive, setIsUnassignedFlowActive] = useState(true);
  const [newLeadMode, setNewLeadMode] = useState('round_robin'); // 'round_robin' | 'weighted' | 'single'
  const [unassignedMode, setUnassignedMode] = useState('round_robin');
  const [newLeadSingleAssignee, setNewLeadSingleAssignee] = useState('');
  const [unassignedSingleAssignee, setUnassignedSingleAssignee] = useState('');
  const [lrConfigId, setLrConfigId] = useState(null);
  const [isLrActive, setIsLrActive] = useState(true);
  const [isSavingLr, setIsSavingLr] = useState(false);
  const [newLeadRoundRobinIndex, setNewLeadRoundRobinIndex] = useState(0);
  const [unassignedRoundRobinIndex, setUnassignedRoundRobinIndex] = useState(0);
  const [newLeadTeam, setNewLeadTeam] = useState([]);
  const [unassignedTeam, setUnassignedTeam] = useState([]);

  // Simulation Feed for Lead Routing preview
  const [simulatedLeads, setSimulatedLeads] = useState([
    { id: 101, name: 'Rahul Sharma', source: 'Website Form', rep: 'Priya Patel', time: '2m ago' },
    { id: 102, name: 'Amit Verma', source: 'Meta Ad Campaign', rep: 'Pranav Patil', time: '14m ago' },
    { id: 103, name: 'Kavita Joshi', source: 'CSV Upload', rep: 'Rahul Verma', time: '1h ago' }
  ]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --------------------------------------------------------------------------
  // Data Fetching: Supabase Meta Config & Lead Routing Config
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;
    const fetchAllData = async () => {
      try {
        // 1. Fetch Meta WhatsApp Config
        const { data: metaData } = await supabase
          .from('meta_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        // 2. Fetch Users
        const { data: usersData } = await supabase
          .from('crm_users')
          .select('id, name, email, role')
          .order('name', { ascending: true });

        // 3. Fetch Lead Routing Config
        const { data: routingData } = await supabase
          .from('lead_routing_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (isMounted) {
          // Sync WhatsApp
          if (metaData) {
            setWaConfigId(metaData.id);
            setPhoneId(metaData.whatsapp_phone_number_id || '');
            setWabaId(metaData.whatsapp_business_account_id || '');
            setAccessToken(metaData.whatsapp_access_token || '');
            setTemplateName(metaData.whatsapp_template || 'salado_lead_welcome');
            setIsWaActive(Boolean(metaData.whatsapp_auto_welcome));
          }

          // Sync Lead Routing & Independent Team Rosters
          const rawNewRules = routingData?.new_lead_rules || routingData?.user_rules || [];
          const rawUnassignedRules = routingData?.unassigned_rules || routingData?.user_rules || [];
          const usersList = (usersData && usersData.length > 0)
            ? usersData
            : [
                { id: '1', name: 'Pranav Patil', email: 'pranav.p@capoasis.com', role: 'admin' },
                { id: '2', name: 'Priya Patel', email: 'priya@capoasis.com', role: 'member' },
                { id: '3', name: 'Rahul Verma', email: 'rahul@capoasis.com', role: 'member' }
              ];

          const mapUsers = (rulesList) =>
            usersList.map((user) => {
              const existing = (rulesList || []).find(
                (r) => r.id === user.id || r.email === user.email || r.name === user.name
              );
              return {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role || 'member',
                enabled: existing ? existing.enabled !== false : true,
                weight: existing?.weight !== undefined ? Number(existing.weight) : 50
              };
            });

          setNewLeadTeam(mapUsers(rawNewRules));
          setUnassignedTeam(mapUsers(rawUnassignedRules));

          if (routingData) {
            setLrConfigId(routingData.id);
            setNewLeadMode(routingData.new_lead_mode || routingData.mode || 'round_robin');
            setUnassignedMode(routingData.unassigned_mode || 'round_robin');
            setNewLeadSingleAssignee(routingData.new_lead_single_assignee || routingData.default_assignee || '');
            setUnassignedSingleAssignee(routingData.unassigned_single_assignee || routingData.default_assignee || '');
            if (routingData.new_lead_enabled !== undefined) {
              setIsNewLeadFlowActive(routingData.new_lead_enabled !== false);
            }
            if (routingData.unassigned_enabled !== undefined) {
              setIsUnassignedFlowActive(routingData.unassigned_enabled !== false);
            }
            setNewLeadRoundRobinIndex(routingData.new_lead_round_robin_index || routingData.round_robin_index || 0);
            setUnassignedRoundRobinIndex(routingData.unassigned_round_robin_index || 0);
          }
        }
      } catch (err) {
        console.warn('Error loading automation data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchAllData();
    return () => {
      isMounted = false;
    };
  }, []);

  const newLeadActiveReps = useMemo(() => {
    return newLeadTeam.filter((m) => m.enabled);
  }, [newLeadTeam]);

  const unassignedActiveReps = useMemo(() => {
    return unassignedTeam.filter((m) => m.enabled);
  }, [unassignedTeam]);

  // --------------------------------------------------------------------------
  // WhatsApp Actions
  // --------------------------------------------------------------------------
  const handleToggleActivateWa = async () => {
    setIsSavingWa(true);
    const nextState = !isWaActive;
    setIsWaActive(nextState);

    try {
      const payload = {
        whatsapp_phone_number_id: phoneId.trim(),
        whatsapp_business_account_id: wabaId.trim(),
        whatsapp_access_token: accessToken.trim(),
        whatsapp_template: templateName.trim() || 'salado_lead_welcome',
        whatsapp_auto_welcome: nextState,
        updated_at: new Date().toISOString()
      };

      if (waConfigId) {
        const { error } = await supabase
          .from('meta_config')
          .update(payload)
          .eq('id', waConfigId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('meta_config')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        if (data) setWaConfigId(data.id);
      }

      showToast(nextState ? 'WhatsApp Welcome Activated' : 'WhatsApp Welcome Paused');
    } catch (err) {
      console.error('Error activating WhatsApp automation:', err);
      showToast('Could not save state: ' + err.message, 'error');
      setIsWaActive(!nextState);
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleSaveWaCredentials = async () => {
    setIsSavingWa(true);
    try {
      const payload = {
        whatsapp_phone_number_id: phoneId.trim(),
        whatsapp_business_account_id: wabaId.trim(),
        whatsapp_access_token: accessToken.trim(),
        whatsapp_template: templateName.trim() || 'salado_lead_welcome',
        whatsapp_auto_welcome: isWaActive,
        updated_at: new Date().toISOString()
      };

      if (waConfigId) {
        await supabase.from('meta_config').update(payload).eq('id', waConfigId);
      } else {
        const { data } = await supabase.from('meta_config').insert(payload).select().single();
        if (data) setWaConfigId(data.id);
      }

      showToast('WhatsApp API credentials saved', 'success');
      setShowCredentialsDrawer(false);
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleSendTestWa = async () => {
    if (!testPhone.trim()) {
      setTestResult({
        success: false,
        message: 'Please enter a recipient phone number (e.g. +91 98765 43210)'
      });
      return;
    }

    setIsTestingWa(true);
    setTestResult(null);

    try {
      const res = await sendWhatsAppMessage({
        to: testPhone.trim(),
        leadName: testLeadName.trim() || 'Pranav',
        templateName: templateName.trim() || 'salado_lead_welcome',
        overrideConfig: {
          whatsapp_phone_number_id: phoneId.trim(),
          whatsapp_access_token: accessToken.trim(),
          whatsapp_template: templateName.trim() || 'salado_lead_welcome'
        }
      });

      setTestResult({
        success: true,
        message: `Template "${res.template}" delivered successfully.`
      });
      showToast('Test WhatsApp message delivered', 'success');
    } catch (err) {
      setTestResult({
        success: false,
        message: err.message || 'Delivery failed. Check Meta credentials.'
      });
    } finally {
      setIsTestingWa(false);
    }
  };

  // --------------------------------------------------------------------------
  // Lead Routing Actions
  // --------------------------------------------------------------------------
  const handleToggleNewLeadMember = (memberId) => {
    setNewLeadTeam((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const handleToggleUnassignedMember = (memberId) => {
    setUnassignedTeam((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const handleNewLeadWeightChange = (memberId, newWeight) => {
    const val = Math.max(0, Math.min(100, parseInt(newWeight, 10) || 0));
    setNewLeadTeam((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, weight: val } : m))
    );
  };

  const handleUnassignedWeightChange = (memberId, newWeight) => {
    const val = Math.max(0, Math.min(100, parseInt(newWeight, 10) || 0));
    setUnassignedTeam((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, weight: val } : m))
    );
  };

  const handleSaveRouting = async () => {
    setIsSavingLr(true);
    try {
      const payload = {
        mode: newLeadMode,
        new_lead_mode: newLeadMode,
        unassigned_mode: unassignedMode,
        new_lead_enabled: isNewLeadFlowActive,
        unassigned_enabled: isUnassignedFlowActive,
        new_lead_single_assignee: newLeadSingleAssignee || newLeadActiveReps[0]?.name || '',
        unassigned_single_assignee: unassignedSingleAssignee || unassignedActiveReps[0]?.name || '',
        new_lead_rules: newLeadTeam,
        unassigned_rules: unassignedTeam,
        user_rules: newLeadTeam,
        round_robin_index: newLeadRoundRobinIndex,
        new_lead_round_robin_index: newLeadRoundRobinIndex,
        unassigned_round_robin_index: unassignedRoundRobinIndex,
        default_assignee: newLeadSingleAssignee || newLeadActiveReps[0]?.name || 'Unassigned',
        updated_at: new Date().toISOString()
      };

      if (lrConfigId) {
        await supabase.from('lead_routing_config').update(payload).eq('id', lrConfigId);
      } else {
        const { data } = await supabase.from('lead_routing_config').insert(payload).select().single();
        if (data) setLrConfigId(data.id);
      }

      showToast('Lead distribution settings saved', 'success');
    } catch (err) {
      console.error('Error saving routing config:', err);
      showToast('Could not save routing: ' + err.message, 'error');
    } finally {
      setIsSavingLr(false);
    }
  };

  const handleToggleMasterLr = async () => {
    const nextState = !isLrActive;
    setIsLrActive(nextState);
    showToast(nextState ? 'Lead distribution activated' : 'Lead distribution paused');
  };

  // Run Live Simulation
  const handleSimulateLead = (flowType = 'new_lead') => {
    const isNew = flowType === 'new_lead';
    const activeList = isNew ? newLeadActiveReps : unassignedActiveReps;
    const mode = isNew ? newLeadMode : unassignedMode;
    const singleAssignee = isNew ? newLeadSingleAssignee : unassignedSingleAssignee;

    if (mode === 'unassigned') {
      const randomLeadNames = ['Deepak Roy', 'Ananya Gupta', 'Siddharth Sen', 'Tanya Mehra', 'Vikram Seth', 'Aditi Rao', 'Karan Patel'];
      const randomName = randomLeadNames[Math.floor(Math.random() * randomLeadNames.length)];
      const sourceLabel = 'Route Unassigned Leads';
      const newSim = {
        id: Date.now(),
        name: randomName,
        source: sourceLabel,
        rep: 'Unassigned',
        time: 'Just now'
      };
      setSimulatedLeads((prev) => [newSim, ...prev.slice(0, 4)]);
      showToast(`${randomName} kept in unassigned pool`, 'info');
      return;
    }

    if (mode !== 'single' && activeList.length === 0) {
      showToast(`Enable at least 1 team member in ${isNew ? 'Route New Leads' : 'Route Unassigned Leads'} rotation`, 'error');
      return;
    }

    let assignedRepName = '';
    if (mode === 'single') {
      assignedRepName = singleAssignee || activeList[0]?.name || 'Dedicated Rep';
    } else if (mode === 'weighted') {
      const totalWeight = activeList.reduce((s, r) => s + (Number(r.weight) || 0), 0);
      if (totalWeight <= 0) {
        assignedRepName = activeList[0]?.name || 'Assignee';
      } else {
        let rand = Math.random() * totalWeight;
        for (const rep of activeList) {
          rand -= (Number(rep.weight) || 0);
          if (rand <= 0) {
            assignedRepName = rep.name;
            break;
          }
        }
        if (!assignedRepName) assignedRepName = activeList[0]?.name;
      }
    } else {
      // Round robin
      const currIdx = isNew ? newLeadRoundRobinIndex : unassignedRoundRobinIndex;
      const assignedRep = activeList[currIdx % activeList.length];
      assignedRepName = assignedRep.name;
      const nextIdx = (currIdx + 1) % activeList.length;
      if (isNew) setNewLeadRoundRobinIndex(nextIdx);
      else setUnassignedRoundRobinIndex(nextIdx);
    }

    const randomLeadNames = ['Deepak Roy', 'Ananya Gupta', 'Siddharth Sen', 'Tanya Mehra', 'Vikram Seth', 'Aditi Rao', 'Karan Patel'];
    const randomName = randomLeadNames[Math.floor(Math.random() * randomLeadNames.length)];
    const sourceLabel = isNew ? 'Route New Leads' : 'Route Unassigned Leads';

    const newSim = {
      id: Date.now(),
      name: randomName,
      source: sourceLabel,
      rep: assignedRepName,
      time: 'Just now'
    };

    setSimulatedLeads((prev) => [newSim, ...prev.slice(0, 4)]);
    showToast(`Assigned ${randomName} to ${assignedRepName} via ${sourceLabel}`, 'success');
  };

  if (isLoading) {
    return (
      <div className="automations-builder-root">
        <div className="automations-hub-container">
          <Skeleton width="220px" height="28px" borderRadius="4px" />
          <Skeleton width="340px" height="16px" borderRadius="4px" />
          <div className="hub-cards-grid" style={{ marginTop: 24 }}>
            <Skeleton width="100%" height="240px" borderRadius="8px" />
            <Skeleton width="100%" height="240px" borderRadius="8px" />
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 1: AUTOMATIONS HUB (ENTRY SCREEN)
  // ==========================================================================
  if (currentView === 'hub') {
    return (
      <div className="automations-builder-root">
        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 28,
              zIndex: 9999,
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '12.5px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Check size={14} style={{ color: '#10b981' }} />
            <span>{toast.message}</span>
          </div>
        )}

        <div className="automations-hub-container">
          <div className="hub-header">
            <h1 className="hub-title">Automations</h1>
            <p className="hub-subtitle">
              Choose an automation workflow to configure, monitor, or test.
            </p>
          </div>

          <div className="hub-cards-grid">
            {/* WORKFLOW 1: WhatsApp Automation */}
            <div className="hub-workflow-card" onClick={() => setCurrentView('whatsapp')}>
              <div className="hub-card-top">
                <div className="hub-card-header-row">
                  <div className="hub-card-title-group">
                    <div className="hub-card-icon">
                      <MessageCircle size={18} />
                    </div>
                    <h3 className="hub-card-title">Whatsapp Automation</h3>
                  </div>
                  <span className={`hub-status-badge ${isWaActive ? 'active' : 'paused'}`}>
                    <span>{isWaActive ? 'Active' : 'Paused'}</span>
                  </span>
                </div>

                <div className="hub-card-info">
                  <p>
                    Automatically send Meta-approved WhatsApp template messages to new leads instantly upon creation.
                  </p>
                </div>

                <div className="hub-flow-snippet">
                  <Zap size={13} />
                  <span>New Lead Added</span>
                  <span style={{ color: '#9ca3af' }}>──▶</span>
                  <MessageCircle size={13} />
                  <span>Send WhatsApp Welcome</span>
                </div>
              </div>

              <div className="hub-btn-configure">
                <span>Configure Workflow</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* WORKFLOW 2: Lead Distribution */}
            <div className="hub-workflow-card" onClick={() => setCurrentView('lead_routing')}>
              <div className="hub-card-top">
                <div className="hub-card-header-row">
                  <div className="hub-card-title-group">
                    <div className="hub-card-icon">
                      <GitBranch size={18} />
                    </div>
                    <h3 className="hub-card-title">Lead Distribution</h3>
                  </div>
                  <span className={`hub-status-badge ${isLrActive ? 'active' : 'paused'}`}>
                    <span>{isLrActive ? 'Active' : 'Paused'}</span>
                  </span>
                </div>

                <div className="hub-card-info">
                  <p>
                    Automatically distribute new incoming leads and unassigned backlog fairly across active sales reps.
                  </p>
                </div>

                <div className="hub-flow-snippet">
                  <Zap size={13} />
                  <span>New & Unassigned Leads</span>
                  <span style={{ color: '#9ca3af' }}>──▶</span>
                  <GitBranch size={13} />
                  <span>Fair Round-Robin</span>
                </div>
              </div>

              <div className="hub-btn-configure">
                <span>Configure Workflow</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 2: WHATSAPP WELCOME FLOW BUILDER
  // ==========================================================================
  if (currentView === 'whatsapp') {
    return (
      <div className="automations-builder-root">
        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 28,
              zIndex: 9999,
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '12.5px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Check size={14} style={{ color: '#10b981' }} />
            <span>{toast.message}</span>
          </div>
        )}

        {/* Top Bar */}
        <div className="builder-top-bar">
          <button
            type="button"
            className="btn-back-automations"
            onClick={() => setCurrentView('hub')}
          >
            <ArrowLeft size={13} />
            <span>Back to Automations</span>
          </button>

          <div className="builder-stepper">
            <div className={`stepper-step ${waStep >= 1 ? 'completed active' : ''}`}>
              <span className="step-box">1</span>
              <span>Name</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 2 ? 'completed active' : ''}`}>
              <span className="step-box">2</span>
              <span>Trigger</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 3 ? 'active' : ''}`}>
              <span className="step-box">3</span>
              <span>Action</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 4 ? 'active' : ''}`}>
              <span className="step-box">4</span>
              <span>Activate</span>
            </div>
          </div>

          <div style={{ width: 140 }}></div>
        </div>

        {/* 2-Column Canvas Layout */}
        <div className="builder-workspace">
          {/* Left Canvas Column */}
          <div className="builder-canvas-col">
            {/* Step 1: Name */}
            <div className="flow-solid-card">
              <h2 className="flow-node-title">Name your automation</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="flow-field-label">Automation Name</label>
                <input
                  type="text"
                  className="flow-text-input"
                  value={waName}
                  onChange={(e) => setWaName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-flow-continue"
                  onClick={() => setWaStep(2)}
                >
                  <span>Continue</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 2: Trigger */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">When this happens...</h3>
              <div className="flow-options-grid">
                <div
                  className={`flow-option-card ${waTrigger === 'new_lead' ? 'selected' : ''}`}
                  onClick={() => {
                    setWaTrigger('new_lead');
                    setWaStep(3);
                  }}
                >
                  <div className="flow-option-icon">
                    <UserPlus size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">New Lead Added</h4>
                    <p className="flow-option-sub">Triggered when a lead is imported or added.</p>
                  </div>
                </div>

                <div
                  className={`flow-option-card ${waTrigger === 'status_changed' ? 'selected' : ''}`}
                  onClick={() => {
                    setWaTrigger('status_changed');
                    setWaStep(3);
                  }}
                >
                  <div className="flow-option-icon">
                    <RefreshCw size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Status Changed</h4>
                    <p className="flow-option-sub">Triggered on pipeline stage moves.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 3: Action */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Do this...</h3>
              <div className="flow-options-grid">
                <div
                  className={`flow-option-card ${waAction === 'whatsapp' ? 'selected' : ''}`}
                  onClick={() => setWaAction('whatsapp')}
                >
                  <div className="flow-option-icon">
                    <MessageCircle size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Send WhatsApp</h4>
                    <p className="flow-option-sub">Send a pre-defined message template.</p>
                  </div>
                </div>

                <div
                  className={`flow-option-card ${waAction === 'email' ? 'selected' : ''}`}
                  onClick={() => setWaAction('email')}
                >
                  <div className="flow-option-icon">
                    <Mail size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Send Email</h4>
                    <p className="flow-option-sub">Send a standard email sequence.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 4: Action Settings */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Action Settings</h3>

              {waAction === 'whatsapp' ? (
                <div className="action-settings-card">
                  <div className="template-badge-row">
                    <div>
                      <label className="flow-field-label">WhatsApp Approved Template</label>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#111827', marginTop: 3 }}>
                        {templateName || 'salado_lead_welcome'}
                      </div>
                    </div>
                    <span className="template-status-badge">
                      <span className="template-status-dot"></span>
                      <span>Approved</span>
                    </span>
                  </div>
                </div>
              ) : (
                /* EMAIL SETTINGS */
                <div className="action-settings-card">
                  <div>
                    <label className="flow-field-label" style={{ marginBottom: 6, display: 'block' }}>
                      Subject Line
                    </label>
                    <input
                      type="text"
                      className="flow-text-input"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="flow-field-label" style={{ marginBottom: 6, display: 'block' }}>
                      Email Body
                    </label>
                    <textarea
                      className="flow-text-input"
                      style={{ height: 90, padding: '10px 12px', resize: 'vertical' }}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                    />
                  </div>

                  <div className="available-tags-row">
                    <span>Available Tags:</span>
                    <span className="tag-chip">{'{{name}}'}</span>
                    <span className="tag-chip">{'{{source}}'}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 5: Finalize */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Finalize</h3>
              <div className="finalize-card">
                <button
                  type="button"
                  className={`btn-activate-large ${isWaActive ? 'active-state' : 'primary-activate'}`}
                  onClick={handleToggleActivateWa}
                  disabled={isSavingWa}
                >
                  {isSavingWa ? (
                    <>
                      <RefreshCw size={14} className="spin-icon" />
                      <span>Saving...</span>
                    </>
                  ) : isWaActive ? (
                    <>
                      <Check size={15} />
                      <span>Automation is Active (Click to Pause)</span>
                    </>
                  ) : (
                    <span>Activate Automation</span>
                  )}
                </button>
                <p className="finalize-caption">
                  {isWaActive
                    ? 'Live: Automatically sending WhatsApp messages for incoming leads.'
                    : 'Ready to launch. Click Activate to begin automatic dispatch.'}
                </p>
              </div>
            </div>
          </div>

          {/* Right Live Preview Column (iPhone) */}
          <div className="builder-preview-col">
            <div className="iphone-mockup">
              <div className="iphone-screen">
                <div className="iphone-status-bar">
                  <span>9:41</span>
                  <div className="iphone-status-icons">
                    <span>●●●</span>
                    <span>📶</span>
                    <span>🔋</span>
                  </div>
                </div>

                {waAction === 'whatsapp' ? (
                  <>
                    <div className="wa-app-header">
                      <div className="wa-header-left">
                        <span style={{ fontSize: 13, color: '#374151' }}>‹</span>
                        <div className="wa-avatar">S</div>
                        <div className="wa-contact-info">
                          <span className="wa-contact-name">SimpleCRM</span>
                          <span className="wa-contact-status">online</span>
                        </div>
                      </div>
                      <div className="wa-header-actions">
                        <Video size={13} />
                        <Phone size={13} />
                        <MoreVertical size={13} />
                      </div>
                    </div>

                    <div className="wa-chat-canvas">
                      <div className="wa-chat-bubble-received">
                        <p className="wa-bubble-text">
                          Hello {testLeadName || 'there'}, thank you for your interest in SaladO!
                          {'\n\n'}
                          We have received your franchise inquiry. Our team will connect with you shortly to share the brand presentation and guide you through the next steps.
                        </p>
                        <div className="wa-bubble-meta">
                          <span>9:41 AM</span>
                          <span className="wa-ticks">
                            <CheckCheck size={13} color="#53bdeb" />
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="wa-bottom-bar">
                      <Smile size={15} color="#6b7280" />
                      <div className="wa-input-pill">Message</div>
                      <Paperclip size={15} color="#6b7280" />
                      <div className="wa-mic-btn">
                        <Mic size={13} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="email-app-screen">
                    <div className="email-app-header">
                      <span>‹ Inbox</span>
                      <span>🗑</span>
                    </div>

                    <div className="email-app-body">
                      <h4 className="email-subject">{emailSubject || '(No Subject)'}</h4>
                      <div className="email-sender-row">
                        <div className="email-avatar">S</div>
                        <div className="email-sender-info">
                          <span className="email-sender-name">SimpleCRM</span>
                          <span className="email-sender-to">To: {testLeadName || 'Lead Name'}</span>
                        </div>
                      </div>
                      <p className="email-content-text">
                        {emailBody.replace('{{name}}', testLeadName || 'there')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 3: LEAD ROUTING & DISTRIBUTION FLOW BUILDER
  // ==========================================================================
  return (
    <div className="automations-builder-root">
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 28,
            zIndex: 9999,
            backgroundColor: '#111827',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '12.5px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Check size={14} style={{ color: '#10b981' }} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Clean Top Bar */}
      <div className="simple-lr-header">
        <div className="simple-lr-header-left">
          <button
            type="button"
            className="btn-back-automations"
            onClick={() => setCurrentView('hub')}
          >
            <ArrowLeft size={13} />
            <span>Automations</span>
          </button>
          <div className="simple-lr-title-wrap">
            <h1 className="simple-lr-title">Lead Distribution</h1>
          </div>
        </div>

        <div className="simple-lr-header-actions">
          <button
            type="button"
            className="btn-simple-save"
            onClick={handleSaveRouting}
            disabled={isSavingLr}
          >
            {isSavingLr ? (
              <>
                <RefreshCw size={13} className="spin-icon" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>
      </div>

      {/* Clean Settings Container */}
      <div className="simple-lr-body">
        <div className="simple-lr-content">
          {/* Section 1: Two Separate Columns for Flows */}
          <div className="simple-two-cols-grid">
            {/* Column 1: Route New Leads */}
            <div className="simple-flow-col-card">
              <div className="flow-col-header">
                <div className="flow-col-title-wrap">
                  <div className="flow-col-icon">
                    <UserPlus size={16} />
                  </div>
                  <h3 className="flow-col-title">Route New Leads</h3>
                </div>
              </div>

              <div className="flow-col-fields">
                <div className="flow-col-field-group">
                  <label className="flow-col-label">Distribution Mode</label>
                  <select
                    className="simple-select full-width"
                    value={newLeadMode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewLeadMode(val);
                      if (val === 'single' && !newLeadSingleAssignee && newLeadActiveReps.length > 0) {
                        setNewLeadSingleAssignee(newLeadActiveReps[0].name);
                      }
                    }}
                  >
                    <option value="round_robin">Round-Robin (Equal 1:1)</option>
                    <option value="weighted">Weighted Ratio</option>
                    <option value="single">Single Dedicated Rep</option>
                  </select>
                </div>

                {newLeadMode === 'single' && (
                  <div className="flow-col-field-group">
                    <label className="flow-col-label">Assign To</label>
                    <select
                      className="simple-select full-width assignee-select"
                      value={newLeadSingleAssignee || newLeadActiveReps[0]?.name || ''}
                      onChange={(e) => setNewLeadSingleAssignee(e.target.value)}
                    >
                      {newLeadActiveReps.map((rep) => (
                        <option key={rep.id} value={rep.name}>
                          {rep.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Team Members List with Checkboxes */}
                {newLeadMode !== 'single' && (
                  <div className="flow-col-team-section">
                    <div className="flow-col-team-header">
                      <span className="flow-col-label">Team Members</span>
                      <span className="flow-col-team-meta">
                        {newLeadActiveReps.length} of {newLeadTeam.length} in rotation
                      </span>
                    </div>

                    <div className="flow-col-members-list">
                      {newLeadTeam.map((member) => {
                        const isNextInLine =
                          newLeadActiveReps[newLeadRoundRobinIndex % Math.max(newLeadActiveReps.length, 1)]?.id === member.id;
                        const isWeighted = newLeadMode === 'weighted';

                        return (
                          <div
                            key={member.id}
                            className={`flow-member-item ${member.enabled ? 'included' : 'excluded'}`}
                          >
                            <label className="flow-member-left">
                              <input
                                type="checkbox"
                                className="member-check-input"
                                checked={member.enabled}
                                onChange={() => handleToggleNewLeadMember(member.id)}
                              />
                              <div className="flow-member-avatar">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flow-member-info">
                                <div className="flow-member-name-row">
                                  <span className="flow-member-name">{member.name}</span>
                                  {isNextInLine && member.enabled && !isWeighted && (
                                    <span className="next-in-line-badge">Next</span>
                                  )}
                                </div>
                                <span className="flow-member-email">{member.email}</span>
                              </div>
                            </label>

                            {isWeighted && member.enabled && (
                              <div className="member-weight-wrap">
                                <span className="member-weight-label">Weight:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  className="member-weight-input"
                                  value={member.weight ?? 50}
                                  onChange={(e) => handleNewLeadWeightChange(member.id, e.target.value)}
                                />
                                <span className="member-weight-unit">%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flow-col-footer">
                <button
                  type="button"
                  className="btn-simple-test full-width"
                  onClick={() => handleSimulateLead('new_lead')}
                >
                  <Play size={11} fill="#111827" />
                  <span>Test Route New Leads</span>
                </button>
              </div>
            </div>

            {/* Column 2: Route Unassigned Leads */}
            <div className="simple-flow-col-card">
              <div className="flow-col-header">
                <div className="flow-col-title-wrap">
                  <div className="flow-col-icon">
                    <RefreshCw size={16} />
                  </div>
                  <h3 className="flow-col-title">Route Unassigned Leads</h3>
                </div>
              </div>

              <div className="flow-col-fields">
                <div className="flow-col-field-group">
                  <label className="flow-col-label">Distribution Mode</label>
                  <select
                    className="simple-select full-width"
                    value={unassignedMode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUnassignedMode(val);
                      if (val === 'single' && !unassignedSingleAssignee && unassignedActiveReps.length > 0) {
                        setUnassignedSingleAssignee(unassignedActiveReps[0].name);
                      }
                    }}
                  >
                    <option value="unassigned">Leave Unassigned</option>
                    <option value="round_robin">Round-Robin (Equal 1:1)</option>
                    <option value="weighted">Weighted Ratio</option>
                    <option value="single">Single Dedicated Rep</option>
                  </select>
                </div>

                {unassignedMode === 'unassigned' && (
                  <div className="flow-col-unassigned-notice">
                    <span>Leads remain in the unassigned pool for manual assignment.</span>
                  </div>
                )}

                {unassignedMode === 'single' && (
                  <div className="flow-col-field-group">
                    <label className="flow-col-label">Assign To</label>
                    <select
                      className="simple-select full-width assignee-select"
                      value={unassignedSingleAssignee || unassignedActiveReps[0]?.name || ''}
                      onChange={(e) => setUnassignedSingleAssignee(e.target.value)}
                    >
                      {unassignedActiveReps.map((rep) => (
                        <option key={rep.id} value={rep.name}>
                          {rep.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Team Members List with Checkboxes */}
                {unassignedMode !== 'single' && unassignedMode !== 'unassigned' && (
                  <div className="flow-col-team-section">
                    <div className="flow-col-team-header">
                      <span className="flow-col-label">Team Members</span>
                      <span className="flow-col-team-meta">
                        {unassignedActiveReps.length} of {unassignedTeam.length} in rotation
                      </span>
                    </div>

                    <div className="flow-col-members-list">
                      {unassignedTeam.map((member) => {
                        const isNextInLine =
                          unassignedActiveReps[unassignedRoundRobinIndex % Math.max(unassignedActiveReps.length, 1)]?.id === member.id;
                        const isWeighted = unassignedMode === 'weighted';

                        return (
                          <div
                            key={member.id}
                            className={`flow-member-item ${member.enabled ? 'included' : 'excluded'}`}
                          >
                            <label className="flow-member-left">
                              <input
                                type="checkbox"
                                className="member-check-input"
                                checked={member.enabled}
                                onChange={() => handleToggleUnassignedMember(member.id)}
                              />
                              <div className="flow-member-avatar">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flow-member-info">
                                <div className="flow-member-name-row">
                                  <span className="flow-member-name">{member.name}</span>
                                  {isNextInLine && member.enabled && !isWeighted && (
                                    <span className="next-in-line-badge">Next</span>
                                  )}
                                </div>
                                <span className="flow-member-email">{member.email}</span>
                              </div>
                            </label>

                            {isWeighted && member.enabled && (
                              <div className="member-weight-wrap">
                                <span className="member-weight-label">Weight:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  className="member-weight-input"
                                  value={member.weight ?? 50}
                                  onChange={(e) => handleUnassignedWeightChange(member.id, e.target.value)}
                                />
                                <span className="member-weight-unit">%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flow-col-footer">
                <button
                  type="button"
                  className="btn-simple-test full-width"
                  onClick={() => handleSimulateLead('unassigned')}
                >
                  <Play size={11} fill="#111827" />
                  <span>Test Route Unassigned Leads</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
