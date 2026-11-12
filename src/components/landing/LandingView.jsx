import { useRef } from 'react';
import {
  ArrowRight,
  Smartphone
} from 'lucide-react';
import ConversionJourney from './ConversionJourney';
import { useScrollReveal, useSpotlightSurface } from '../../hooks/useKineticMotion';
import '../../styles/kinetic-motion.css';
import '../../styles/landing.css';

const CURRENT_YEAR = new Date().getFullYear();

export default function LandingView({ onGoToLogin, onGoToDownload, currentUser, onGoToDashboard, onGoToPricing }) {
  const pageRef = useRef(null);
  const ctaRef = useRef(null);

  useScrollReveal(pageRef);
  useSpotlightSurface(ctaRef);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div ref={pageRef} className="landing-page">
      {/* ------------------------------------------------------------------
          1. FRAMED HERO SECTION (matching indiecode HRMS architectural frame)
          ------------------------------------------------------------------ */}
      <div className="landing-outer-frame">
        <section className="landing-sky-hero" aria-label="Hero Section">
          {/* Background Sky Image */}
          <div className="landing-sky-bg" />

          {/* Soft Contrast Gradient Overlay */}
          <div className="landing-sky-gradient" />

          {/* Header Navigation Bar (Integrated Inside Hero Frame) */}
          <header className="landing-hero-header">
            <a
              href="/"
              className="landing-brand-link"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <span className="landing-brand-name">
                simplecrm
              </span>
            </a>

            <div className="landing-hero-actions">
              <button
                type="button"
                className="landing-pill-btn-pricing"
                onClick={onGoToPricing}
              >
                Pricing
              </button>
              {currentUser ? (
                <button
                  type="button"
                  className="landing-pill-btn-signin"
                  onClick={onGoToDashboard}
                >
                  Open Dashboard &rarr;
                </button>
              ) : (
                <button
                  type="button"
                  className="landing-pill-btn-signin"
                  onClick={onGoToLogin}
                >
                  Sign In
                </button>
              )}
            </div>
          </header>

          {/* Centered Hero Content */}
          <div className="landing-hero-content">
            {/* Main Display Headline (Thin, minimal aesthetic) */}
            <div className="hero-headline-container">
              <h1 className="hero-main-title">
                <span className="hero-title-row-1">
                  Sales that feels
                </span>
                <span className="hero-title-row-2">
                  <span className="hero-title-accent">Just comfortable.</span>
                </span>
              </h1>
            </div>

            {/* Subtitle */}
            <p className="hero-subtitle">
              Designed for modern sales teams that need speed. Capture Meta ad leads instantly,
              trigger personalized WhatsApp follow-ups, and close deals without the friction.
            </p>

            {/* Call to Action Buttons */}
            <div className="hero-cta-wrapper">
              <button
                type="button"
                className="hero-cta-pill"
                onClick={currentUser ? onGoToDashboard : (onGoToPricing || onGoToLogin)}
              >
                <span>{currentUser ? 'Go to your CRM' : 'Start 14-day free trial'}</span>
                <span className="hero-cta-arrow">
                  <ArrowRight size={15} strokeWidth={2.5} />
                </span>
              </button>

              <button
                type="button"
                className="hero-cta-secondary"
                onClick={() => scrollToSection('workflow')}
              >
                Explore workflow &darr;
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------------------
          3. THE 3-SECOND CONVERSION JOURNEY (INTERACTIVE WORKFLOW SIMULATION)
          ------------------------------------------------------------------ */}
      <ConversionJourney />

      {/* ------------------------------------------------------------------
          5. CALL TO ACTION BANNER
          ------------------------------------------------------------------ */}
      <section className="landing-cta-section" aria-label="Get Started Banner">
        <div ref={ctaRef} className="cta-box spotlight-surface" data-scroll-reveal="dark-cta">
          <div className="spotlight-grid-overlay" aria-hidden="true" />
          <h2 className="cta-box-title">Start your 14-day free trial today.</h2>
          <p className="cta-box-subtitle">
            Equip your sales team with simplecrm for 14 days at zero upfront cost.
            Available on web and native Android app.
          </p>
          <div className="cta-box-actions">
            <button
              type="button"
              className="cta-btn-white"
              onClick={currentUser ? onGoToDashboard : (onGoToPricing || onGoToLogin)}
            >
              {currentUser ? 'Open simplecrm Dashboard' : 'Start 14-day free trial'} &rarr;
            </button>
            <a
              href="/download"
              className="cta-btn-outline"
              onClick={(e) => {
                e.preventDefault();
                if (onGoToDownload) onGoToDownload();
              }}
            >
              <Smartphone size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              Download Android App
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------
          6. FOOTER
          ------------------------------------------------------------------ */}
      <footer className="landing-footer">
        <div className="footer-container">
          <div className="footer-copy">
            &copy; {CURRENT_YEAR} simplecrm. High-Velocity Sales & Lead Conversion Engine.
          </div>
          <div className="footer-links">
            <a
              href="/download"
              className="footer-link"
              onClick={(e) => {
                e.preventDefault();
                if (onGoToDownload) onGoToDownload();
              }}
            >
              Android APK
            </a>
            <a href="/privacy.html" className="footer-link">
              Privacy Policy
            </a>
            <button
              type="button"
              className="footer-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={onGoToLogin}
            >
              Work Account Sign In
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
