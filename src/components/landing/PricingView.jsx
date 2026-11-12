import { useState, useRef } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Lock,
  Headphones,
  Users,
  Loader2,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { parseEdgeFunctionResult } from '../../lib/billing';
import { useScrollReveal, useSpotlightSurface } from '../../hooks/useKineticMotion';
import '../../styles/kinetic-motion.css';
import '../../styles/pricing.css';

const CURRENT_YEAR = new Date().getFullYear();

export default function PricingView({ onGoToHome, onGoToLogin }) {
  const pageRef = useRef(null);
  const ctaRef = useRef(null);
  const [teamSize, setTeamSize] = useState(15);
  const [openFaq, setOpenFaq] = useState(0);

  useScrollReveal(pageRef);
  useSpotlightSurface(ctaRef);

  // Lead Form State
  const [leadFormData, setLeadFormData] = useState({
    name: '',
    companyName: '',
    workEmail: '',
    phone: ''
  });
  const [leadErrors, setLeadErrors] = useState({});
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [trialResult, setTrialResult] = useState(null);

  const validateEmail = (email) => {
    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(trimmed);
  };

  const handleLeadSubmit = async (e) => {
    e.preventDefault();
    const errors = {};

    if (!leadFormData.name.trim()) {
      errors.name = 'Please enter your name';
    }

    if (!leadFormData.workEmail.trim()) {
      errors.workEmail = 'Please enter your work email';
    } else if (!validateEmail(leadFormData.workEmail)) {
      errors.workEmail = 'Please enter a valid email address';
    }

    if (!leadFormData.phone.trim()) {
      errors.phone = 'Please enter your phone number';
    } else if (leadFormData.phone.trim().length < 8) {
      errors.phone = 'Please enter a valid phone number';
    }

    if (Object.keys(errors).length > 0) {
      setLeadErrors(errors);
      return;
    }

    setLeadErrors({});
    setIsSubmittingLead(true);

    try {
      const normalizedEmail = leadFormData.workEmail.trim().toLowerCase();
      const loginUrl =
        typeof window !== 'undefined' && window.location?.origin
          ? `${window.location.origin}/login`
          : 'https://simplecrm.capoasis.com/login';

      const { data, error } = await supabase.functions.invoke('enroll-trial', {
        body: {
          name: leadFormData.name.trim(),
          companyName: leadFormData.companyName.trim() || undefined,
          workEmail: normalizedEmail,
          phone: leadFormData.phone.trim(),
          requestedSeats: teamSize > 25 ? 26 : teamSize,
          requestedEnterprise: teamSize > 25,
          loginUrl
        }
      });

      const result = await parseEdgeFunctionResult(data, error);
      if (!result?.success) {
        if (result?.code === 'EMAIL_EXISTS') {
          setLeadErrors({
            workEmail: result.error || 'An account with this work email already exists.',
            form: result.error || 'An account with this work email already exists. Please sign in instead.',
            existingEmail: normalizedEmail
          });
        } else {
          setLeadErrors({
            form: result?.error || 'Could not start your trial right now. Please try again.'
          });
        }
        return;
      }

      setTrialResult({
        provisioned: Boolean(result.provisioned),
        company: result.company || null,
        adminEmail: result.adminEmail || normalizedEmail,
        emailSent: Boolean(result.emailSent),
        tempPassword: result.tempPassword || null
      });
      setLeadSubmitted(true);
    } catch (err) {
      setLeadErrors({
        form: err?.message || 'Network error while provisioning your trial. Please try again.'
      });
    } finally {
      setIsSubmittingLead(false);
    }
  };

  const pricePerUser = 999;
  const traditionalAvgPrice = 2200;
  const monthlyTotal = teamSize * pricePerUser;
  const traditionalMonthlyTotal = teamSize * traditionalAvgPrice;
  const monthlySavings = traditionalMonthlyTotal - monthlyTotal;

  const comparisonData = [
    {
      feature: 'Monthly price per seat',
      traditional: '₹1,200 – ₹3,500 / seat',
      traditionalNote: '+ tier add-ons & lock-in',
      teamstuff: '₹999 / seat',
      teamstuffNote: 'Flat rate · Add seats anytime',
      highlight: true
    },
    {
      feature: 'Setup & Onboarding Fees',
      traditional: '₹25,000 – ₹1,00,000',
      traditionalNote: 'Mandatory implementation charges',
      teamstuff: '₹0 Free',
      teamstuffNote: 'Zero setup fee',
      highlight: false
    },
    {
      feature: 'Meta Lead Ads & Instant Ingestion',
      traditional: 'Zapier / Make ($30–$80/mo)',
      traditionalNote: '15-minute polling delays',
      teamstuff: 'Included',
      teamstuffNote: 'Direct server webhook · 12ms',
      highlight: false
    },
    {
      feature: 'WhatsApp Cloud API Automated Intro',
      traditional: '3rd Party Add-on ($50–$150/mo)',
      traditionalNote: 'Third-party middleware cost',
      teamstuff: 'Included',
      teamstuffNote: 'Official Meta Cloud API triggers',
      highlight: false
    },
    {
      feature: 'Visual Kanban Pipelines & Deal Tracking',
      traditional: 'Paywalled by tier',
      traditionalNote: 'Seat tier limitations',
      teamstuff: 'Included',
      teamstuffNote: 'Unlimited pipelines & stages',
      highlight: false
    },
    {
      feature: 'B2B Lead Discovery & Scraper',
      traditional: 'Apollo / ZoomInfo ($99/mo)',
      traditionalNote: 'Expensive external data tool',
      teamstuff: 'Included',
      teamstuffNote: 'Integrated Google Places scraper',
      highlight: false
    },
    {
      feature: 'Android Native Mobile App',
      traditional: 'Slow, clunky web wrapper',
      traditionalNote: 'Delayed mobile notifications',
      teamstuff: 'Included',
      teamstuffNote: 'Instant push & 1-tap dialer',
      highlight: false
    },
    {
      feature: 'Meta CAPI (Conversions API) Auto-Sync',
      traditional: 'Enterprise Tier only',
      traditionalNote: 'Requires manual offline CSV uploads',
      teamstuff: 'Included',
      teamstuffNote: 'Real-time Closed Won sync',
      highlight: false
    },
    {
      feature: 'Contracts & Commitment',
      traditional: '1 to 3 Year Lock-in',
      traditionalNote: 'Strict early termination fees',
      teamstuff: 'Monthly, Cancel Anytime',
      teamstuffNote: '14-day free trial · Zero lock-in',
      highlight: false
    }
  ];

  const faqs = [
    {
      q: 'Are there any setup fees or hidden charges?',
      a: 'No. After your 14-day free trial, pricing is strictly ₹999 per active sales seat per month. There are zero onboarding fees, module unlock charges, or surprise extras. You can easily add more seats as your team expands at the same flat ₹999 rate.'
    },
    {
      q: 'Are Meta Ads and WhatsApp Cloud API included?',
      a: 'Yes! Direct server-level Meta webhook capture and official WhatsApp Cloud API triggers are completely built-in, saving you from expensive Zapier, Make, or third-party BSP subscriptions.'
    },
    {
      q: 'How does billing work when we add sales seats later?',
      a: 'Once your workspace is live, you can add or purchase more seats anytime as your team grows at the same flat ₹999/month per seat rate.'
    },
    {
      q: 'How does the 14-day free trial work?',
      a: 'Your team can start a 14-day free trial of simplecrm with zero upfront cost and no credit card required. Enter your details and expected seat count below to enroll — our team will get your workspace started and follow up with you at the end of your trial.'
    },
    {
      q: 'What payment methods are supported after the trial?',
      a: 'When you choose to continue after the 14-day free trial, we support UPI, Net Banking, Debit/Credit cards via Razorpay, and GST invoice billing.'
    }
  ];

  return (
    <div ref={pageRef} className="pricing-page-root">
      {/* Outer Clean Container Frame */}
      <div className="pricing-outer-frame">
        {/* Main Hero Container */}
        <div className="pricing-main-hero">
          {/* Header */}
          <header className="pricing-header">
            <a
              href="/"
              className="pricing-brand-link"
              onClick={(e) => {
                e.preventDefault();
                onGoToHome();
              }}
            >
              <span className="pricing-brand-text">simplecrm</span>
            </a>

            <div className="pricing-header-actions">
              <button
                type="button"
                className="pricing-btn-home"
                onClick={onGoToHome}
              >
                Back to Home
              </button>
              <button
                type="button"
                className="pricing-btn-signin"
                onClick={onGoToLogin}
              >
                Sign In
              </button>
            </div>
          </header>

          {/* Hero Content & Pricing Headline */}
          <div className="pricing-hero-content">
            <h1 className="pricing-hero-h1">
              One flat price. Every module included.
            </h1>

            <p className="pricing-hero-subtitle">
              Start with a 14-day free trial and zero upfront cost. After your trial, pay flat{' '}
              <span className="pricing-highlight-price">
                ₹999 per seat
                <svg
                  viewBox="0 0 160 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="pricing-svg-underline"
                >
                  <path
                    pathLength="1"
                    d="M3 8.5C38 3.5 118 2 157 9.5C132 12.5 75 13 42 11"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pricing-svg-path"
                  />
                </svg>
              </span>{' '}
              per month — add more seats anytime at the same flat rate.
            </p>

            {/* Comparison & Calculator Table */}
            <div className="pricing-table-wrapper">
              <div className="pricing-table-card">
                <div className="pricing-table-scroll">
                  <table className="pricing-table">
                    <thead>
                      <tr>
                        <th style={{ width: '36%' }}>Capabilities</th>
                        <th style={{ width: '30%' }}>Traditional CRMs</th>
                        <th className="th-teamstuff">simplecrm</th>
                      </tr>
                    </thead>
                    <tbody data-stagger-group="pricing-rows">
                      {comparisonData.map((row, idx) => (
                        <tr
                          key={idx}
                          className={row.highlight ? 'row-highlight' : ''}
                        >
                          <td>
                            <span className={`pricing-feature-name ${row.highlight ? 'highlight' : ''}`}>
                              {row.feature}
                            </span>
                          </td>
                          <td>
                            <p className="pricing-trad-val">{row.traditional}</p>
                            <p className="pricing-trad-note">{row.traditionalNote}</p>
                          </td>
                          <td className="pricing-td-teamstuff">
                            <div className="pricing-teamstuff-val-box">
                              <CheckCircle2 size={16} color="#18181B" />
                              <span className="pricing-teamstuff-val">{row.teamstuff}</span>
                            </div>
                            <p className="pricing-teamstuff-note">
                              {row.teamstuffNote}
                            </p>
                          </td>
                        </tr>
                      ))}

                      {/* Seats Calculator Row */}
                      <tr className="pricing-calculator-row">
                        {/* Col 1: Slider */}
                        <td>
                          <div className="pricing-calc-label-box">
                            <Users size={17} color="#18181B" />
                            <span>Calculate For Your Team</span>
                          </div>
                          <div className="pricing-calc-slider-box">
                            <div className="pricing-calc-count-header">
                              <span>Seats:</span>
                              <span className="pricing-calc-count-val">
                                {teamSize > 25 ? '25+ seats' : `${teamSize} seats`}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={3}
                              max={26}
                              step={1}
                              value={teamSize}
                              onChange={(e) => setTeamSize(Number(e.target.value))}
                              className="pricing-range-slider"
                              aria-label="Select Number of Seats"
                            />
                          </div>
                        </td>

                        {/* Col 2: Traditional Cost */}
                        <td>
                          {teamSize > 25 ? (
                            <>
                              <p className="pricing-trad-total-val" style={{ textDecoration: 'none', color: '#09090B' }}>
                                Custom Enterprise
                              </p>
                              <p className="pricing-trad-note">High setup &amp; annual lock-in</p>
                            </>
                          ) : (
                            <>
                              <p className="pricing-trad-total-val">
                                ₹{traditionalMonthlyTotal.toLocaleString('en-IN')} / mo
                              </p>
                              <p className="pricing-trad-note">+ mandatory setup fees</p>
                            </>
                          )}
                        </td>

                        {/* Col 3: simplecrm Real-Time Total */}
                        <td className="pricing-td-teamstuff">
                          {teamSize > 25 ? (
                            <div className="pricing-enterprise-cta-box">
                              <button
                                type="button"
                                className="pricing-contact-sales-btn"
                                onClick={() => {
                                  const el = document.getElementById('pricing-lead-form-section');
                                  if (el) {
                                    el.scrollIntoView({ behavior: 'smooth' });
                                    const nameInput = el.querySelector('input');
                                    if (nameInput) nameInput.focus({ preventScroll: true });
                                  }
                                }}
                              >
                                Request Enterprise Trial &rarr;
                              </button>
                              <p className="pricing-total-savings">
                                Volume pricing &amp; 14-day pilot onboarding
                              </p>
                            </div>
                          ) : (
                            <>
                              <div className="pricing-total-box">
                                <span key={monthlyTotal} className="pricing-total-price pricing-price-pop">
                                  ₹{monthlyTotal.toLocaleString('en-IN')}
                                </span>
                                <span className="pricing-total-period">/ month</span>
                              </div>
                              <p className="pricing-total-savings">
                                Save ~₹{monthlySavings.toLocaleString('en-IN')}/mo • All modules
                              </p>
                            </>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Standalone Lead Form Section */}
              <div id="pricing-lead-form-section" className="pricing-lead-form-card" data-scroll-reveal="form-card">
                <div className="pricing-lead-form-wrap">
                  {leadSubmitted ? (
                    <div className="pricing-lead-success-card">
                      <div className="pricing-lead-success-icon">
                        <CheckCircle2 size={24} />
                      </div>
                      <h4 className="pricing-lead-success-title">
                        {trialResult?.provisioned
                          ? `${trialResult.company?.name || 'Your workspace'} is live!`
                          : teamSize > 25
                          ? '14-day trial requested for Enterprise (25+ seats)'
                          : `14-day trial requested for ${teamSize} seats`}
                      </h4>
                      <p className="pricing-lead-success-desc">
                        {trialResult?.provisioned ? (
                          trialResult.emailSent ? (
                            <>
                              Your 14-day trial workspace ({trialResult.company?.seat_limit || teamSize} seats) has been created. We sent your temporary sign-in password to <strong>{trialResult.adminEmail}</strong>.
                            </>
                          ) : (
                            <>
                              Your 14-day trial workspace ({trialResult.company?.name}, {trialResult.company?.seat_limit || teamSize} seats) is ready for <strong>{trialResult.adminEmail}</strong>.
                            </>
                          )
                        ) : (
                          <>
                            We will reach out to <strong>{leadFormData.workEmail}</strong> shortly to activate your team&apos;s 14-day simplecrm trial with zero upfront cost.
                          </>
                        )}
                      </p>

                      {trialResult?.provisioned && trialResult?.tempPassword && (
                        <div
                          style={{
                            maxWidth: 420,
                            margin: '0 auto 18px',
                            padding: '12px 16px',
                            borderRadius: 10,
                            border: '1px solid #CBD5E1',
                            background: '#F8FAFC',
                            textAlign: 'left',
                            fontSize: 13,
                            color: '#1E293B'
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Temporary Sign-In Credentials</div>
                          <div>Email: <code>{trialResult.adminEmail}</code></div>
                          <div>Password: <code>{trialResult.tempPassword}</code></div>
                          <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                            You will be prompted to set your permanent password on first login.
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                        {trialResult?.provisioned && typeof onGoToLogin === 'function' && (
                          <button
                            type="button"
                            onClick={() => onGoToLogin(trialResult.adminEmail)}
                            className="pricing-lead-submit-btn"
                            style={{ maxWidth: 320 }}
                          >
                            <span>Sign In to Workspace</span>
                            <ArrowRight size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setLeadSubmitted(false);
                            setTrialResult(null);
                            setLeadFormData({ name: '', companyName: '', workEmail: '', phone: '' });
                          }}
                          className="pricing-lead-reset-btn"
                        >
                          {trialResult?.provisioned ? 'Create another workspace' : 'Submit another trial request'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleLeadSubmit}>
                      <div className="pricing-lead-header">
                        <h4 className="pricing-lead-title">
                          Start your 14-day free trial
                        </h4>
                        <span className="pricing-lead-subtitle">
                          Zero upfront cost • Instant workspace setup
                        </span>
                      </div>

                      {leadErrors.form && (
                        <div
                          style={{
                            marginBottom: 16,
                            padding: '11px 14px',
                            borderRadius: 9,
                            background: '#FEF2F2',
                            border: '1px solid #FECACA',
                            color: '#B91C1C',
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap'
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <AlertCircle size={15} />
                            <span>{leadErrors.form}</span>
                          </span>
                          {leadErrors.existingEmail && typeof onGoToLogin === 'function' && (
                            <button
                              type="button"
                              onClick={() => onGoToLogin(leadErrors.existingEmail)}
                              style={{
                                background: '#FFFFFF',
                                color: '#991B1B',
                                border: '1px solid #FCA5A5',
                                borderRadius: 6,
                                padding: '4px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Sign in instead
                            </button>
                          )}
                        </div>
                      )}

                      <div className="pricing-lead-grid" data-stagger-group="form-fields">
                        {/* Name */}
                        <div className="pricing-input-group">
                          <label className="pricing-input-label">
                            Your Name
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Rahul Sharma"
                            value={leadFormData.name}
                            onChange={(e) => {
                              setLeadFormData({ ...leadFormData, name: e.target.value });
                              if (leadErrors.name) setLeadErrors({ ...leadErrors, name: '' });
                            }}
                            className={`pricing-input-field ${leadErrors.name ? 'error' : ''}`}
                          />
                          {leadErrors.name && (
                            <p className="pricing-input-error-msg">{leadErrors.name}</p>
                          )}
                        </div>

                        {/* Work Email */}
                        <div className="pricing-input-group">
                          <label className="pricing-input-label">
                            Work Email
                          </label>
                          <input
                            type="email"
                            placeholder="name@company.com"
                            value={leadFormData.workEmail}
                            onChange={(e) => {
                              setLeadFormData({ ...leadFormData, workEmail: e.target.value });
                              if (leadErrors.workEmail) setLeadErrors({ ...leadErrors, workEmail: '' });
                            }}
                            className={`pricing-input-field ${leadErrors.workEmail ? 'error' : ''}`}
                          />
                          {leadErrors.workEmail && (
                            <p className="pricing-input-error-msg">{leadErrors.workEmail}</p>
                          )}
                        </div>

                        {/* Phone */}
                        <div className="pricing-input-group">
                          <label className="pricing-input-label">
                            Phone Number
                          </label>
                          <input
                            type="tel"
                            placeholder="+91 98765 43210"
                            value={leadFormData.phone}
                            onChange={(e) => {
                              setLeadFormData({ ...leadFormData, phone: e.target.value });
                              if (leadErrors.phone) setLeadErrors({ ...leadErrors, phone: '' });
                            }}
                            className={`pricing-input-field ${leadErrors.phone ? 'error' : ''}`}
                          />
                          {leadErrors.phone && (
                            <p className="pricing-input-error-msg">{leadErrors.phone}</p>
                          )}
                        </div>

                        {/* Team Size (Seats) */}
                        <div className="pricing-input-group">
                          <label className="pricing-input-label">
                            Seats Needed
                          </label>
                          <div className="pricing-team-size-wrap">
                            <input
                              type="text"
                              value={teamSize > 25 ? 'Enterprise (25+ seats)' : teamSize}
                              onFocus={(e) => {
                                if (teamSize > 25) e.target.select();
                              }}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                if (raw.toLowerCase().includes('ent') || raw.includes('25+')) {
                                  setTeamSize(26);
                                  return;
                                }
                                const val = parseInt(raw, 10);
                                if (!isNaN(val) && val >= 1) {
                                  setTeamSize(val > 25 ? 26 : Math.max(val, 1));
                                } else if (raw === '') {
                                  setTeamSize(1);
                                }
                              }}
                              className="pricing-team-size-input"
                              placeholder="e.g. 5"
                            />
                            {teamSize <= 25 && (
                              <span className="pricing-team-size-suffix">
                                seats
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Company / Workspace Name (Optional) */}
                        <div className="pricing-input-group" style={{ gridColumn: '1 / -1' }}>
                          <label className="pricing-input-label">
                            Company or Workspace Name <span style={{ color: '#94A3B8', fontWeight: 400 }}>(Optional)</span>
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Acme Growth Studio"
                            value={leadFormData.companyName}
                            onChange={(e) => {
                              setLeadFormData({ ...leadFormData, companyName: e.target.value });
                            }}
                            className="pricing-input-field"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmittingLead}
                        className="pricing-lead-submit-btn"
                      >
                        {isSubmittingLead ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Enrolling...</span>
                          </>
                        ) : (
                          <span>Start 14-Day Free Trial</span>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Trust Guarantees */}
              <div className="pricing-trust-bar" data-scroll-reveal="trust-bar" data-stagger-group="trust-pills">
                <div className="pricing-trust-item">
                  <ShieldCheck size={16} color="#18181B" />
                  <span>14-day free trial • ₹0 upfront</span>
                </div>
                <div className="pricing-trust-item">
                  <Lock size={16} color="#18181B" />
                  <span>No lock-in contracts</span>
                </div>
                <div className="pricing-trust-item">
                  <Headphones size={16} color="#18181B" />
                  <span>Priority support</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Frequently Asked Questions Section */}
      <section className="pricing-faq-section">
        <div className="pricing-faq-container">
          <div className="pricing-faq-header" data-scroll-reveal="faq-header">
            <h2 className="pricing-faq-title">
              Frequently Asked Questions
            </h2>
            <p className="pricing-faq-subtitle">
              Clear answers to common questions about simplecrm pricing.
            </p>
          </div>

          <div className="pricing-faq-list" data-scroll-reveal="faq-list" data-stagger-group="faq-items">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className={`pricing-faq-item ${isOpen ? 'open' : ''}`}
                >
                  <div className="pricing-faq-q-row">
                    <h3 className="pricing-faq-question">
                      {faq.q}
                    </h3>
                    <span className="pricing-faq-icon">
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </div>

                  {isOpen && (
                    <p className="pricing-faq-answer">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Full-Width Pre-Footer CTA */}
      <section ref={ctaRef} className="pricing-bottom-cta spotlight-surface" data-scroll-reveal="dark-cta">
        <div className="spotlight-grid-overlay" aria-hidden="true" />
        <div className="pricing-bottom-cta-content">
          <h2 className="pricing-bottom-cta-h2">
            Try simplecrm free for 14 days.
          </h2>
          <p className="pricing-bottom-cta-subtitle">
            Zero upfront cost during your trial, then flat ₹999 per seat per month. Add more seats anytime, cancel whenever.
          </p>
          <div className="pricing-bottom-cta-actions">
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('pricing-lead-form-section');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  const nameInput = el.querySelector('input');
                  if (nameInput) nameInput.focus({ preventScroll: true });
                }
              }}
              className="pricing-bottom-btn-demo"
            >
              Start 14-Day Free Trial
            </button>
            <button
              type="button"
              onClick={onGoToHome}
              className="pricing-bottom-btn-home"
            >
              Back to Home
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Footer */}
      <footer className="pricing-footer">
        <div className="pricing-footer-content">
          <a
            href="/"
            className="pricing-brand-link"
            onClick={(e) => {
              e.preventDefault();
              onGoToHome();
            }}
          >
            <span className="pricing-brand-text">simplecrm</span>
          </a>
          <p className="pricing-footer-copy">
            &copy; {CURRENT_YEAR} simplecrm. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
