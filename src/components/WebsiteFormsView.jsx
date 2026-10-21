import { useState, useEffect } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Code,
  RefreshCw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';
import '../styles/pipeline.css';

export default function WebsiteFormsView({ currentUser }) {
  const [forms, setForms] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFormName, setNewFormName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedScriptForm, setSelectedScriptForm] = useState(null);
  const [scriptCopied, setScriptCopied] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  // Fetch website forms and pipelines
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [formsRes, pipesRes] = await Promise.all([
        supabase
          .from('connected_forms')
          .select('*')
          .eq('source', 'website')
          .order('created_at', { ascending: false }),
        supabase
          .from('pipelines')
          .select('id, name')
      ]);

      if (formsRes.data) setForms(formsRes.data);
      if (pipesRes.data) setPipelines(pipesRes.data);
    } catch (err) {
      console.warn('Error loading website forms:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateForm = async (e) => {
    e.preventDefault();
    const name = newFormName.trim();
    if (!name || isCreating) return;

    setIsCreating(true);
    try {
      const uniqueId = `wf_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      const payload = {
        form_id: uniqueId,
        form_name: name,
        source: 'website',
        pipeline_id: null,
        entry_stage_id: 'new',
        allocation_mode: 'inherit_global',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('connected_forms')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setForms((prev) => [data, ...prev]);
      }
      setNewFormName('');
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to create website form:', err);
      alert('Failed to create form: ' + (err.message || 'Unknown error'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteForm = async (form) => {
    if (!window.confirm(`Delete "${form.form_name}"? Existing leads will remain unchanged.`)) return;

    try {
      await supabase
        .from('connected_forms')
        .delete()
        .eq('id', form.id);

      setForms((prev) => prev.filter((f) => f.id !== form.id));
      if (selectedScriptForm?.id === form.id) {
        setSelectedScriptForm(null);
      }
    } catch (err) {
      console.error('Failed to delete website form:', err);
      alert('Could not delete form: ' + (err.message || 'Unknown error'));
    }
  };

  const getUniversalScript = (formId) => {
    const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${formId}`;
    return `<script>
(function() {
  const endpoint = '${endpoint}';

  // Verify connection on load
  fetch(endpoint + '&ping=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site_domain: window.location.hostname })
  }).catch(function() {});

  // Form submission handler
  document.getElementById('YOUR_FORM_ID').addEventListener('submit', async function(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(this).entries());
    data.site_domain = window.location.hostname;

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    alert('Thank you! Your inquiry has been received.');
    this.reset();
  });
})();
</script>`;
  };

  const handleCopyScript = () => {
    if (!selectedScriptForm) return;
    const script = getUniversalScript(selectedScriptForm.form_id);
    navigator.clipboard.writeText(script);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <>
        <div className="meta-panel-card" style={{ marginTop: 0 }}>
          <div className="meta-panel-header">
            <div className="meta-panel-header-left">
              <Skeleton width="130px" height="18px" borderRadius="4px" />
              <Skeleton width="85px" height="20px" borderRadius="10px" />
            </div>
            <Skeleton width="96px" height="32px" borderRadius="6px" />
          </div>

          <div className="meta-forms-table">
            {[1, 2, 3].map((i) => (
              <div key={i} className="meta-form-row-item">
                <div className="meta-form-identity">
                  <Skeleton width="34px" height="34px" borderRadius="8px" />
                  <div className="meta-form-info-col" style={{ gap: '6px' }}>
                    <Skeleton width={i === 1 ? '140px' : (i === 2 ? '170px' : '120px')} height="15px" borderRadius="4px" />
                    <Skeleton width={i === 1 ? '110px' : (i === 2 ? '135px' : '100px')} height="14px" borderRadius="10px" />
                  </div>
                </div>
                <div className="meta-form-actions-col">
                  <Skeleton width="88px" height="30px" borderRadius="6px" />
                  <Skeleton width="30px" height="30px" borderRadius="6px" />
                  <Skeleton width="30px" height="30px" borderRadius="6px" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Setup Procedure Skeleton */}
        <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <Skeleton width="115px" height="20px" borderRadius="4px" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            {[1, 2, 3, 4].map((step) => (
              <div key={step} style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
                <Skeleton width="22px" height="28px" borderRadius="4px" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  <Skeleton width={step === 1 ? '190px' : (step === 2 ? '140px' : (step === 3 ? '160px' : '175px'))} height="16px" borderRadius="4px" />
                  <Skeleton width={step === 1 ? '92%' : (step === 2 ? '65%' : (step === 3 ? '80%' : '75%'))} height="13px" borderRadius="3px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="meta-panel-card" style={{ marginTop: 0 }}>
        <div className="meta-panel-header">
          <div className="meta-panel-header-left">
            <span className="meta-panel-title">Website Forms</span>
            <span className="meta-count-badge">
              {forms.length} {forms.length === 1 ? 'form' : 'forms'} active
            </span>
          </div>

          <button
            type="button"
            className="btn-meta-add-form"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={14} /> Add Form
          </button>
        </div>

        {forms.length === 0 ? (
          <div className="meta-forms-empty-state">
            <Globe size={24} color="#94a3b8" />
            <p className="meta-empty-title">No website forms configured</p>
            <button
              type="button"
              className="btn-meta-clean"
              onClick={() => setIsModalOpen(true)}
              style={{ marginTop: '8px' }}
            >
              <Plus size={13} /> Create Form
            </button>
          </div>
        ) : (
          <div className="meta-forms-table">
            {forms.map((form) => {
              const connectedPipe = pipelines.find((p) => p.id === form.pipeline_id);

              return (
                <div key={form.id || form.form_id} className="meta-form-row-item">
                  <div className="meta-form-identity">
                    <div className="meta-doc-tile">
                      <Globe size={16} color="#475569" />
                    </div>
                    <div className="meta-form-info-col">
                      <span className="meta-form-title">{form.form_name}</span>
                      <div className="meta-form-meta-row">
                        {(() => {
                          const sites = Array.isArray(form.connected_sites) && form.connected_sites.length > 0
                            ? form.connected_sites
                            : (Array.isArray(form.tags) ? form.tags : []);

                          if (sites.length === 0) {
                            return (
                              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1', display: 'inline-block' }} />
                                No site connected yet
                              </span>
                            );
                          }

                          if (sites.length === 1) {
                            return (
                              <span className="meta-connected-badge" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                                Active on {sites[0]}
                              </span>
                            );
                          }

                          return (
                            <span
                              className="meta-connected-badge"
                              style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
                              data-tooltip={sites.join(', ')}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                              Active on {sites.length} sites
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="meta-form-actions-col">
                    <button
                      type="button"
                      className="btn-meta-clean"
                      onClick={() => {
                        setSelectedScriptForm(form);
                        setScriptCopied(false);
                      }}
                      title="Get universal integration script"
                      style={{ height: '30px', padding: '0 10px', fontSize: '11.5px', gap: '6px' }}
                    >
                      <Code size={13} />
                      <span>Get Script</span>
                    </button>

                    <button
                      type="button"
                      className="btn-meta-icon-trash"
                      onClick={() => handleDeleteForm(form)}
                      data-tooltip="Delete form"
                      data-tooltip-pos="right-edge"
                      aria-label="Delete form"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Setup Procedure Section */}
      <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div className="pipeline-general-label" style={{ marginBottom: '6px' }}>
          Setup Procedure
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
            <span className="pipeline-number-index" style={{ lineHeight: 1.15 }}>1</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                Create a Dedicated Pipeline
              </span>
              <span style={{ fontSize: '13.5px', color: '#64748b', lineHeight: 1.55 }}>
                Go to <strong>Pipelines</strong> and create a new pipeline for this campaign (e.g. <em>Website Inquiries</em>). Select this form under <strong>Lead Source</strong> so incoming leads route to their own stages and custom team distribution.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
            <span className="pipeline-number-index" style={{ lineHeight: 1.15 }}>2</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                Copy the Script
              </span>
              <span style={{ fontSize: '13.5px', color: '#64748b', lineHeight: 1.55 }}>
                Click <strong>Get Script</strong> on your form above and copy the generated JavaScript code.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
            <span className="pipeline-number-index" style={{ lineHeight: 1.15 }}>3</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                Embed into Website
              </span>
              <span style={{ fontSize: '13.5px', color: '#64748b', lineHeight: 1.55 }}>
                Paste the snippet into your website footer or custom HTML block before the closing <code className="meta-code-inline">&lt;/body&gt;</code> tag.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
            <span className="pipeline-number-index" style={{ lineHeight: 1.15 }}>4</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                Set Form ID & Field Names
              </span>
              <span style={{ fontSize: '13.5px', color: '#64748b', lineHeight: 1.55 }}>
                Ensure your <code className="meta-code-inline">&lt;form&gt;</code> ID matches <code className="meta-code-inline">YOUR_FORM_ID</code> and inputs have standard name attributes (<code className="meta-code-inline">name</code>, <code className="meta-code-inline">phone</code>, <code className="meta-code-inline">email</code>, <code className="meta-code-inline">city</code>, <code className="meta-code-inline">message</code>). Additional fields are captured automatically as custom fields.
              </span>
            </div>
          </div>
        </div>
      </div>


      {/* Universal Script Modal */}
      {selectedScriptForm && (
        <div className="meta-modal-backdrop" onClick={() => setSelectedScriptForm(null)}>
          <div className="meta-modal" style={{ maxWidth: '660px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">Universal Integration Script</h3>
                <p className="meta-modal-subtitle" style={{ marginTop: '2px', fontSize: '12px', color: '#64748b' }}>
                  {selectedScriptForm.form_name}
                </p>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => setSelectedScriptForm(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="meta-modal-body" style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
                Paste this script into your site's custom code or footer before the closing <code className="meta-code-inline">&lt;/body&gt;</code> tag. Replace <code className="meta-code-inline">YOUR_FORM_ID</code> with your form’s ID attribute.
              </p>

              <div className="meta-script-preview-box">
                <div className="meta-script-preview-bar">
                  <div className="meta-script-dots">
                    <span className="meta-script-dot red" />
                    <span className="meta-script-dot yellow" />
                    <span className="meta-script-dot green" />
                    <span className="meta-script-filename">universal-form.html</span>
                  </div>
                  <button
                    type="button"
                    className="meta-script-copy-btn"
                    onClick={handleCopyScript}
                  >
                    {scriptCopied ? (
                      <>
                        <Check size={12} color="#4ade80" />
                        <span style={{ color: '#4ade80' }}>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="meta-script-code-wrap">
                  <pre className="meta-script-code">
                    <span className="syn-tag">&lt;script&gt;</span>{'\n'}
                    (<span className="syn-kw">function</span>() &#123;{'\n'}
                    {'  '}<span className="syn-kw">const</span> <span className="syn-var">endpoint</span> = <span className="syn-str">'{supabaseUrl}/functions/v1/website-webhook?form_id={selectedScriptForm.form_id}'</span>;{'\n'}
                    {'\n'}
                    {'  '}<span className="syn-punct">// Verify connection on load</span>{'\n'}
                    {'  '}<span className="syn-fn">fetch</span>(<span className="syn-var">endpoint</span> + <span className="syn-str">'&ping=true'</span>, &#123;{'\n'}
                    {'    '}<span className="syn-prop">method</span>: <span className="syn-str">'POST'</span>,{'\n'}
                    {'    '}<span className="syn-prop">headers</span>: &#123; <span className="syn-str">'Content-Type'</span>: <span className="syn-str">'application/json'</span> &#125;,{'\n'}
                    {'    '}<span className="syn-prop">body</span>: <span className="syn-obj">JSON</span>.<span className="syn-fn">stringify</span>(&#123; <span className="syn-prop">site_domain</span>: <span className="syn-obj">window</span>.<span className="syn-obj">location</span>.<span className="syn-var">hostname</span> &#125;){'\n'}
                    {'  '}&#125;).<span className="syn-fn">catch</span>(<span className="syn-kw">function</span>() &#123;&#125;);{'\n'}
                    {'\n'}
                    {'  '}<span className="syn-punct">// Form submission handler</span>{'\n'}
                    {'  '}<span className="syn-obj">document</span>.<span className="syn-fn">getElementById</span>(<span className="syn-str">'YOUR_FORM_ID'</span>).<span className="syn-fn">addEventListener</span>(<span className="syn-str">'submit'</span>, <span className="syn-kw">async function</span>(e) &#123;{'\n'}
                    {'    '}e.<span className="syn-fn">preventDefault</span>();{'\n'}
                    {'    '}<span className="syn-kw">const</span> <span className="syn-var">data</span> = <span className="syn-obj">Object</span>.<span className="syn-fn">fromEntries</span>(<span className="syn-kw">new</span> <span className="syn-obj">FormData</span>(<span className="syn-obj">this</span>).<span className="syn-fn">entries</span>());{'\n'}
                    {'    '}<span className="syn-var">data</span>.<span className="syn-var">site_domain</span> = <span className="syn-obj">window</span>.<span className="syn-obj">location</span>.<span className="syn-var">hostname</span>;{'\n'}
                    {'\n'}
                    {'    '}<span className="syn-kw">await</span> <span className="syn-fn">fetch</span>(<span className="syn-var">endpoint</span>, &#123;{'\n'}
                    {'      '}<span className="syn-prop">method</span>: <span className="syn-str">'POST'</span>,{'\n'}
                    {'      '}<span className="syn-prop">headers</span>: &#123; <span className="syn-str">'Content-Type'</span>: <span className="syn-str">'application/json'</span> &#125;,{'\n'}
                    {'      '}<span className="syn-prop">body</span>: <span className="syn-obj">JSON</span>.<span className="syn-fn">stringify</span>(<span className="syn-var">data</span>){'\n'}
                    {'    '}&#125;);{'\n'}
                    {'\n'}
                    {'    '}<span className="syn-fn">alert</span>(<span className="syn-str">'Thank you! Your inquiry has been received.'</span>);{'\n'}
                    {'    '}<span className="syn-obj">this</span>.<span className="syn-fn">reset</span>();{'\n'}
                    {'  '}&#125;);{'\n'}
                    &#125;)();{'\n'}
                    <span className="syn-tag">&lt;/script&gt;</span>
                  </pre>
                </div>
              </div>
            </div>

            <div className="meta-modal-footer">
              <button
                type="button"
                className="btn-meta-clean"
                onClick={() => setSelectedScriptForm(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-meta-primary"
                onClick={handleCopyScript}
              >
                {scriptCopied ? 'Copied to Clipboard' : 'Copy Script'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Create Modal */}
      {isModalOpen && (
        <div className="meta-modal-backdrop" onClick={() => !isCreating && setIsModalOpen(false)}>
          <div className="meta-modal" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">New Website Form</h3>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => !isCreating && setIsModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateForm}>
              <div className="meta-modal-body" style={{ padding: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Form Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  className="meta-input-field"
                  placeholder="e.g. Homepage Contact Form"
                  value={newFormName}
                  onChange={(e) => setNewFormName(e.target.value)}
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '13px'
                  }}
                />
              </div>

              <div className="meta-modal-footer">
                <button
                  type="button"
                  className="btn-meta-clean"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-meta-primary"
                  disabled={!newFormName.trim() || isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create Form'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
