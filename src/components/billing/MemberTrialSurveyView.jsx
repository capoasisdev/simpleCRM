import { useState, useEffect } from 'react';
import {
  Star,
  CheckCircle2,
  RefreshCw,
  LogOut,
  Loader2,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import {
  fetchCompanyBillingSnapshot,
  fetchMyTrialFeedback,
  isCompanyAccessLocked,
  submitTrialFeedback
} from '../../lib/billing';
import { setActiveCompanyCache } from '../../lib/tenant';
import '../../styles/billing.css';

const TOTAL_STEPS = 6;

const FEATURE_OPTIONS = [
  'Pipelines & Deals',
  'Lead Finder / Autopilot',
  'WhatsApp & Email Sync',
  'Tasks & Reminders',
  'Notes & Activity'
];

const PAIN_OPTIONS = [
  'Navigation / UI',
  'Speed & loading',
  'Missing integrations',
  'Mobile browser view',
  'None / smooth experience'
];

export default function MemberTrialSurveyView({ currentUser, company, onActivated, onLogout }) {
  const companyId = company?.id || currentUser?.company_id;
  const userId = currentUser?.id;
  const isRenewalPending = Boolean(company?.current_period_end);
  const cycleKey = isRenewalPending ? 'renewal' : 'trial';

  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const [experienceRating, setExperienceRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [wantsToContinue, setWantsToContinue] = useState(null);

  const [favoriteFeatures, setFavoriteFeatures] = useState([]);
  const [painPoints, setPainPoints] = useState([]);
  const [missingFeatures, setMissingFeatures] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadExisting = async () => {
      if (!companyId || !userId) {
        if (active) setIsLoadingInitial(false);
        return;
      }
      const existing = await fetchMyTrialFeedback(companyId, userId, cycleKey);
      if (active) {
        if (existing) {
          setHasSubmitted(true);
          if (existing.experience_rating) setExperienceRating(existing.experience_rating);
          if (typeof existing.wants_to_continue === 'boolean') {
            setWantsToContinue(existing.wants_to_continue);
          }
        }
        setIsLoadingInitial(false);
      }
    };
    loadExisting();
    return () => {
      active = false;
    };
  }, [companyId, userId, cycleKey]);

  const toggleFeature = (feat) => {
    setFavoriteFeatures((prev) =>
      prev.includes(feat) ? prev.filter((f) => f !== feat) : [...prev, feat]
    );
  };

  const togglePainPoint = (point) => {
    setPainPoints((prev) =>
      prev.includes(point) ? prev.filter((p) => p !== point) : [...prev, point]
    );
  };

  const handleCheckStatus = async () => {
    if (!companyId) return;
    setIsCheckingStatus(true);
    setErrorMessage('');
    try {
      const snap = await fetchCompanyBillingSnapshot(companyId);
      if (snap?.company) {
        setActiveCompanyCache(snap.company);
        if (!isCompanyAccessLocked(snap.company) && onActivated) {
          onActivated(snap.company);
        }
      }
    } catch {
      // ignore transient network errors
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (experienceRating < 1 || wantsToContinue === null) {
      setErrorMessage('Please give a rating and select if you want to keep using simplecrm.');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const res = await submitTrialFeedback({
        companyId,
        userId,
        experienceRating,
        wantsToContinue,
        favoriteFeatures,
        painPoints,
        missingFeatures,
        feedbackNotes,
        answers: {
          favoriteFeatures,
          painPoints,
          missingFeatures,
          feedbackNotes
        },
        cycleKey
      });

      if (!res.success) {
        setErrorMessage(res.error || 'Could not submit your response. Please try again.');
        return;
      }

      setHasSubmitted(true);
    } catch (err) {
      setErrorMessage(err?.message || 'Could not submit your response.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="billing-cardless-shell">
      <main className="billing-cardless-container" role="main" aria-label="Feedback">
        {/* Brand & Step Header */}
        <header className="billing-cardless-header">
          {!hasSubmitted && !isLoadingInitial && (
            <div className="billing-step-top-row">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => prev - 1)}
                  className="billing-step-back-btn"
                  aria-label="Previous question"
                >
                  <ArrowLeft size={14} />
                  <span>Back</span>
                </button>
              ) : (
                <div />
              )}
              <span className="billing-step-counter">
                {currentStep} of {TOTAL_STEPS}
              </span>
            </div>
          )}

          <div className={`billing-cardless-brand ${hasSubmitted ? 'centered' : ''}`}>
            simplecrm
          </div>
        </header>

        {errorMessage && (
          <div className="billing-alert-banner" role="alert">
            {errorMessage}
          </div>
        )}

        {isLoadingInitial ? (
          <div className="billing-cardless-loading">
            <Loader2 size={20} className="animate-spin" aria-hidden="true" />
            <span>Loading workspace status...</span>
          </div>
        ) : hasSubmitted ? (
          <div className="billing-cardless-done">
            <div className="billing-done-title-row">
              <CheckCircle2 size={20} strokeWidth={2} className="billing-done-inline-icon" aria-hidden="true" />
              <h2 className="billing-cardless-q-title" style={{ margin: 0 }}>
                Feedback sent
              </h2>
            </div>

            <p className="billing-cardless-done-copy">
              Waiting for your workspace admin to unlock access.
            </p>

            <div className="billing-cardless-done-actions">
              <button
                type="button"
                className="billing-primary-btn billing-cardless-submit"
                onClick={handleCheckStatus}
                disabled={isCheckingStatus}
              >
                {isCheckingStatus ? (
                  <>
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    <span>Checking...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Check if Unlocked</span>
                  </>
                )}
              </button>

              {typeof onLogout === 'function' && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="billing-cardless-signout"
                  style={{ marginTop: 2 }}
                >
                  <LogOut size={13} aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="billing-step-wrapper">
            {/* Step 1: Star Rating */}
            {currentStep === 1 && (
              <div key="step-1" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  Rate your experience
                </h2>
                <div
                  className="billing-cardless-stars"
                  role="radiogroup"
                  aria-label="Experience rating out of 5 stars"
                >
                  {[1, 2, 3, 4, 5].map((val) => {
                    const isFilled = (hoverRating || experienceRating) >= val;
                    return (
                      <button
                        key={val}
                        type="button"
                        role="radio"
                        aria-checked={experienceRating === val}
                        onClick={() => {
                          setExperienceRating(val);
                        }}
                        onMouseEnter={() => setHoverRating(val)}
                        onMouseLeave={() => setHoverRating(0)}
                        aria-label={`${val} star${val > 1 ? 's' : ''}`}
                        className={`billing-cardless-star ${isFilled ? 'filled' : ''}`}
                      >
                        <Star size={24} fill={isFilled ? 'currentColor' : 'none'} strokeWidth={1.5} />
                      </button>
                    );
                  })}
                  {experienceRating > 0 && (
                    <span className="billing-cardless-rating-num">
                      {experienceRating} / 5
                    </span>
                  )}
                </div>

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    disabled={experienceRating < 1}
                    onClick={() => setCurrentStep(2)}
                  >
                    <span>Continue</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Continuation */}
            {currentStep === 2 && (
              <div key="step-2" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  Do you want to continue using simplecrm?
                </h2>
                <div className="billing-cardless-yn-row">
                  <button
                    type="button"
                    onClick={() => setWantsToContinue(false)}
                    className={`billing-cardless-choice ${wantsToContinue === false ? 'selected' : ''}`}
                  >
                    No
                  </button>

                  <button
                    type="button"
                    onClick={() => setWantsToContinue(true)}
                    className={`billing-cardless-choice ${wantsToContinue === true ? 'selected' : ''}`}
                  >
                    Yes, keep using it
                  </button>
                </div>

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    disabled={wantsToContinue === null}
                    onClick={() => setCurrentStep(3)}
                  >
                    <span>Continue</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Features Used */}
            {currentStep === 3 && (
              <div key="step-3" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  Which features did you use the most?
                </h2>
                <div className="billing-survey-chips-wrap">
                  {FEATURE_OPTIONS.map((feat) => {
                    const isSelected = favoriteFeatures.includes(feat);
                    return (
                      <button
                        key={feat}
                        type="button"
                        onClick={() => toggleFeature(feat)}
                        className={`billing-survey-chip ${isSelected ? 'selected' : ''}`}
                      >
                        {feat}
                      </button>
                    );
                  })}
                </div>

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    onClick={() => setCurrentStep(4)}
                  >
                    <span>Continue</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Friction Points */}
            {currentStep === 4 && (
              <div key="step-4" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  What was the biggest friction or issue?
                </h2>
                <div className="billing-survey-chips-wrap">
                  {PAIN_OPTIONS.map((pain) => {
                    const isSelected = painPoints.includes(pain);
                    return (
                      <button
                        key={pain}
                        type="button"
                        onClick={() => togglePainPoint(pain)}
                        className={`billing-survey-chip ${isSelected ? 'selected' : ''}`}
                      >
                        {pain}
                      </button>
                    );
                  })}
                </div>

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    onClick={() => setCurrentStep(5)}
                  >
                    <span>Continue</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: What to build next */}
            {currentStep === 5 && (
              <div key="step-5" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  What is one feature we should build next?
                </h2>
                <input
                  type="text"
                  className="billing-cardless-input"
                  value={missingFeatures}
                  onChange={(e) => setMissingFeatures(e.target.value)}
                  placeholder="e.g. WhatsApp audio transcripts, automated sequence..."
                  maxLength={300}
                  autoFocus
                />

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    onClick={() => setCurrentStep(6)}
                  >
                    <span>{missingFeatures.trim() ? 'Continue' : 'Skip'}</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 6: Open Thoughts & Bugs */}
            {currentStep === 6 && (
              <div key="step-6" className="billing-step-content">
                <h2 className="billing-cardless-q-title">
                  Any other honest thoughts or bugs? <span className="billing-cardless-optional">(optional)</span>
                </h2>
                <textarea
                  className="billing-cardless-textarea"
                  rows={3}
                  value={feedbackNotes}
                  onChange={(e) => setFeedbackNotes(e.target.value)}
                  placeholder="Tell us what broke, what was confusing, or what you loved..."
                  maxLength={1000}
                  autoFocus
                />

                <div className="billing-step-actions">
                  <button
                    type="button"
                    className="billing-primary-btn billing-cardless-submit"
                    disabled={isSubmitting}
                    onClick={handleSubmit}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <span>Send Feedback</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Sign Out */}
            {typeof onLogout === 'function' && (
              <div className="billing-step-footer">
                <button
                  type="button"
                  onClick={onLogout}
                  className="billing-cardless-signout"
                >
                  <LogOut size={13} aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
